import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import path from 'path';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessTicket } from '@/lib/permissions';
import { getFeatureFlag } from '@/lib/feature-flags';
import logger from '@/lib/logger';
import { authenticatedAttachmentUrl, privateAttachmentLocation, temporaryAttachmentLocation, temporaryAttachmentUsage } from '@/lib/attachment-storage';
import { checkRateLimit } from '@/lib/utils';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
    'application/pdf': '.pdf', 'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/zip': '.zip', 'application/x-rar-compressed': '.rar', 'application/x-7z-compressed': '.7z',
    'text/plain': '.txt', 'text/csv': '.csv',
};

function contentMatchesMime(type: string, buffer: Buffer): boolean {
    if (type === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
    if (type === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (type === 'image/gif') return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'));
    if (type === 'image/webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (type === 'image/bmp') return buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM';
    if (type === 'application/pdf') return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    return true;
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!(await getFeatureFlag('feature_attachments_enabled'))) {
            return NextResponse.json({ error: 'Attachments are disabled' }, { status: 403 });
        }
        if (!checkRateLimit(`attachment:upload:${session.user.id}`, 20, 10 * 60 * 1000)) {
            return NextResponse.json({ error: 'Upload rate limit exceeded. Try again later.' }, { status: 429 });
        }
        const body = await req.formData();
        const fileValue = body.get('file');
        const ticketIdValue = body.get('ticketId');
        const ticketId = typeof ticketIdValue === 'string' && ticketIdValue ? ticketIdValue : null;
        if (!(fileValue instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        if (fileValue.size === 0 || fileValue.size > MAX_FILE_SIZE) {
            return NextResponse.json({ error: 'Files must be between 1 byte and 10 MB' }, { status: 400 });
        }
        const extension = MIME_EXTENSIONS[fileValue.type];
        if (!extension) return NextResponse.json({ error: `File type not allowed: ${fileValue.type || 'unknown'}` }, { status: 400 });

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

        if (!ticket) {
            const usage = await temporaryAttachmentUsage(session.user.id);
            if (usage.files >= usage.limits.maxFilesPerUser) {
                return NextResponse.json({ error: 'Temporary upload file limit reached. Submit or remove existing files first.' }, { status: 429 });
            }
            if (usage.bytes + fileValue.size > usage.limits.maxBytesPerUser) {
                return NextResponse.json({ error: 'Temporary upload storage limit reached. Submit or remove existing files first.' }, { status: 413 });
            }
        }

        const buffer = Buffer.from(await fileValue.arrayBuffer());
        if (!contentMatchesMime(fileValue.type, buffer)) {
            return NextResponse.json({ error: 'The uploaded file content does not match its declared type' }, { status: 400 });
        }
        const uniqueName = `${crypto.randomBytes(16).toString('hex')}${extension}`;
        let uploadDirectory: string;
        let filePath: string;
        let storedPath: string;
        if (ticket) {
            const location = privateAttachmentLocation(ticket.id, uniqueName);
            uploadDirectory = location.directory;
            filePath = location.absolutePath;
            storedPath = location.reference;
        } else {
            const location = temporaryAttachmentLocation(session.user.id, uniqueName);
            uploadDirectory = location.directory;
            filePath = location.absolutePath;
            storedPath = location.reference;
        }
        await mkdir(uploadDirectory, { recursive: true });
        await writeFile(filePath, buffer, { flag: 'wx' });
        const safeOriginalName = path.basename(fileValue.name).slice(0, 255) || `attachment${extension}`;
        let attachment = null;
        if (ticket) {
            try {
                attachment = await prisma.attachment.create({
                    data: { ticketId: ticket.id, filename: safeOriginalName, mimetype: fileValue.type, size: fileValue.size, path: storedPath },
                });
            } catch (error) {
                await unlink(filePath).catch(() => undefined);
                throw error;
            }
        }
        const accessUrl = attachment ? authenticatedAttachmentUrl(attachment.id) : storedPath;
        return NextResponse.json({
            id: attachment?.id ?? null,
            filename: safeOriginalName,
            mimetype: fileValue.type,
            size: fileValue.size,
            url: accessUrl,
            path: accessUrl,
        });
    } catch (error) {
        logger.error('Upload failed', { error });
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }
}