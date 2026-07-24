import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { readFile, unlink } from 'fs/promises';
import { canAccessTicket } from '@/lib/permissions';
import { getFeatureFlag } from '@/lib/feature-flags';
import { resolveStoredAttachmentPath } from '@/lib/attachment-storage';

// GET /api/upload/:id — authenticated attachment download
export async function GET(
    req: NextRequest,
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

        const filePath = resolveStoredAttachmentPath(attachment.path, attachment.ticketId);
        if (!filePath) return NextResponse.json({ error: 'Attachment path is invalid' }, { status: 404 });
        const file = await readFile(filePath).catch(() => null);
        if (!file) return NextResponse.json({ error: 'Attachment file is missing' }, { status: 404 });

        const fallbackName = attachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment';
        const disposition = req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline';
        return new NextResponse(new Uint8Array(file), {
            headers: {
                'Content-Type': attachment.mimetype,
                'Content-Length': String(file.byteLength),
                'Content-Disposition': `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error) {
        console.error('Read attachment failed:', error);
        return NextResponse.json({ error: 'Failed to read attachment' }, { status: 500 });
    }
}

// DELETE /api/upload/:id — delete an attachment
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
            include: { ticket: { select: { requesterId: true, queueId: true } } },
        });

        if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });

        // Only the ticket requester or admins can delete attachments
        const hasTicketAccess = await canAccessTicket(session.user.id, session.user.role, attachment.ticket);
        const isOwner = attachment.ticket.requesterId === session.user.id;
        if (!hasTicketAccess || (!isOwner && !isAdmin(session.user.role) && session.user.role !== 'AGENT')) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Delete the file
        try {
            const filePath = resolveStoredAttachmentPath(attachment.path, attachment.ticketId);
            if (filePath) await unlink(filePath);
        } catch {
            // File may already be deleted, continue
        }

        // Delete the database record
        await prisma.attachment.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Delete attachment failed:', error);
        return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
    }
}
