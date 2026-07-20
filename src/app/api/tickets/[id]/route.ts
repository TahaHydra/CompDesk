import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateTicketSchema } from '@/lib/validations';
import { canTransition, isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail, sendTicketAssignedEmail } from '@/lib/email';
import { fireWebhook } from '@/lib/webhooks';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';

// GET /api/tickets/[id]
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const ticket = await prisma.ticket.findUnique({
            where: { id },
            include: {
                queue: true,
                category: true,
                requester: { select: { id: true, name: true, email: true, image: true } },
                assignee: { select: { id: true, name: true, email: true, image: true } },
                tags: { include: { tag: true } },
                watchers: { include: { user: { select: { id: true, name: true, email: true } } } },
                timeline: {
                    include: { user: { select: { id: true, name: true, image: true } } },
                    orderBy: { createdAt: 'asc' },
                },
                attachments: true,
            },
        });

        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        // RBAC: Users can only see their own tickets
        if (session.user.role === 'USER' && ticket.requesterId !== session.user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Filter internal notes for non-agent users
        if (session.user.role === 'USER') {
            ticket.timeline = ticket.timeline.filter((e) => e.type !== 'INTERNAL_NOTE');
        }

        // SLA info
        let slaInfo = null;
        const sla = await prisma.slaPolicy.findUnique({
            where: { queueId_priority: { queueId: ticket.queueId, priority: ticket.priority } },
        });
        if (sla) {
            const now = new Date();
            const created = new Date(ticket.createdAt);
            const minutesSinceCreation = (now.getTime() - created.getTime()) / 60000;
            slaInfo = {
                firstResponseMinutes: sla.firstResponseMinutes,
                resolutionMinutes: sla.resolutionMinutes,
                firstResponseBreached: !ticket.firstResponseAt && minutesSinceCreation > sla.firstResponseMinutes,
                resolutionBreached: ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && minutesSinceCreation > sla.resolutionMinutes,
                dueAt: ticket.dueAt,
            };
        }

        // Lock indicator
        let lockInfo = null;
        if (ticket.lockedBy && ticket.lockedAt) {
            const lockAge = (Date.now() - new Date(ticket.lockedAt).getTime()) / 60000;
            if (lockAge < 5) { // Lock expires after 5 minutes
                const lockUser = await prisma.user.findUnique({
                    where: { id: ticket.lockedBy },
                    select: { name: true },
                });
                lockInfo = { lockedBy: lockUser?.name, lockedAt: ticket.lockedAt };
            }
        }

        // Update lock for current user (if agent)
        if (isAgentOrAbove(session.user.role)) {
            await prisma.ticket.update({
                where: { id },
                data: { lockedBy: session.user.id, lockedAt: new Date() },
            });
        }

        return NextResponse.json({ ...ticket, slaInfo, lockInfo });
    } catch (error) {
        logger.error('Failed to fetch ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/tickets/[id]
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
        const parsed = updateTicketSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const existingTicket = await prisma.ticket.findUnique({ where: { id } });
        if (!existingTicket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        // RBAC
        if (session.user.role === 'USER' && existingTicket.requesterId !== session.user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const data = parsed.data;
        const timelineEvents: Array<{ type: string; content: string; metadata?: Record<string, unknown> }> = [];

        // Status transition validation
        if (data.status && data.status !== existingTicket.status) {
            if (!canTransition(existingTicket.status, data.status, session.user.role)) {
                return NextResponse.json(
                    { error: `Cannot transition from ${existingTicket.status} to ${data.status}` },
                    { status: 400 }
                );
            }
            timelineEvents.push({
                type: 'STATUS_CHANGE',
                content: `Status changed from ${existingTicket.status} to ${data.status}`,
                metadata: { from: existingTicket.status, to: data.status },
            });

            // Set timestamps
            if (data.status === 'RESOLVED') {
                (data as any).resolvedAt = new Date();
            }
            if (data.status === 'CLOSED') {
                (data as any).closedAt = new Date();
            }
        }

        // Assignment change
        if (data.assigneeId !== undefined && data.assigneeId !== existingTicket.assigneeId) {
            const assigneeName = data.assigneeId
                ? (await prisma.user.findUnique({ where: { id: data.assigneeId }, select: { name: true } }))?.name
                : 'Unassigned';
            timelineEvents.push({
                type: 'ASSIGNMENT_CHANGE',
                content: `Assigned to ${assigneeName}`,
                metadata: { from: existingTicket.assigneeId, to: data.assigneeId },
            });

            // First response tracking
            if (data.assigneeId && !existingTicket.firstResponseAt) {
                (data as any).firstResponseAt = new Date();
            }
        }

        // Priority change
        if (data.priority && data.priority !== existingTicket.priority) {
            timelineEvents.push({
                type: 'PRIORITY_CHANGE',
                content: `Priority changed from ${existingTicket.priority} to ${data.priority}`,
                metadata: { from: existingTicket.priority, to: data.priority },
            });
        }

        // Update tags if provided
        if (data.tagIds) {
            await prisma.ticketTag.deleteMany({ where: { ticketId: id } });
            if (data.tagIds.length > 0) {
                await prisma.ticketTag.createMany({
                    data: data.tagIds.map((tagId) => ({ ticketId: id, tagId })),
                });
            }
        }

        const updateData = { ...data } as Record<string, unknown>;
        delete (updateData as any).tagIds;
        const updatedTicket = await prisma.ticket.update({
            where: { id },
            data: updateData as any,
            include: {
                queue: true,
                requester: true,
                assignee: true,
            },
        });

        // Create timeline events
        for (const event of timelineEvents) {
            await prisma.timelineEvent.create({
                data: {
                    ticketId: id,
                    userId: session.user.id,
                    type: event.type as any,
                    content: event.content,
                    metadata: (event.metadata as any) ?? undefined,
                },
            });
        }

        // Send notifications
        if (data.assigneeId && data.assigneeId !== existingTicket.assigneeId && updatedTicket.assignee) {
            sendTicketAssignedEmail(updatedTicket.assignee.email, updatedTicket.key, updatedTicket.title);
        }

        if (timelineEvents.length > 0) {
            const watchers = await prisma.ticketWatcher.findMany({
                where: { ticketId: id },
                include: { user: { select: { email: true } } },
            });
            const emails = watchers.map((w) => w.user.email).filter(Boolean);
            if (emails.length > 0) {
                const updateType = timelineEvents.map((e) => e.content).join(', ');
                sendTicketUpdatedEmail(emails, updatedTicket.key, updatedTicket.title, 'Ticket Updated', updateType);
            }
        }

        // Webhook for resolved
        if (data.status === 'RESOLVED') {
            fireWebhook('ticket.resolved', {
                ticketId: id,
                key: updatedTicket.key,
                title: updatedTicket.title,
            });
        }

        // Audit log
        auditLog({
            userId: session.user.id,
            action: 'ticket.updated',
            entity: 'ticket',
            entityId: id,
            metadata: { changes: data },
        });

        return NextResponse.json(updatedTicket);
    } catch (error) {
        logger.error('Failed to update ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/tickets/[id] — user can delete own ticket only if unassigned
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

        const ticket = await prisma.ticket.findUnique({ where: { id } });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        // Only the requester can delete
        if (ticket.requesterId !== session.user.id) {
            return NextResponse.json({ error: 'Only the ticket requester can delete this ticket' }, { status: 403 });
        }

        // Only unassigned tickets can be deleted
        if (ticket.assigneeId) {
            return NextResponse.json({ error: 'Cannot delete a ticket that has been assigned. Contact an agent.' }, { status: 400 });
        }

        // Delete all associated records
        await prisma.$transaction([
            prisma.timelineEvent.deleteMany({ where: { ticketId: id } }),
            prisma.ticketWatcher.deleteMany({ where: { ticketId: id } }),
            prisma.ticketTag.deleteMany({ where: { ticketId: id } }),
            prisma.attachment.deleteMany({ where: { ticketId: id } }),
            prisma.ticket.delete({ where: { id } }),
        ]);

        auditLog({
            userId: session.user.id,
            action: 'ticket.deleted',
            entity: 'ticket',
            entityId: id,
            metadata: { key: ticket.key, title: ticket.title },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
