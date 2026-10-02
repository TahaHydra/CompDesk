import { Prisma, type Role } from '@prisma/client';

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

export function buildTicketVisibilityWhere(userId: string, role: Role, view: TicketView, accessibleQueueIds: string[] | null): Prisma.TicketWhereInput {
    if (role === 'USER') return { requesterId: userId };
    const personal: Prisma.TicketWhereInput = { OR: [{ assignments: { some: { userId } } }, { requesterId: userId }] };
    if (role === 'SUPER_ADMIN') return view === 'my' ? personal : {};
    const queueIds = accessibleQueueIds ?? [];
    const departments = { queueId: { in: queueIds.length > 0 ? queueIds : ['__none__'] } };
    return view === 'my' ? { AND: [departments, personal] } : departments;
}

/** Gate searchable columns in PostgreSQL so matching/pagination/counts cannot reveal hidden values. */
export function ticketBuiltInVisibilityWhere(fieldKey: string, role: Role): Prisma.TicketWhereInput {
    const fieldContains = (field: Prisma.InputJsonValue): Prisma.TicketWhereInput => ({ formSchemaSnapshot: { path: ['fields'], array_contains: [field] } });
    const gate = (identity: Record<string, string>): Prisma.TicketWhereInput => ({ OR: [
        { formSchemaSnapshot: { equals: Prisma.DbNull } },
        { formSchemaSnapshot: { equals: Prisma.JsonNull } },
        { NOT: fieldContains(identity) },
        { AND: [fieldContains({ ...identity, visibleTo: [role] }), { NOT: fieldContains({ ...identity, isActive: false }) }] },
    ] });
    // Current schemas require canonical field keys; also cover older snapshots identified by builtIn.
    return { AND: [gate({ fieldKey }), gate({ builtIn: fieldKey.toUpperCase() })] };
}

export function buildTicketTextSearch(search: string, role: Role = 'USER'): Prisma.TicketWhereInput {
    return {
        OR: [
            { id: search },
            { key: { contains: search, mode: 'insensitive' } },
            { AND: [ticketBuiltInVisibilityWhere('title', role), { title: { contains: search, mode: 'insensitive' } }] },
            { AND: [ticketBuiltInVisibilityWhere('description', role), { description: { contains: search, mode: 'insensitive' } }] },
            { requesterId: search },
            { requester: { is: { name: { contains: search, mode: 'insensitive' } } } },
            { requester: { is: { email: { contains: search, mode: 'insensitive' } } } },
            { assignments: { some: { userId: search } } },
            { assignments: { some: { user: { name: { contains: search, mode: 'insensitive' } } } } },
            { assignments: { some: { user: { email: { contains: search, mode: 'insensitive' } } } } },
            { AND: [ticketBuiltInVisibilityWhere('tags', role), { tags: { some: { tag: { name: { contains: search, mode: 'insensitive' } } } } }] },
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
