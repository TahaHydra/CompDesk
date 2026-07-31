import { readFile, unlink } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { canAccessTicket } from '@/lib/permissions';
import { getFeatureFlag } from '@/lib/feature-flags';
import { resolveStoredAttachmentPath } from '@/lib/attachment-storage';
import { isAttachmentDownloadable } from '@/lib/attachment-security';
import { requestSourceIp } from '@/lib/request-ip';
import logger from '@/lib/logger';

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;
        const attachment = await prisma.attachment.findUnique({
            where: { id },
            include: { ticket: { select: { id: true, requesterId: true, queueId: true } } },
        });
        if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
        if (!(await canAccessTicket(session.user.id, session.user.role, attachment.ticket))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (attachment.deletedAt) return NextResponse.json({ error: 'Attachment was removed' }, { status: 410 });
        if (!isAttachmentDownloadable(attachment.scanStatus)) {
            return NextResponse.json({ error: 'Attachment is quarantined and unavailable' }, { status: 423 });
        }

        const filePath = resolveStoredAttachmentPath(attachment.path, attachment.ticketId);
        if (!filePath) return NextResponse.json({ error: 'Attachment path is invalid' }, { status: 404 });
        const file = await readFile(filePath).catch(() => null);
        if (!file) return NextResponse.json({ error: 'Attachment file is missing' }, { status: 404 });

        const fallbackName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
        return new NextResponse(new Uint8Array(file), {
            headers: {
                'Content-Type': attachment.detectedMimetype,
                'Content-Length': String(file.byteLength),
                'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'none'; sandbox",
            },
        });
    } catch (error) {
        logger.error('Failed to read attachment', { error: error instanceof Error ? error.message : 'Unknown read error' });
        return NextResponse.json({ error: 'Failed to read attachment' }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!(await getFeatureFlag('feature_attachments_enabled'))) {
            return NextResponse.json({ error: 'Attachments are disabled' }, { status: 403 });
        }

        const { id } = await params;
        const attachment = await prisma.attachment.findUnique({
            where: { id },
            include: { ticket: { select: { id: true, requesterId: true, queueId: true } } },
        });
        if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });

        const hasTicketAccess = await canAccessTicket(session.user.id, session.user.role, attachment.ticket);
        const isOwner = attachment.ticket.requesterId === session.user.id;
        if (!hasTicketAccess || (!isOwner && !isAdmin(session.user.role) && session.user.role !== 'AGENT')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (attachment.deletedAt) {
            return NextResponse.json({ success: true, deletedAt: attachment.deletedAt, retained: true });
        }

        const deletedAt = new Date();
        const reason = 'Removed through the ticket attachment action';
        const updated = await prisma.attachment.updateMany({
            where: { id, deletedAt: null },
            data: { deletedAt, deletedById: session.user.id, deleteReason: reason },
        });
        if (updated.count === 0) return NextResponse.json({ success: true, retained: true });

        const filePath = resolveStoredAttachmentPath(attachment.path, attachment.ticketId);
        let fileRemoved = false;
        if (filePath) {
            fileRemoved = await unlink(filePath)
                .then(() => true)
                .catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT');
        }
        if (fileRemoved) {
            await prisma.attachment.update({ where: { id }, data: { blobRemovedAt: new Date() } });
        }
        void auditLog({
            userId: session.user.id,
            action: 'attachment.removed',
            entity: 'attachment',
            entityId: attachment.id,
            metadata: {
                ticketId: attachment.ticket.id,
                filename: attachment.filename,
                size: attachment.size,
                fileRemoved,
                historyRetained: true,
            },
            ipAddress: requestSourceIp(req),
            userAgent: req.headers.get('user-agent') || undefined,
        });
        return NextResponse.json({ success: true, deletedAt, retained: true });
    } catch (error) {
        logger.error('Failed to remove attachment', { error: error instanceof Error ? error.message : 'Unknown delete error' });
        return NextResponse.json({ error: 'Failed to remove attachment' }, { status: 500 });
    }
}
