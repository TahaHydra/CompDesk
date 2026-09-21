import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCommentSchema } from '@/lib/validations';
import { sanitizeHtml, isAgentOrAbove } from '@/lib/utils';
import { sendNewCommentEmail } from '@/lib/email';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { canAccessTicket } from '@/lib/permissions';
import { ticketNotificationRecipients } from '@/lib/tickets/notification-recipients';

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

        const ticket = await prisma.ticket.findUnique({
            where: { id },
            include: {
                requester: { select: { id: true, email: true } },
                assignments: { include: { user: { select: { id: true, email: true } } } },
            },
        });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const hasAccess = await canAccessTicket(session.user.id, session.user.role, ticket);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const isFirstPublicStaffResponse = !ticket.firstPublicResponseAt && isAgentOrAbove(session.user.role) && !isInternal;
        const event = await prisma.$transaction(async (tx) => {
            const created = await tx.timelineEvent.create({
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
            if (isFirstPublicStaffResponse) {
                await tx.ticket.updateMany({
                    where: { id, firstPublicResponseAt: null },
                    data: { firstPublicResponseAt: new Date(), version: { increment: 1 } },
                });
            }
            return created;
        });

        // Notify watchers (not for internal notes)
        if (!isInternal) {
            const emails = await ticketNotificationRecipients(id, session.user.id);
            if (emails.length > 0) {
                void sendNewCommentEmail(emails, ticket.key, ticket.title, content.substring(0, 200));
            }
        }

        return NextResponse.json(event, { status: 201 });
    } catch (error) {
        logger.error('Failed to create comment', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/tickets/[id]/comments — edit a timeline entry
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
            return NextResponse.json({ error: 'Timeline entry not found' }, { status: 404 });
        }
        if (event.type !== 'COMMENT' && event.type !== 'INTERNAL_NOTE') {
            return NextResponse.json({ error: 'System timeline events are immutable' }, { status: 409 });
        }
        if (event.deletedAt) {
            return NextResponse.json({ error: 'Deleted timeline entries are immutable' }, { status: 409 });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id },
            include: {
                requester: { select: { id: true, email: true } },
                assignments: { include: { user: { select: { id: true, email: true } } } },
            },
        });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const hasAccess = await canAccessTicket(session.user.id, session.user.role, ticket);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const isAdministrator = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
        const isOwnConversationEntry = event.userId === session.user.id
            && (event.type === 'COMMENT' || (event.type === 'INTERNAL_NOTE' && session.user.role !== 'USER'));
        if (!isAdministrator && !isOwnConversationEntry) {
            return NextResponse.json({ error: 'You can only edit your own comments' }, { status: 403 });
        }

        if (!isAdministrator) {
            const hoursSinceCreation = (Date.now() - new Date(event.createdAt).getTime()) / 3600000;
            if (hoursSinceCreation > 24) {
                return NextResponse.json({ error: 'Comments can only be edited within 24 hours' }, { status: 400 });
            }
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
            action: 'timeline_event.edited',
            entity: 'timelineEvent',
            entityId: eventId,
            metadata: { ticketId: id, type: event.type, oldContent: oldContent?.substring(0, 200) },
        });

        return NextResponse.json(updated);
    } catch (error) {
        logger.error('Failed to edit comment', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/tickets/[id]/comments — delete a timeline entry
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
            return NextResponse.json({ error: 'Timeline entry not found' }, { status: 404 });
        }
        if (event.type !== 'COMMENT' && event.type !== 'INTERNAL_NOTE') {
            return NextResponse.json({ error: 'System timeline events are immutable' }, { status: 409 });
        }
        if (event.deletedAt) {
            return NextResponse.json({ error: 'Timeline entry is already deleted' }, { status: 409 });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id },
            include: {
                requester: { select: { id: true, email: true } },
                assignments: { include: { user: { select: { id: true, email: true } } } },
            },
        });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const hasAccess = await canAccessTicket(session.user.id, session.user.role, ticket);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const isAdministrator = session.user.role === 'ADMIN' || session.user.role === 'SUPER_ADMIN';
        const isOwnConversationEntry = event.userId === session.user.id
            && (event.type === 'COMMENT' || (event.type === 'INTERNAL_NOTE' && session.user.role !== 'USER'));
        if (!isAdministrator && !isOwnConversationEntry) {
            return NextResponse.json({ error: 'You can only delete your own comments' }, { status: 403 });
        }

        const deletedAt = new Date();
        await prisma.timelineEvent.update({
            where: { id: eventId },
            data: {
                deletedAt,
                deletedById: session.user.id,
                deleteReason: 'user_requested',
                metadata: {
                    ...((event.metadata as Record<string, unknown>) ?? {}),
                    deleted: true,
                    deletedAt: deletedAt.toISOString(),
                },
            },
        });

        void auditLog({
            userId: session.user.id,
            action: 'timeline_event.tombstoned',
            entity: 'timelineEvent',
            entityId: eventId,
            metadata: { ticketId: id, type: event.type, contentLength: event.content?.length ?? 0, historyPreserved: true },
        });

        return NextResponse.json({ success: true, tombstoned: true });
    } catch (error) {
        logger.error('Failed to delete comment', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
