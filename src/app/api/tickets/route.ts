import { NextRequest, NextResponse } from 'next/server';
import { Prisma, Priority, TicketStatus } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createTicketSchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/utils';
import { getAgentAccessibleQueueIds, getQueueInboxQueueIds } from '@/lib/permissions';
import { createTicketFromResolvedTemplate } from '@/lib/tickets/create-ticket';
import { TemplateResolutionError } from '@/lib/ticket-form/service';
import { TicketFormValidationError } from '@/lib/ticket-form/validation';
import logger from '@/lib/logger';

const VALID_VIEWS = new Set(['my', 'queue', 'all']);
const VALID_STATUSES = new Set(Object.values(TicketStatus));
const VALID_PRIORITIES = new Set(Object.values(Priority));

export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
        const rawLimit = Number.parseInt(searchParams.get('limit') ?? '20', 10);
        const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
        const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 50) : 20;

        const statusParam = searchParams.get('status');
        const queueIdParam = searchParams.get('queueId');
        const searchParam = searchParams.get('search')?.trim();
        const assigneeIdParam = searchParams.get('assigneeId');
        const priorityParam = searchParams.get('priority');
        const viewParam = searchParams.get('view') ?? 'my';

        const status = statusParam && VALID_STATUSES.has(statusParam as TicketStatus)
            ? (statusParam as TicketStatus)
            : null;
        const priority = priorityParam && VALID_PRIORITIES.has(priorityParam as Priority)
            ? (priorityParam as Priority)
            : null;
        const view = VALID_VIEWS.has(viewParam) ? viewParam : 'my';
        const queueId = queueIdParam && queueIdParam !== 'all' ? queueIdParam : null;

        const where: Prisma.TicketWhereInput = {};
        const andConditions: Prisma.TicketWhereInput[] = [];
        const userId = session.user.id;
        const role = session.user.role;

        let roleBasedQueueIds: string[] | null = null;

        if (role === 'USER') {
            where.requesterId = userId;
        } else if (role === 'AGENT') {
            if (view === 'my') {
                andConditions.push({
                    OR: [
                        { assigneeId: userId },
                        { requesterId: userId },
                    ],
                });
            } else {
                roleBasedQueueIds = await getAgentAccessibleQueueIds(userId);
                where.queueId = roleBasedQueueIds.length > 0 ? { in: roleBasedQueueIds } : { in: ['__none__'] };
            }
        } else if (view === 'my') {
            andConditions.push({
                OR: [
                    { assigneeId: userId },
                    { requesterId: userId },
                ],
            });
        } else if (role === 'ADMIN' || view === 'queue') {
            roleBasedQueueIds = await getQueueInboxQueueIds(userId, role);
            if (roleBasedQueueIds !== null) {
                where.queueId = roleBasedQueueIds.length > 0 ? { in: roleBasedQueueIds } : { in: ['__none__'] };
            }
        }

        if (queueId) {
            if (roleBasedQueueIds && !roleBasedQueueIds.includes(queueId)) {
                where.queueId = { in: ['__none__'] };
            } else {
                where.queueId = queueId;
            }
        }

        if (status) where.status = status;
        const canFilterAssignee =
            role === 'ADMIN' || role === 'SUPER_ADMIN' || view !== 'my';
        if (canFilterAssignee && assigneeIdParam && assigneeIdParam !== 'all') {
            where.assigneeId = assigneeIdParam === 'unassigned' ? null : assigneeIdParam;
        }
        if (priority) where.priority = priority;
        if (searchParam) {
            andConditions.push({
                OR: [
                    { title: { contains: searchParam, mode: 'insensitive' } },
                    { key: { contains: searchParam, mode: 'insensitive' } },
                    { description: { contains: searchParam, mode: 'insensitive' } },
                ],
            });
        }

        if (andConditions.length > 0) {
            where.AND = andConditions;
        }

        const [tickets, total] = await Promise.all([
            prisma.ticket.findMany({
                where,
                include: {
                    queue: { select: { id: true, name: true } },
                    category: { select: { id: true, name: true } },
                    requester: { select: { id: true, name: true, email: true } },
                    assignee: { select: { id: true, name: true, email: true } },
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

        const slaMap = new Map(
            slaPolicies.map((sla) => [`${sla.queueId}:${sla.priority}`, sla.resolutionMinutes] as const)
        );

        const now = Date.now();
        const enrichedTickets = tickets.map((ticket) => {
            let slaBreached = false;

            if (ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED') {
                const resolutionMinutes = slaMap.get(`${ticket.queueId}:${ticket.priority}`);
                if (resolutionMinutes !== undefined) {
                    const ageMinutes = (now - new Date(ticket.createdAt).getTime()) / 60000;
                    slaBreached = ageMinutes > resolutionMinutes;
                }
            }

            return { ...ticket, slaBreached };
        });

        return NextResponse.json({
            tickets: enrichedTickets,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
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
        return NextResponse.json(result.ticket, { status: result.replayed ? 200 : 201 });
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
                include: { queue: true, requester: true, assignee: true },
            });
            if (existing) return NextResponse.json(existing);
        }
        logger.error('Failed to create ticket', { error });
        return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }
}