import { prisma } from '@/lib/prisma';

/** Watch subscriptions do not grant access; recheck current roles and memberships before sending. */
export async function ticketNotificationRecipients(ticketId: string, excludingUserId: string): Promise<string[]> {
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId }, select: { requesterId: true, queueId: true },
    });
    if (!ticket) return [];
    const candidates = await prisma.user.findMany({
        where: {
            isActive: true,
            id: { not: excludingUserId },
            OR: [
                { id: ticket.requesterId },
                { watchedTickets: { some: { ticketId } } },
                { ticketAssignments: { some: { ticketId } } },
            ],
        },
        select: {
            id: true, email: true, role: true, isActive: true,
            queueMemberships: { where: { queueId: ticket.queueId }, select: { role: true } },
            groupMemberships: {
                select: { group: { select: { queueAssignments: { where: { queueId: ticket.queueId }, select: { role: true } } } } },
            },
        },
    });
    return [...new Set(candidates.filter((candidate) => {
        if (!candidate.isActive || candidate.id === excludingUserId) return false;
        if (candidate.role === 'SUPER_ADMIN') return true;
        if (candidate.role === 'USER') return candidate.id === ticket.requesterId;
        const memberships = [
            ...candidate.queueMemberships,
            ...candidate.groupMemberships.flatMap((membership) => membership.group.queueAssignments),
        ];
        return memberships.some(({ role }) => role === 'agent' || (candidate.role === 'ADMIN' && role === 'admin'));
    }).map((candidate) => candidate.email).filter(Boolean))];
}
