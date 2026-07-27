import type { Prisma, Role } from '@prisma/client';

export type TicketView = 'my' | 'queue' | 'all';
export type TicketTagMode = 'any';

export function broadestTicketView(role: Role): TicketView {
    if (role === 'USER') return 'my';
    if (role === 'AGENT') return 'queue';
    return 'all';
}

export function normalizeTicketView(role: Role, requested: string | null, hasSearch: boolean): TicketView {
    const fallback = hasSearch ? broadestTicketView(role) : 'my';
    if (!requested) return fallback;
    if (role === 'USER') return 'my';
    if (role === 'AGENT') return requested === 'my' ? 'my' : 'queue';
    if (role === 'ADMIN') return requested === 'my' ? 'my' : 'all';
    return requested === 'my' ? 'my' : 'all';
}

export function ticketScopeLabel(role: Role, view: TicketView): string {
    if (view === 'my') return role === 'USER' ? 'My requested tickets' : 'My requested or assigned tickets';
    if (role === 'SUPER_ADMIN') return 'All tickets globally';
    return role === 'AGENT' ? 'All tickets in accessible departments' : 'All tickets in accessible or administered departments';
}

export function buildTicketVisibilityWhere(
    userId: string,
    role: Role,
    view: TicketView,
    accessibleQueueIds: string[] | null
): Prisma.TicketWhereInput {
    if (role === 'USER') return { requesterId: userId };
    if (view === 'my') {
        return { OR: [{ assigneeId: userId }, { requesterId: userId }] };
    }
    if (role === 'SUPER_ADMIN') return {};
    const queueIds = accessibleQueueIds ?? [];
    return { queueId: { in: queueIds.length > 0 ? queueIds : ['__none__'] } };
}

export function buildTicketTextSearch(search: string): Prisma.TicketWhereInput {
    return {
        OR: [
            { id: search },
            { key: { contains: search, mode: 'insensitive' } },
            { title: { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
            { requesterId: search },
            { requester: { is: { name: { contains: search, mode: 'insensitive' } } } },
            { requester: { is: { email: { contains: search, mode: 'insensitive' } } } },
            { assigneeId: search },
            { assignee: { is: { name: { contains: search, mode: 'insensitive' } } } },
            { assignee: { is: { email: { contains: search, mode: 'insensitive' } } } },
            { tags: { some: { tag: { name: { contains: search, mode: 'insensitive' } } } } },
            { category: { is: { name: { contains: search, mode: 'insensitive' } } } },
            { queue: { is: { name: { contains: search, mode: 'insensitive' } } } },
        ],
    };
}

export function buildTicketTagFilter(tagIds: string[], mode: TicketTagMode = 'any'): Prisma.TicketWhereInput {
    if (tagIds.length === 0) return {};
    if (mode === 'any') return { tags: { some: { tagId: { in: tagIds } } } };
    return {};
}