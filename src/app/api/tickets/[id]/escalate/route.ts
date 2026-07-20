import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail } from '@/lib/email';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { canAccessQueue, canAccessTicket } from '@/lib/permissions';

// POST /api/tickets/[id]/escalate — escalate a ticket
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user || !isAgentOrAbove(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { id: ticketId } = await params;
        const body = await req.json();
        const { escalateToId, reason } = body;

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                queue: true,
                requester: true,
                assignee: true,
            },
        });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }
        if (!(await canAccessTicket(session.user.id, session.user.role, ticket))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED') {
            return NextResponse.json({ error: 'Cannot escalate a closed/resolved ticket' }, { status: 400 });
        }
        if (session.user.role === 'AGENT' && escalateToId) {
            const target = await prisma.user.findUnique({
                where: { id: escalateToId },
                select: { id: true, role: true },
            });
            if (!target || !isAgentOrAbove(target.role)) {
                return NextResponse.json({ error: 'Escalation target must be an agent or admin' }, { status: 400 });
            }
            const targetHasAccess = await canAccessQueue(target.id, target.role, ticket.queueId);
            if (!targetHasAccess) {
                return NextResponse.json({ error: 'Escalation target does not have access to this department' }, { status: 400 });
            }
        }

        const newLevel = (ticket as any).escalationLevel + 1;

        // Update ticket with escalation
        const updated = await prisma.ticket.update({
            where: { id: ticketId },
            data: {
                escalationLevel: newLevel,
                escalatedAt: new Date(),
                escalatedById: session.user.id,
                escalatedToId: escalateToId || null,
                assigneeId: escalateToId || ticket.assigneeId,
                priority: newLevel >= 2 ? 'URGENT' : ticket.priority === 'NORMAL' ? 'HIGH' : ticket.priority,
                status: 'OPEN',
            } as any,
            include: {
                assignee: true,
                escalatedTo: true,
            },
        });

        // Timeline entry
        await prisma.timelineEvent.create({
            data: {
                ticketId,
                userId: session.user.id,
                type: 'ESCALATED',
                content: reason || `Ticket escalated to level ${newLevel}`,
                metadata: {
                    level: newLevel,
                    escalatedToId: escalateToId,
                    previousAssigneeId: ticket.assigneeId,
                } as any,
            },
        });

        // Notify the person it's escalated to
        if (escalateToId && (updated as any).escalatedTo) {
            sendTicketUpdatedEmail(
                [(updated as any).escalatedTo.email],
                ticket.key,
                ticket.title,
                'Ticket Escalated',
                `This ticket has been escalated to you (Level ${newLevel}). Reason: ${reason || 'No reason provided'}`
            );
        }

        // Audit
        auditLog({
            userId: session.user.id,
            action: 'ticket.escalated',
            entity: 'ticket',
            entityId: ticketId,
            metadata: { level: newLevel, escalateToId, reason },
        });

        return NextResponse.json({
            success: true,
            escalationLevel: newLevel,
            ticket: updated,
        });
    } catch (error) {
        logger.error('Failed to escalate ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
