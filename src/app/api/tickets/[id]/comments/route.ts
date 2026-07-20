import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCommentSchema } from '@/lib/validations';
import { sanitizeHtml, isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail } from '@/lib/email';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { canAccessTicket } from '@/lib/permissions';

// POST /api/tickets/[id]/comments
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await req.json();
        const parsed = createCommentSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const { content, isInternal } = parsed.data;

        // Only agents/admins can create internal notes
        if (isInternal && !isAgentOrAbove(session.user.role)) {
            return NextResponse.json({ error: 'Only agents can create internal notes' }, { status: 403 });
        }

        const ticket = await prisma.ticket.findUnique({ where: { id } });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const hasAccess = await canAccessTicket(session.user.id, session.user.role, ticket);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const event = await prisma.timelineEvent.create({
            data: {
                ticketId: id,
                userId: session.user.id,
                type: isInternal ? 'INTERNAL_NOTE' : 'COMMENT',
                content: sanitizeHtml(content),
            },
            include: {
                user: { select: { id: true, name: true, image: true } },
            },
        });

        // First response tracking
        if (!ticket.firstResponseAt && isAgentOrAbove(session.user.role) && !isInternal) {
            await prisma.ticket.update({
                where: { id },
                data: { firstResponseAt: new Date() },
            });
        }

        // Notify watchers (not for internal notes)
        if (!isInternal) {
            const watchers = await prisma.ticketWatcher.findMany({
                where: { ticketId: id, userId: { not: session.user.id } },
                include: { user: { select: { email: true } } },
            });
            const emails = watchers.map((w) => w.user.email).filter(Boolean);
            if (emails.length > 0) {
                sendTicketUpdatedEmail(emails, ticket.key, ticket.title, 'New Comment', content.substring(0, 200));
            }
        }

        return NextResponse.json(event, { status: 201 });
    } catch (error) {
        logger.error('Failed to create comment', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/tickets/[id]/comments — edit a comment
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await req.json();
        const { eventId, content } = body;

        if (!eventId || !content || typeof content !== 'string' || content.trim().length === 0) {
            return NextResponse.json({ error: 'eventId and content are required' }, { status: 400 });
        }

        const event = await prisma.timelineEvent.findUnique({ where: { id: eventId } });
        if (!event || event.ticketId !== id) {
            return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
        }

        // Only the author can edit their own comment
        if (event.userId !== session.user.id) {
            return NextResponse.json({ error: 'You can only edit your own comments' }, { status: 403 });
        }

        // Only COMMENT and INTERNAL_NOTE can be edited
        if (event.type !== 'COMMENT' && event.type !== 'INTERNAL_NOTE') {
            return NextResponse.json({ error: 'This event type cannot be edited' }, { status: 400 });
        }

        // 24h edit window
        const hoursSinceCreation = (Date.now() - new Date(event.createdAt).getTime()) / 3600000;
        if (hoursSinceCreation > 24) {
            return NextResponse.json({ error: 'Comments can only be edited within 24 hours' }, { status: 400 });
        }

        const oldContent = event.content;

        const updated = await prisma.timelineEvent.update({
            where: { id: eventId },
            data: {
                content: sanitizeHtml(content.trim()),
                metadata: {
                    ...((event.metadata as Record<string, unknown>) ?? {}),
                    edited: true,
                    editedAt: new Date().toISOString(),
                },
            },
            include: {
                user: { select: { id: true, name: true, image: true } },
            },
        });

        auditLog({
            userId: session.user.id,
            action: 'comment.edited',
            entity: 'timelineEvent',
            entityId: eventId,
            metadata: { ticketId: id, oldContent: oldContent?.substring(0, 200) },
        });

        return NextResponse.json(updated);
    } catch (error) {
        logger.error('Failed to edit comment', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/tickets/[id]/comments — delete a comment
export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const { searchParams } = new URL(req.url);
        const eventId = searchParams.get('eventId');

        if (!eventId) {
            return NextResponse.json({ error: 'eventId is required' }, { status: 400 });
        }

        const event = await prisma.timelineEvent.findUnique({ where: { id: eventId } });
        if (!event || event.ticketId !== id) {
            return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
        }

        // Only the author or admins can delete
        const isOwner = event.userId === session.user.id;
        const isAdmin = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
        if (!isOwner && !isAdmin) {
            return NextResponse.json({ error: 'You can only delete your own comments' }, { status: 403 });
        }

        // Only COMMENT and INTERNAL_NOTE can be deleted
        if (event.type !== 'COMMENT' && event.type !== 'INTERNAL_NOTE') {
            return NextResponse.json({ error: 'This event type cannot be deleted' }, { status: 400 });
        }

        await prisma.timelineEvent.delete({ where: { id: eventId } });

        auditLog({
            userId: session.user.id,
            action: 'comment.deleted',
            entity: 'timelineEvent',
            entityId: eventId,
            metadata: { ticketId: id, deletedContent: event.content?.substring(0, 200) },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete comment', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
