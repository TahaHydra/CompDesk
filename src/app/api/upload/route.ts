import { randomBytes } from 'node:crypto';
import { chmod, mkdir, unlink, writeFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { canAccessTicket } from '@/lib/permissions';
import { getFeatureFlag } from '@/lib/feature-flags';
import logger from '@/lib/logger';
import {
    authenticatedAttachmentUrl,
    privateAttachmentLocation,
    resolveTemporaryAttachmentPath,
    temporaryAttachmentLimits,
    temporaryAttachmentLocation,
} from '@/lib/attachment-storage';
import { AttachmentValidationError, attachmentLimits, inspectAttachment } from '@/lib/attachment-security';
import { consumeDatabaseRateLimit } from '@/lib/database-rate-limit';
import { requestSourceIp } from '@/lib/request-ip';

class QuotaError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = 'QuotaError';
    }
}

async function removeExpiredTemporaryFiles(userId: string, now: Date): Promise<void> {
    const expired = await prisma.temporaryAttachment.findMany({
        where: { userId, expiresAt: { lte: now } },
        select: { path: true },
    });
    if (expired.length === 0) return;
    const removablePaths: string[] = [];
    await Promise.all(expired.map(async ({ path: reference }) => {
        const filePath = resolveTemporaryAttachmentPath(reference, userId);
        if (!filePath) return;
        const removed = await unlink(filePath).then(() => true).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT');
        if (removed) removablePaths.push(reference);
    }));
    if (removablePaths.length > 0) {
        await prisma.temporaryAttachment.deleteMany({ where: { userId, path: { in: removablePaths } } });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!(await getFeatureFlag('feature_attachments_enabled'))) {
            return NextResponse.json({ error: 'Attachments are disabled' }, { status: 403 });
        }
        const rateLimit = await consumeDatabaseRateLimit('attachment-upload', `${session.user.id}:${requestSourceIp(req)}`, 20, 10 * 60 * 1000);
        if (!rateLimit.allowed) {
            return NextResponse.json(
                { error: 'Upload rate limit exceeded. Try again later.', retryAfterSeconds: rateLimit.retryAfterSeconds },
                { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
            );
        }

        const body = await req.formData();
        const fileValue = body.get('file');
        const ticketIdValue = body.get('ticketId');
        const ticketId = typeof ticketIdValue === 'string' && ticketIdValue ? ticketIdValue : null;
        if (!(fileValue instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

        const buffer = Buffer.from(await fileValue.arrayBuffer());
        const inspection = await inspectAttachment(fileValue.name, fileValue.type, buffer);
        const uniqueName = `${randomBytes(16).toString('hex')}${inspection.extension}`;

        let ticket: { id: string; requesterId: string; queueId: string } | null = null;
        if (ticketId) {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
                return NextResponse.json({ error: 'Invalid ticket id' }, { status: 400 });
            }
            ticket = await prisma.ticket.findUnique({
                where: { id: ticketId }, select: { id: true, requesterId: true, queueId: true },
            });
            if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
            if (!(await canAccessTicket(session.user.id, session.user.role, ticket))) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        if (ticket) {
            const limits = attachmentLimits();
            const location = privateAttachmentLocation(ticket.id, uniqueName);
            await mkdir(location.directory, { recursive: true, mode: 0o700 });
            await chmod(location.directory, 0o700).catch(() => undefined);
            let fileWritten = false;
            try {
                const attachment = await prisma.$transaction(async (tx) => {
                    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1449756210)`;
                    const [ticketUsage, globalUsage] = await Promise.all([
                        tx.attachment.aggregate({
                            where: { ticketId: ticket!.id, deletedAt: null },
                            _count: { _all: true },
                            _sum: { size: true },
                        }),
                        tx.attachment.aggregate({ where: { blobRemovedAt: null }, _sum: { size: true } }),
                    ]);
                    if (ticketUsage._count._all >= limits.maxFilesPerTicket) {
                        throw new QuotaError('Attachment file limit reached for this ticket', 429);
                    }
                    if ((ticketUsage._sum.size ?? 0) + buffer.length > limits.maxBytesPerTicket) {
                        throw new QuotaError('Attachment storage limit reached for this ticket', 413);
                    }
                    if ((globalUsage._sum.size ?? 0) + buffer.length > limits.globalMaxBytes) {
                        throw new QuotaError('Global attachment storage limit reached', 507);
                    }
                    await writeFile(location.absolutePath, buffer, { flag: 'wx', mode: 0o600 });
                    fileWritten = true;
                    return tx.attachment.create({
                        data: {
                            ticketId: ticket!.id,
                            uploaderId: session.user.id,
                            filename: inspection.filename,
                            mimetype: inspection.declaredMimetype,
                            detectedMimetype: inspection.detectedMimetype,
                            size: buffer.length,
                            path: location.reference,
                            sha256: inspection.sha256,
                            scanStatus: inspection.status,
                            scannedAt: inspection.scannedAt,
                        },
                    });
                });
                const accessUrl = authenticatedAttachmentUrl(attachment.id);
                void auditLog({
                    userId: session.user.id,
                    action: 'attachment.uploaded',
                    entity: 'attachment',
                    entityId: attachment.id,
                    metadata: { ticketId: ticket.id, filename: attachment.filename, size: attachment.size, scanStatus: attachment.scanStatus },
                    ipAddress: requestSourceIp(req),
                    userAgent: req.headers.get('user-agent') || undefined,
                });
                return NextResponse.json({
                    id: attachment.id,
                    filename: attachment.filename,
                    mimetype: attachment.detectedMimetype,
                    size: attachment.size,
                    scanStatus: attachment.scanStatus,
                    url: accessUrl,
                    path: accessUrl,
                });
            } catch (error) {
                if (fileWritten) await unlink(location.absolutePath).catch(() => undefined);
                throw error;
            }
        }

        const now = new Date();
        await removeExpiredTemporaryFiles(session.user.id, now);
        const limits = temporaryAttachmentLimits();
        const location = temporaryAttachmentLocation(session.user.id, uniqueName);
        await mkdir(location.directory, { recursive: true, mode: 0o700 });
        let fileWritten = false;
        try {
            const temporary = await prisma.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'attachment-temp:' + session.user.id}))`;
                const usage = await tx.temporaryAttachment.aggregate({
                    where: { userId: session.user.id, expiresAt: { gt: now } },
                    _count: { _all: true },
                    _sum: { size: true },
                });
                if (usage._count._all >= limits.maxFilesPerUser) {
                    throw new QuotaError('Temporary upload file limit reached. Submit or remove existing files first.', 429);
                }
                if ((usage._sum.size ?? 0) + buffer.length > limits.maxBytesPerUser) {
                    throw new QuotaError('Temporary upload storage limit reached. Submit or remove existing files first.', 413);
                }
                await writeFile(location.absolutePath, buffer, { flag: 'wx', mode: 0o600 });
                fileWritten = true;
                return tx.temporaryAttachment.create({
                    data: {
                        userId: session.user.id,
                        filename: inspection.filename,
                        mimetype: inspection.declaredMimetype,
                        detectedMimetype: inspection.detectedMimetype,
                        size: buffer.length,
                        path: location.reference,
                        sha256: inspection.sha256,
                        scanStatus: inspection.status,
                        scannedAt: inspection.scannedAt,
                        expiresAt: new Date(now.getTime() + limits.ttlMs),
                    },
                });
            });
            return NextResponse.json({
                id: null,
                filename: temporary.filename,
                mimetype: temporary.detectedMimetype,
                size: temporary.size,
                scanStatus: temporary.scanStatus,
                url: temporary.path,
                path: temporary.path,
            });
        } catch (error) {
            if (fileWritten) await unlink(location.absolutePath).catch(() => undefined);
            throw error;
        }
    } catch (error) {
        if (error instanceof AttachmentValidationError) {
            const status = error.code === 'MALWARE' ? 422 : error.code === 'SCAN' ? 503 : error.code === 'SIZE' ? 413 : 400;
            return NextResponse.json({ error: error.message }, { status });
        }
        if (error instanceof QuotaError) return NextResponse.json({ error: error.message }, { status: error.status });
        logger.error('Upload failed', { error: error instanceof Error ? error.message : 'Unknown upload error' });
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}
