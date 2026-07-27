import { AssignmentSource } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail } from '@/lib/email';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { canAccessTicket } from '@/lib/permissions';
import { addAssignee, AssignmentServiceError } from '@/lib/tickets/assignment-service';

const escalationSchema = z.object({
    escalateToId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().max(2_000).optional(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user || !isAgentOrAbove(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { id: ticketId } = await params;
        const parsed = escalationSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Escalation validation failed', details: parsed.error.flatten() }, { status: 400 });
        const { escalateToId, reason } = parsed.data;
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { queue: true, requester: true, assignments: { include: { user: true }, orderBy: { assignedAt: 'asc' } } },
        });
        if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        if (!(await canAccessTicket(session.user.id, session.user.role, ticket))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        if (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED') return NextResponse.json({ error: 'Cannot escalate a closed/resolved ticket' }, { status: 400 });

        const previousAssignmentIds = ticket.assignments.map((assignment) => assignment.userId);
        let assignmentResult: Awaited<ReturnType<typeof addAssignee>> | null = null;
        if (escalateToId) assignmentResult = await addAssignee(session.user, ticketId, escalateToId, AssignmentSource.ESCALATION);
        const newLevel = ticket.escalationLevel + 1;
        const updated = await prisma.$transaction(async (tx) => {
            const changed = await tx.ticket.update({
                where: { id: ticketId },
                data: {
                    escalationLevel: newLevel,
                    escalatedAt: new Date(),
                    escalatedById: session.user.id,
                    escalatedToId: escalateToId || null,
                    priority: newLevel >= 2 ? 'URGENT' : ticket.priority === 'NORMAL' ? 'HIGH' : ticket.priority,
                    status: 'OPEN',
                },
                include: { escalatedTo: true, assignments: { include: { user: true }, orderBy: { assignedAt: 'asc' } } },
            });
            await tx.timelineEvent.create({
                data: {
                    ticketId,
                    userId: session.user.id,
                    type: 'ESCALATED',
                    content: reason || `Ticket escalated to level ${newLevel}`,
                    metadata: {
                        level: newLevel,
                        escalatedToId: escalateToId,
                        previousAssignmentIds,
                        resultingAssignmentIds: changed.assignments.map((assignment) => assignment.userId),
                        assignmentBehavior: 'additive',
                    },
                },
            });
            return changed;
        });

        if (escalateToId && updated.escalatedTo && assignmentResult?.alreadyAssigned) {
            void sendTicketUpdatedEmail([updated.escalatedTo.email], ticket.key, ticket.title, 'Ticket Escalated', `This ticket has been escalated to you (Level ${newLevel}). Reason: ${reason || 'No reason provided'}`);
        }
        await auditLog({
            userId: session.user.id,
            action: 'ticket.escalated',
            entity: 'ticket',
            entityId: ticketId,
            metadata: { level: newLevel, escalateToId, reason, assignmentBehavior: 'additive', previousAssignmentIds, resultingAssignmentIds: updated.assignments.map((assignment) => assignment.userId) },
        });
        return NextResponse.json({ success: true, escalationLevel: newLevel, ticket: updated });
    } catch (error) {
        if (error instanceof AssignmentServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
        logger.error('Failed to escalate ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}