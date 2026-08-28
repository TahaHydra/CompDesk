import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type PermissionClient = Pick<Prisma.TransactionClient, 'queueGroup' | 'queueMember'>;

export function isAdminRole(role: Role): boolean {
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function isSuperAdminRole(role: Role): boolean {
    return role === 'SUPER_ADMIN';
}

export function isAgentRole(role: Role): boolean {
    return role === 'AGENT' || isAdminRole(role);
}

export async function getAgentAccessibleQueueIds(userId: string, client: PermissionClient = prisma): Promise<string[]> {
    const [groupQueues, directQueues] = await Promise.all([
        client.queueGroup.findMany({
            where: {
                group: { members: { some: { userId } } },
                role: 'agent',
            },
            select: { queueId: true },
        }),
        client.queueMember.findMany({
            where: { userId, role: 'agent' },
            select: { queueId: true },
        }),
    ]);

    return [
        ...new Set([
            ...groupQueues.map((queue) => queue.queueId),
            ...directQueues.map((queue) => queue.queueId),
        ]),
    ];
}

export async function getAdministeredQueueIds(userId: string, client: PermissionClient = prisma): Promise<string[]> {
    const [groupQueues, directQueues] = await Promise.all([
        client.queueGroup.findMany({
            where: {
                group: { members: { some: { userId } } },
                role: 'admin',
            },
            select: { queueId: true },
        }),
        client.queueMember.findMany({
            where: { userId, role: 'admin' },
            select: { queueId: true },
        }),
    ]);

    return [
        ...new Set([
            ...groupQueues.map((queue) => queue.queueId),
            ...directQueues.map((queue) => queue.queueId),
        ]),
    ];
}

/**
 * Queue scope used by the Department Inbox.
 * Super administrators can see every department, department administrators
 * see the departments they administer plus any where they are also agents,
 * and agents see their assigned departments.
 */
export async function getQueueInboxQueueIds(userId: string, role: Role, client: PermissionClient = prisma): Promise<string[] | null> {
    if (role === 'SUPER_ADMIN') return null;
    if (role === 'ADMIN') {
        const [administered, assigned] = await Promise.all([
            getAdministeredQueueIds(userId, client),
            getAgentAccessibleQueueIds(userId, client),
        ]);
        return [...new Set([...administered, ...assigned])];
    }
    if (role === 'AGENT') return getAgentAccessibleQueueIds(userId, client);
    return [];
}

export async function canAdministerQueue(userId: string, role: Role, queueId: string, client: PermissionClient = prisma): Promise<boolean> {
    if (role === 'SUPER_ADMIN') return true;
    if (role !== 'ADMIN') return false;
    const queueIds = await getAdministeredQueueIds(userId, client);
    return queueIds.includes(queueId);
}
export async function canAccessQueue(userId: string, role: Role, queueId: string, client: PermissionClient = prisma): Promise<boolean> {
    if (role === 'SUPER_ADMIN') return true;
    if (role === 'ADMIN') {
        const queueIds = await getQueueInboxQueueIds(userId, role, client);
        return Boolean(queueIds?.includes(queueId));
    }
    if (role !== 'AGENT') return false;

    const queueIds = await getAgentAccessibleQueueIds(userId, client);
    return queueIds.includes(queueId);
}

export async function canAccessTicket(
    userId: string,
    role: Role,
    ticket: { requesterId: string; queueId: string },
    client: PermissionClient = prisma
): Promise<boolean> {
    if (role === 'SUPER_ADMIN') return true;
    if (role === 'ADMIN') return canAccessQueue(userId, role, ticket.queueId, client);
    if (role === 'USER') return ticket.requesterId === userId;
    if (role === 'AGENT') return canAccessQueue(userId, role, ticket.queueId, client);
    return false;
}
/**
 * Hard deletion is intentionally narrower than ticket access.
 * Super administrators can remove any ticket. Every other role may only
 * withdraw a ticket they requested while it is still unassigned.
 */
export function canDeleteTicket(
    userId: string,
    role: Role,
    ticket: { requesterId: string; assignmentCount: number }
): boolean {
    if (role === 'SUPER_ADMIN') return true;
    return ticket.requesterId === userId && ticket.assignmentCount === 0;
}
