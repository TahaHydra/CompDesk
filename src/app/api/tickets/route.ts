import { NextRequest, NextResponse } from 'next/server';
import { Prisma, Priority, TicketStatus } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PUBLIC_REQUESTER_SELECT, STAFF_USER_SELECT, assertApiResponseSafe } from '@/lib/api-dto';
import { createTicketSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/utils';
import { getQueueInboxQueueIds } from '@/lib/permissions';
import {
    buildTicketTagFilter,
    buildTicketTextSearch,
    buildTicketVisibilityWhere,
    normalizeTicketView,
    ticketScopeLabel,
} from '@/lib/ticket-search';
import { createTicketFromResolvedTemplate } from '@/lib/tickets/create-ticket';
import { TemplateResolutionError } from '@/lib/ticket-form/service';
import { TicketFormValidationError } from '@/lib/ticket-form/validation';
import logger from '@/lib/logger';

const VALID_STATUSES = new Set(Object.values(TicketStatus));
const VALID_PRIORITIES = new Set(Object.values(Priority));

function parseStatuses(value: string | null): TicketStatus[] {
    if (!value) return [];
    if (value.toLowerCase() === 'pending') return [TicketStatus.PENDING_USER, TicketStatus.PENDING_AGENT];
    return [...new Set(value.split(',').filter((item): item is TicketStatus => VALID_STATUSES.has(item as TicketStatus)))];
}

function parseIds(value: string | null, maximum: number): string[] {
    return [...new Set((value ?? '').split(',').map((item) => item.trim()).filter(Boolean))].slice(0, maximum);
}

export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const { searchParams } = new URL(req.url);
        const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
        const rawLimit = Number.parseInt(searchParams.get('limit') ?? '20', 10);
        const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;
        const search = searchParams.get('search')?.trim() ?? '';
        const role = session.user.role;
        const userId = session.user.id;
        const view = normalizeTicketView(role, searchParams.get('view'), Boolean(search));

        const accessibleQueueIds = role === 'AGENT' || role === 'ADMIN'
            ? await getQueueInboxQueueIds(userId, role) ?? []
            : null;
        const visibility = buildTicketVisibilityWhere(userId, role, view, accessibleQueueIds);
        const conditions: Prisma.TicketWhereInput[] = [visibility];

        const queueId = searchParams.get('queueId');
        if (queueId && queueId !== 'all') {
            if (accessibleQueueIds && !accessibleQueueIds.includes(queueId)) {
                return NextResponse.json({ error: 'You cannot filter tickets from this department' }, { status: 403 });
            }
            conditions.push({ queueId });
        }

        const categoryId = searchParams.get('categoryId');
        if (categoryId && categoryId !== 'all') {
            const category = await prisma.category.findFirst({
                where: { id: categoryId, isActive: true, archivedAt: null },
                select: { queueId: true },
            });
            if (!category) return NextResponse.json({ error: 'Category not found or inactive' }, { status: 400 });
            if (queueId && queueId !== 'all' && category.queueId !== queueId) {
                return NextResponse.json({ error: 'The selected category does not belong to the selected department' }, { status: 400 });
            }
            if (accessibleQueueIds && !accessibleQueueIds.includes(category.queueId)) {
                return NextResponse.json({ error: 'You cannot filter tickets from this category' }, { status: 403 });
            }
            conditions.push({ categoryId });
        }

        const statuses = parseStatuses(searchParams.get('status'));
        if (statuses.length === 0) conditions.push({ status: { not: 'WITHDRAWN' } });
        if (statuses.length === 1) conditions.push({ status: statuses[0] });
        if (statuses.length > 1) conditions.push({ status: { in: statuses } });

        const priorityParam = searchParams.get('priority');
        if (priorityParam && VALID_PRIORITIES.has(priorityParam as Priority)) {
            conditions.push({ priority: priorityParam as Priority });
        }

        const requesterId = searchParams.get('requesterId');
        if (requesterId && requesterId !== 'all') conditions.push({ requesterId });
        const assigneeId = searchParams.get('assigneeId');
        if (assigneeId && assigneeId !== 'all') {
            conditions.push(assigneeId === 'unassigned'
                ? { assignments: { none: {} } }
                : { assignments: { some: { userId: assigneeId } } });
        }

        const ticketId = searchParams.get('ticketId')?.trim();
        if (ticketId) conditions.push({ id: ticketId });
        const ticketKey = searchParams.get('ticketKey')?.trim();
        if (ticketKey) conditions.push({ key: { equals: ticketKey, mode: 'insensitive' } });

        const tagIds = parseIds(searchParams.get('tagIds'), 20);
        if (tagIds.length > 0) conditions.push(buildTicketTagFilter(tagIds, 'any'));
        if (search) conditions.push(buildTicketTextSearch(search));

        const where: Prisma.TicketWhereInput = { AND: conditions };
        const [tickets, total] = await Promise.all([
            prisma.ticket.findMany({
                where,
                include: {
                    queue: { select: { id: true, name: true } },
                    category: { select: { id: true, name: true } },
                    requester: { select: { id: true, name: true, email: true } },
                    assignments: {
                        select: { user: { select: { id: true, name: true, email: true, role: true } } },
                        orderBy: { assignedAt: 'asc' },
                    },
                    tags: { include: { tag: true } },
                    _count: { select: { timeline: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.ticket.count({ where }),
        ]);

        const queueIds = [...new Set(tickets.map((ticket) => ticket.queueId))];
        const slaPolicies = queueIds.length > 0
            ? await prisma.slaPolicy.findMany({
                where: { queueId: { in: queueIds } },
                select: { queueId: true, priority: true, resolutionMinutes: true },
            })
            : [];
        const slaMap = new Map(slaPolicies.map((sla) => [`${sla.queueId}:${sla.priority}`, sla.resolutionMinutes] as const));
        const now = Date.now();
        const enrichedTickets = tickets.map((ticket) => {
            let slaBreached = false;
            if (ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && ticket.status !== 'WITHDRAWN') {
                const resolutionMinutes = slaMap.get(`${ticket.queueId}:${ticket.priority}`);
                if (resolutionMinutes !== undefined) {
                    slaBreached = (now - new Date(ticket.createdAt).getTime()) / 60000 > resolutionMinutes;
                }
            }
            return { ...ticket, assignees: ticket.assignments.map((assignment) => assignment.user), assignments: undefined, slaBreached };
        });

        return NextResponse.json(assertApiResponseSafe({
            tickets: enrichedTickets,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            scope: { view, label: ticketScopeLabel(role, view) },
            tagMode: 'any',
        }));
    } catch (error) {
        logger.error('Failed to fetch tickets', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
export async function POST(req: NextRequest) {
    let requesterId: string | null = null;
    let idempotencyKey: string | null = null;
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        requesterId = session.user.id;
        if (!checkRateLimit(`ticket:create:${session.user.id}`, 10, 60000)) {
            return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
        }

        const parsed = createTicketSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Ticket validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        idempotencyKey = parsed.data.idempotencyKey ?? null;
        const result = await createTicketFromResolvedTemplate({
            source: 'web',
            actor: { id: session.user.id, email: session.user.email, role: session.user.role },
            requester: { id: session.user.id, email: session.user.email, role: session.user.role },
            input: parsed.data,
        });
        return NextResponse.json(assertApiResponseSafe(result.ticket), { status: result.replayed ? 200 : 201 });
    } catch (error) {
        if (error instanceof TemplateResolutionError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        if (error instanceof TicketFormValidationError) {
            return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
        }
        if (error instanceof Error && error.message === 'FORBIDDEN_QUEUE') {
            return NextResponse.json({ error: 'You do not have access to this department' }, { status: 403 });
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && requesterId && idempotencyKey) {
            const existing = await prisma.ticket.findFirst({
                where: { requesterId, idempotencyKey },
                include: { queue: true, requester: { select: PUBLIC_REQUESTER_SELECT }, assignments: { include: { user: { select: STAFF_USER_SELECT } } } },
            });
            if (existing) return NextResponse.json(assertApiResponseSafe(existing));
        }
        logger.error('Failed to create ticket', { error });
        return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }
}