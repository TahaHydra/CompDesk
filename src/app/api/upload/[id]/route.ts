import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { unlink } from 'fs/promises';
import path from 'path';

// DELETE /api/upload/:id — delete an attachment
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { id } = await params;

        const attachment = await prisma.attachment.findUnique({
            where: { id },
            include: { ticket: { select: { requesterId: true } } },
        });

        if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });

        // Only the ticket requester or admins can delete attachments
        const isOwner = attachment.ticket.requesterId === session.user.id;
        if (!isOwner && !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Delete the file
        try {
            const filePath = path.join(process.cwd(), 'public', attachment.path);
            await unlink(filePath);
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
