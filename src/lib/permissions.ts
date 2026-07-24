import type { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export function isAdminRole(role: Role): boolean {
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
}

export function isAgentRole(role: Role): boolean {
    return role === 'AGENT' || isAdminRole(role);
}

export async function getAgentAccessibleQueueIds(userId: string): Promise<string[]> {
    const [groupQueues, directQueues] = await Promise.all([
        prisma.queueGroup.findMany({
            where: {
                group: { members: { some: { userId } } },
                role: 'agent',
            },
            select: { queueId: true },
        }),
        prisma.queueMember.findMany({
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

export async function getAdministeredQueueIds(userId: string): Promise<string[]> {
    const [groupQueues, directQueues] = await Promise.all([
        prisma.queueGroup.findMany({
            where: {
                group: { members: { some: { userId } } },
                role: 'admin',
            },
            select: { queueId: true },
        }),
        prisma.queueMember.findMany({
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

export async function canAdministerQueue(userId: string, role: Role, queueId: string): Promise<boolean> {
    if (role === 'SUPER_ADMIN') return true;
    if (role !== 'ADMIN') return false;
    const queueIds = await getAdministeredQueueIds(userId);
    return queueIds.includes(queueId);
}
export async function canAccessQueue(userId: string, role: Role, queueId: string): Promise<boolean> {
    if (isAdminRole(role)) return true;
    if (role !== 'AGENT') return false;

    const queueIds = await getAgentAccessibleQueueIds(userId);
    return queueIds.includes(queueId);
}

export async function canAccessTicket(
    userId: string,
    role: Role,
    ticket: { requesterId: string; queueId: string }
): Promise<boolean> {
    if (isAdminRole(role)) return true;
    if (role === 'USER') return ticket.requesterId === userId;
    if (role === 'AGENT') return canAccessQueue(userId, role, ticket.queueId);
    return false;
}
