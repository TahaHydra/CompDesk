import { AssignmentSource, Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { sendTicketAssignedEmail } from '@/lib/email';
import { fireWebhook } from '@/lib/webhooks';
import { canAccessQueue, canAccessTicket, isAgentRole } from '@/lib/permissions';

export interface AssignmentActor {
    id: string;
    role: Role;
}

export class AssignmentServiceError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

const assignmentInclude = {
    user: { select: { id: true, name: true, email: true, image: true, role: true, isActive: true } },
    assignedBy: { select: { id: true, name: true } },
} satisfies Prisma.TicketAssigneeInclude;

async function accessibleTicket(actor: AssignmentActor, ticketId: string) {
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, key: true, title: true, queueId: true, requesterId: true, firstResponseAt: true },
    });
    if (!ticket) throw new AssignmentServiceError('Ticket not found', 404);
    if (!(await canAccessTicket(actor.id, actor.role, ticket))) throw new AssignmentServiceError('Forbidden', 403);
    return ticket;
}

async function authorizedTicket(actor: AssignmentActor, ticketId: string) {
    if (!isAgentRole(actor.role)) throw new AssignmentServiceError('Users cannot manage ticket assignments', 403);
    return accessibleTicket(actor, ticketId);
}

async function validateCandidate(userId: string, queueId: string) {
    const candidate = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, image: true, role: true, isActive: true },
    });
    if (!candidate || !candidate.isActive || !isAgentRole(candidate.role)) {
        throw new AssignmentServiceError('The assignee must be an active agent or administrator', 400);
    }
    if (!(await canAccessQueue(candidate.id, candidate.role, queueId))) {
        throw new AssignmentServiceError('The assignee does not have access to the ticket department', 400);
    }
    return candidate;
}

async function assignmentIds(ticketId: string): Promise<string[]> {
    const rows = await prisma.ticketAssignee.findMany({ where: { ticketId }, select: { userId: true }, orderBy: { assignedAt: 'asc' } });
    return rows.map((row) => row.userId);
}

async function recordAudit(actorId: string, ticketId: string, action: string, metadata: Record<string, unknown>) {
    await auditLog({ userId: actorId, action, entity: 'ticket_assignment', entityId: ticketId, metadata });
}

export async function listAssignments(actor: AssignmentActor, ticketId: string) {
    await accessibleTicket(actor, ticketId);
    const assignments = await prisma.ticketAssignee.findMany({
        where: { ticketId },
        include: assignmentInclude,
        orderBy: { assignedAt: 'asc' },
    });
    if (actor.role !== 'USER') return assignments;
    return assignments.map((assignment) => ({
        id: assignment.id,
        ticketId: assignment.ticketId,
        userId: assignment.userId,
        assignedAt: assignment.assignedAt,
        source: assignment.source,
        user: {
            id: assignment.user.id,
            name: assignment.user.name,
            image: assignment.user.image,
        },
    }));
}

export async function addAssignee(
    actor: AssignmentActor,
    ticketId: string,
    userId: string,
    source: AssignmentSource = AssignmentSource.MANUAL
) {
    const ticket = await authorizedTicket(actor, ticketId);
    if (source === AssignmentSource.CLAIM && userId !== actor.id) throw new AssignmentServiceError('A claim can only assign the current user', 403);
    const candidate = await validateCandidate(userId, ticket.queueId);
    const previousAssignmentIds = await assignmentIds(ticketId);
    if (previousAssignmentIds.includes(userId)) {
        const assignment = await prisma.ticketAssignee.findUnique({ where: { ticketId_userId: { ticketId, userId } }, include: assignmentInclude });
        return { assignment, alreadyAssigned: true, previousAssignmentIds, resultingAssignmentIds: previousAssignmentIds };
    }

    try {
        const assignment = await prisma.$transaction(async (tx) => {
            const created = await tx.ticketAssignee.create({
                data: { ticketId, userId, assignedById: actor.id, source },
                include: assignmentInclude,
            });
            const resultingAssignmentIds = [...previousAssignmentIds, userId];
            await tx.timelineEvent.create({
                data: {
                    ticketId,
                    userId: actor.id,
                    type: 'ASSIGNMENT_CHANGE',
                    content: `${candidate.name} added as an assignee`,
                    metadata: { action: 'added', addedUserId: userId, source, previousAssignmentIds, resultingAssignmentIds },
                },
            });
            if (!ticket.firstResponseAt) await tx.ticket.update({ where: { id: ticketId }, data: { firstResponseAt: new Date() } });
            return created;
        });
        const resultingAssignmentIds = [...previousAssignmentIds, userId];
        await recordAudit(actor.id, ticketId, 'ticket.assignment_added', { addedUserId: userId, source, previousAssignmentIds, resultingAssignmentIds });
        void sendTicketAssignedEmail(candidate.email, ticket.key, ticket.title);
        fireWebhook('ticket.assignment_added', { ticketId, key: ticket.key, addedUserId: userId, source, assigneeIds: resultingAssignmentIds });
        return { assignment, alreadyAssigned: false, previousAssignmentIds, resultingAssignmentIds };
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const resultingAssignmentIds = await assignmentIds(ticketId);
            const assignment = await prisma.ticketAssignee.findUnique({ where: { ticketId_userId: { ticketId, userId } }, include: assignmentInclude });
            return { assignment, alreadyAssigned: true, previousAssignmentIds, resultingAssignmentIds };
        }
        throw error;
    }
}

export async function claimTicket(actor: AssignmentActor, ticketId: string) {
    return addAssignee(actor, ticketId, actor.id, AssignmentSource.CLAIM);
}

export async function removeAssignee(actor: AssignmentActor, ticketId: string, userId: string, source: AssignmentSource = AssignmentSource.MANUAL) {
    const ticket = await authorizedTicket(actor, ticketId);
    const previousAssignmentIds = await assignmentIds(ticketId);
    if (!previousAssignmentIds.includes(userId)) return { removed: false, previousAssignmentIds, resultingAssignmentIds: previousAssignmentIds };
    const removedUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const resultingAssignmentIds = previousAssignmentIds.filter((id) => id !== userId);
    const removed = await prisma.$transaction(async (tx) => {
        const result = await tx.ticketAssignee.deleteMany({ where: { ticketId, userId } });
        if (result.count > 0) {
            await tx.timelineEvent.create({
                data: {
                    ticketId,
                    userId: actor.id,
                    type: 'ASSIGNMENT_CHANGE',
                    content: `${removedUser?.name ?? 'Assignee'} removed from the ticket`,
                    metadata: { action: 'removed', removedUserId: userId, source, previousAssignmentIds, resultingAssignmentIds },
                },
            });
        }
        return result.count > 0;
    });
    if (removed) {
        await recordAudit(actor.id, ticketId, 'ticket.assignment_removed', { removedUserId: userId, source, previousAssignmentIds, resultingAssignmentIds });
        fireWebhook('ticket.assignment_removed', { ticketId, key: ticket.key, removedUserId: userId, source, assigneeIds: resultingAssignmentIds });
    }
    return { removed, previousAssignmentIds, resultingAssignmentIds };
}

export async function unclaimSelf(actor: AssignmentActor, ticketId: string) {
    return removeAssignee(actor, ticketId, actor.id, AssignmentSource.CLAIM);
}

export async function replaceAssignmentSet(actor: AssignmentActor, ticketId: string, requestedUserIds: string[], source: AssignmentSource = AssignmentSource.MANUAL) {
    if (actor.role !== 'ADMIN' && actor.role !== 'SUPER_ADMIN') throw new AssignmentServiceError('Only administrators can replace the full assignment set', 403);
    const ticket = await authorizedTicket(actor, ticketId);
    const nextIds = [...new Set(requestedUserIds)];
    const candidates = await Promise.all(nextIds.map((userId) => validateCandidate(userId, ticket.queueId)));
    const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const previousAssignmentIds = await assignmentIds(ticketId);
    const requestedAddedIds = nextIds.filter((id) => !previousAssignmentIds.includes(id));
    const removedIds = previousAssignmentIds.filter((id) => !nextIds.includes(id));
    const changed = await prisma.$transaction(async (tx) => {
        if (removedIds.length > 0) await tx.ticketAssignee.deleteMany({ where: { ticketId, userId: { in: removedIds } } });
        const created = requestedAddedIds.length > 0
            ? await tx.ticketAssignee.createManyAndReturn({
                data: requestedAddedIds.map((userId) => ({ ticketId, userId, assignedById: actor.id, source })),
                skipDuplicates: true,
                select: { userId: true },
            })
            : [];
        const createdIds = created.map((assignment) => assignment.userId);
        const resulting = await tx.ticketAssignee.findMany({ where: { ticketId }, select: { userId: true }, orderBy: { assignedAt: 'asc' } });
        const resultingAssignmentIds = resulting.map((assignment) => assignment.userId);
        const timeline = [
            ...removedIds.map((userId) => ({
                ticketId,
                userId: actor.id,
                type: 'ASSIGNMENT_CHANGE' as const,
                content: 'Assignee removed by administrative replacement',
                metadata: { action: 'removed', removedUserId: userId, source, previousAssignmentIds, resultingAssignmentIds },
            })),
            ...createdIds.map((userId) => ({
                ticketId,
                userId: actor.id,
                type: 'ASSIGNMENT_CHANGE' as const,
                content: `${candidateById.get(userId)?.name ?? 'User'} added by administrative replacement`,
                metadata: { action: 'added', addedUserId: userId, source, previousAssignmentIds, resultingAssignmentIds },
            })),
        ];
        if (timeline.length > 0) await tx.timelineEvent.createMany({ data: timeline });
        if (createdIds.length > 0 && !ticket.firstResponseAt) await tx.ticket.update({ where: { id: ticketId }, data: { firstResponseAt: new Date() } });
        return { createdIds, resultingAssignmentIds };
    });
    for (const userId of changed.createdIds) {
        const candidate = candidateById.get(userId);
        if (candidate) void sendTicketAssignedEmail(candidate.email, ticket.key, ticket.title);
    }
    await recordAudit(actor.id, ticketId, 'ticket.assignments_replaced', {
        source,
        previousAssignmentIds,
        resultingAssignmentIds: changed.resultingAssignmentIds,
        addedUserIds: changed.createdIds,
        removedUserIds: removedIds,
    });
    fireWebhook('ticket.assignments_replaced', { ticketId, key: ticket.key, source, assigneeIds: changed.resultingAssignmentIds });
    return { previousAssignmentIds, resultingAssignmentIds: changed.resultingAssignmentIds, addedIds: changed.createdIds, removedIds };
}