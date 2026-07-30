import { AssignmentSource } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PUBLIC_REQUESTER_SELECT, STAFF_USER_SELECT, assertApiResponseSafe } from '@/lib/api-dto';
import { isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail } from '@/lib/email';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { canAccessQueue, canAccessTicket, isAgentRole } from '@/lib/permissions';
import { restartedSlaDueAt } from '@/lib/tickets/lifecycle';

const escalationSchema = z.object({
    escalateToId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().max(2_000).optional(),
    expectedVersion: z.number().int().positive(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user || !isAgentOrAbove(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { id: ticketId } = await params;
        const parsed = escalationSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Escalation validation failed', details: parsed.error.flatten() }, { status: 400 });
        const { escalateToId, reason, expectedVersion } = parsed.data;
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                queue: true,
                requester: { select: PUBLIC_REQUESTER_SELECT },
                assignments: { include: { user: { select: STAFF_USER_SELECT } }, orderBy: { assignedAt: 'asc' } },
            },
        });
        if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        if (!(await canAccessTicket(session.user.id, session.user.role, ticket))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        if (ticket.version !== expectedVersion) return NextResponse.json({ error: 'Ticket changed since it was loaded. Refresh before escalating it.', currentVersion: ticket.version }, { status: 409 });
        if (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED' || ticket.status === 'WITHDRAWN') return NextResponse.json({ error: 'Cannot escalate a resolved, closed, or withdrawn ticket' }, { status: 400 });

        const candidate = escalateToId ? await prisma.user.findUnique({ where: { id: escalateToId }, select: STAFF_USER_SELECT }) : null;
        if (escalateToId && (!candidate || !candidate.isActive || !isAgentRole(candidate.role))) {
            return NextResponse.json({ error: 'The escalation target must be an active agent or administrator' }, { status: 400 });
        }
        if (candidate && !(await canAccessQueue(candidate.id, candidate.role, ticket.queueId))) {
            return NextResponse.json({ error: 'The escalation target cannot access this ticket department' }, { status: 400 });
        }

        const previousAssignmentIds = ticket.assignments.map((assignment) => assignment.userId);
        const assignmentAdded = Boolean(escalateToId && !previousAssignmentIds.includes(escalateToId));
        const resultingAssignmentIds = assignmentAdded && escalateToId ? [...previousAssignmentIds, escalateToId] : previousAssignmentIds;
        const newLevel = ticket.escalationLevel + 1;
        const newPriority = newLevel >= 2 ? 'URGENT' : ticket.priority === 'NORMAL' ? 'HIGH' : ticket.priority;
        const mutationTime = new Date();
        const sla = newPriority !== ticket.priority
            ? await prisma.slaPolicy.findUnique({ where: { queueId_priority: { queueId: ticket.queueId, priority: newPriority } }, select: { resolutionMinutes: true } })
            : null;

        let updated;
        try {
            updated = await prisma.$transaction(async (tx) => {
                const changed = await tx.ticket.updateMany({
                    where: { id: ticketId, version: expectedVersion },
                    data: {
                        escalationLevel: newLevel,
                        escalatedAt: mutationTime,
                        escalatedById: session.user.id,
                        escalatedToId: escalateToId || null,
                        priority: newPriority,
                        status: 'OPEN',
                        resolvedAt: null,
                        closedAt: null,
                        ...(newPriority !== ticket.priority ? { dueAt: sla ? restartedSlaDueAt(sla.resolutionMinutes, mutationTime) : null } : {}),
                        ...(assignmentAdded && !ticket.firstAssignedAt ? { firstAssignedAt: mutationTime } : {}),
                        version: { increment: 1 },
                    },
                });
                if (changed.count !== 1) throw new Error('TICKET_VERSION_CONFLICT');
                if (assignmentAdded && escalateToId) {
                    await tx.ticketAssignee.create({ data: { ticketId, userId: escalateToId, assignedById: session.user.id, source: AssignmentSource.ESCALATION } });
                    await tx.timelineEvent.create({
                        data: {
                            ticketId,
                            userId: session.user.id,
                            type: 'ASSIGNMENT_CHANGE',
                            content: `${candidate?.name ?? 'User'} added as an escalation assignee`,
                            metadata: { action: 'added', addedUserId: escalateToId, source: AssignmentSource.ESCALATION, previousAssignmentIds, resultingAssignmentIds },
                        },
                    });
                }
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
                            resultingAssignmentIds,
                            assignmentBehavior: 'additive',
                            priority: { from: ticket.priority, to: newPriority },
                            slaRule: newPriority !== ticket.priority ? 'restart_on_policy_change' : 'unchanged',
                        },
                    },
                });
                return tx.ticket.findUniqueOrThrow({
                    where: { id: ticketId },
                    include: { escalatedTo: { select: STAFF_USER_SELECT }, assignments: { include: { user: { select: STAFF_USER_SELECT } }, orderBy: { assignedAt: 'asc' } } },
                });
            });
        } catch (error) {
            if (error instanceof Error && error.message === 'TICKET_VERSION_CONFLICT') {
                const current = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { version: true } });
                return NextResponse.json({ error: 'Ticket changed since it was loaded. Refresh before escalating it.', currentVersion: current?.version }, { status: 409 });
            }
            throw error;
        }

        if (candidate) {
            void sendTicketUpdatedEmail([candidate.email], ticket.key, ticket.title, 'Ticket Escalated', `This ticket has been escalated to you (Level ${newLevel}). Reason: ${reason || 'No reason provided'}`);
        }
        await auditLog({
            userId: session.user.id,
            action: 'ticket.escalated',
            entity: 'ticket',
            entityId: ticketId,
            metadata: { level: newLevel, escalateToId, reason, assignmentBehavior: 'additive', assignmentAdded, previousAssignmentIds, resultingAssignmentIds, expectedVersion, resultingVersion: expectedVersion + 1 },
        });
        return NextResponse.json(assertApiResponseSafe({ success: true, escalationLevel: newLevel, ticket: updated }));
    } catch (error) {
        logger.error('Failed to escalate ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}