import { NextRequest, NextResponse } from 'next/server';
import { Priority, TicketStatus } from '@prisma/client';
import { auth } from '@/lib/auth';
import { sendNewTicketForDepartmentEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { createTicketSchema } from '@/lib/validations';
import { generateTicketKey, checkRateLimit, sanitizeHtml } from '@/lib/utils';
import { sendTicketCreatedEmail } from '@/lib/email';
import { fireWebhook } from '@/lib/webhooks';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { rename, mkdir } from 'fs/promises';
import path from 'path';
import { canAccessQueue, getAgentAccessibleQueueIds } from '@/lib/permissions';

const VALID_VIEWS = new Set(['my', 'queue', 'all']);
const VALID_STATUSES = new Set(Object.values(TicketStatus));
const VALID_PRIORITIES = new Set(Object.values(Priority));

async function reserveNextTicketCount(year: number): Promise<number> {
    return prisma.$transaction(async (tx) => {
        const current = await tx.ticketCounter.findUnique({ where: { id: 'singleton' } });

        if (!current) {
            await tx.ticketCounter.create({
                data: { id: 'singleton', year, count: 1 },
            });
            return 1;
        }

        if (current.year !== year) {
            const reset = await tx.ticketCounter.update({
                where: { id: 'singleton' },
                data: { year, count: 1 },
            });
            return reset.count;
        }

        const updated = await tx.ticketCounter.update({
            where: { id: 'singleton' },
            data: { count: { increment: 1 } },
        });
        return updated.count;
    });
}

function getRuleNumber(rules: Record<string, unknown> | null, key: string): number | null {
    const value = rules?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    return null;
}

function getRuleString(rules: Record<string, unknown> | null, key: string): string | null {
    const value = rules?.[key];
    if (typeof value === 'string') return value;
    return null;
}

async function validateCustomFormData(
    queueId: string,
    role: string,
    formData: unknown
): Promise<{ errors: Record<string, string> | null; sanitized: Record<string, unknown> | undefined }> {
    if (formData === undefined || formData === null) {
        const requiredFields = await prisma.formField.findMany({
            where: { queueId, visibleTo: { has: role }, required: true },
            select: { fieldKey: true, label: true },
        });

        if (requiredFields.length === 0) {
            return { errors: null, sanitized: undefined };
        }

        const requiredErrors: Record<string, string> = {};
        for (const field of requiredFields) {
            requiredErrors[field.fieldKey] = `${field.label} is required`;
        }

        return { errors: requiredErrors, sanitized: undefined };
    }

    if (typeof formData !== 'object' || Array.isArray(formData)) {
        return { errors: { formData: 'Custom form data must be an object' }, sanitized: undefined };
    }

    const inputData = formData as Record<string, unknown>;
    const fields = await prisma.formField.findMany({
        where: { queueId, visibleTo: { has: role } },
        orderBy: { sortOrder: 'asc' },
    });

    const errors: Record<string, string> = {};
    const sanitized: Record<string, unknown> = {};
    const knownKeys = new Set(fields.map((field) => field.fieldKey));

    for (const key of Object.keys(inputData)) {
        if (!knownKeys.has(key)) {
            errors[key] = 'Unknown or inaccessible custom field';
        }
    }

    for (const field of fields) {
        const value = inputData[field.fieldKey];
        const rules =
            field.validationRules && typeof field.validationRules === 'object' && !Array.isArray(field.validationRules)
                ? (field.validationRules as Record<string, unknown>)
                : null;
        const options = Array.isArray(field.options)
            ? field.options.filter((option): option is string => typeof option === 'string')
            : [];

        const emptyValue =
            value === undefined ||
            value === null ||
            value === '' ||
            (Array.isArray(value) && value.length === 0);

        if (field.required && emptyValue) {
            errors[field.fieldKey] = `${field.label} is required`;
            continue;
        }

        if (emptyValue) continue;

        if (field.type === 'TEXT' || field.type === 'TEXTAREA') {
            if (typeof value !== 'string') {
                errors[field.fieldKey] = `${field.label} must be text`;
                continue;
            }

            const cleaned = value.trim();
            const minLength = getRuleNumber(rules, 'minLength');
            const maxLength = getRuleNumber(rules, 'maxLength');
            const regexString = getRuleString(rules, 'regex');

            if (minLength !== null && cleaned.length < minLength) {
                errors[field.fieldKey] = `${field.label} must be at least ${minLength} characters`;
                continue;
            }
            if (maxLength !== null && cleaned.length > maxLength) {
                errors[field.fieldKey] = `${field.label} must be at most ${maxLength} characters`;
                continue;
            }
            if (regexString) {
                try {
                    const regex = new RegExp(regexString);
                    if (!regex.test(cleaned)) {
                        errors[field.fieldKey] = `${field.label} format is invalid`;
                        continue;
                    }
                } catch {
                    errors[field.fieldKey] = `${field.label} has an invalid validation rule`;
                    continue;
                }
            }

            sanitized[field.fieldKey] = sanitizeHtml(cleaned);
            continue;
        }

        if (field.type === 'DROPDOWN') {
            if (typeof value !== 'string') {
                errors[field.fieldKey] = `${field.label} must be a single selection`;
                continue;
            }
            if (options.length > 0 && !options.includes(value)) {
                errors[field.fieldKey] = `${field.label} has an invalid option`;
                continue;
            }
            sanitized[field.fieldKey] = value;
            continue;
        }

        if (field.type === 'MULTISELECT') {
            if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
                errors[field.fieldKey] = `${field.label} must be a list of values`;
                continue;
            }

            const cleaned = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
            if (field.required && cleaned.length === 0) {
                errors[field.fieldKey] = `${field.label} is required`;
                continue;
            }
            if (options.length > 0 && cleaned.some((entry) => !options.includes(entry))) {
                errors[field.fieldKey] = `${field.label} contains invalid options`;
                continue;
            }

            sanitized[field.fieldKey] = cleaned;
            continue;
        }

        if (field.type === 'CHECKBOX') {
            if (typeof value !== 'boolean') {
                errors[field.fieldKey] = `${field.label} must be true or false`;
                continue;
            }
            if (field.required && value !== true) {
                errors[field.fieldKey] = `${field.label} must be checked`;
                continue;
            }
            sanitized[field.fieldKey] = value;
            continue;
        }

        if (field.type === 'DATE') {
            if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
                errors[field.fieldKey] = `${field.label} must be a valid date`;
                continue;
            }
            sanitized[field.fieldKey] = value;
            continue;
        }

        if (field.type === 'FILE') {
            if (typeof value === 'string') {
                if (!value.trim()) {
                    errors[field.fieldKey] = `${field.label} is invalid`;
                    continue;
                }
                sanitized[field.fieldKey] = value.trim();
                continue;
            }

            if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
                const files = value.map((entry) => entry.trim()).filter(Boolean);
                if (field.required && files.length === 0) {
                    errors[field.fieldKey] = `${field.label} is required`;
                    continue;
                }
                sanitized[field.fieldKey] = files;
                continue;
            }

            errors[field.fieldKey] = `${field.label} must be a file name or list of file names`;
            continue;
        }

        sanitized[field.fieldKey] = value;
    }

    return {
        errors: Object.keys(errors).length > 0 ? errors : null,
        sanitized: Object.keys(sanitized).length > 0 ? sanitized : undefined,
    };
}

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

        const where: Record<string, unknown> = {};
        const andConditions: Record<string, unknown>[] = [];
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
        } else if (view === 'queue') {
            roleBasedQueueIds = await getAgentAccessibleQueueIds(userId);
            where.queueId = roleBasedQueueIds.length > 0 ? { in: roleBasedQueueIds } : { in: ['__none__'] };
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
                where: where as any,
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
            prisma.ticket.count({ where: where as any }),
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
    let requestUserId: string | null = null;
    let requestIdempotencyKey: string | null = null;

    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        requestUserId = session.user.id;

        if (!checkRateLimit(`ticket:create:${session.user.id}`, 10, 60000)) {
            return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
        }

        const body = await req.json();
        const parsed = createTicketSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const { idempotencyKey, title, description, queueId, categoryId, priority, severity, tagIds, formData } = parsed.data;
        requestIdempotencyKey = idempotencyKey ?? null;

        if (idempotencyKey) {
            const existingTicket = await prisma.ticket.findFirst({
                where: { requesterId: session.user.id, idempotencyKey },
                include: {
                    queue: true,
                    requester: true,
                    assignee: true,
                },
            });
            if (existingTicket) {
                return NextResponse.json(existingTicket, { status: 200 });
            }
        }

        const queue = await prisma.queue.findUnique({
            where: { id: queueId },
        });
        if (!queue) {
            return NextResponse.json({ error: 'Queue not found' }, { status: 404 });
        }

        if (session.user.role === 'AGENT') {
            const hasQueueAccess = await canAccessQueue(session.user.id, session.user.role, queueId);
            if (!hasQueueAccess) {
                return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
        }

        const customFormValidation = await validateCustomFormData(queueId, session.user.role, formData);
        if (customFormValidation.errors) {
            return NextResponse.json(
                {
                    error: 'Custom field validation failed',
                    details: customFormValidation.errors,
                },
                { status: 400 }
            );
        }

        const uniqueTagIds = tagIds ? [...new Set(tagIds)] : [];
        if (uniqueTagIds.length > 0) {
            const existingTagsCount = await prisma.tag.count({
                where: { id: { in: uniqueTagIds } },
            });
            if (existingTagsCount !== uniqueTagIds.length) {
                return NextResponse.json({ error: 'One or more selected tags are invalid' }, { status: 400 });
            }
        }

        const year = new Date().getFullYear();
        const nextCount = await reserveNextTicketCount(year);
        const ticketKey = generateTicketKey(year, nextCount);

        let dueAt: Date | null = null;
        const sla = await prisma.slaPolicy.findUnique({
            where: { queueId_priority: { queueId, priority } },
        });
        if (sla) {
            dueAt = new Date(Date.now() + sla.resolutionMinutes * 60000);
        }

        // Tickets start UNASSIGNED — agents claim them
        const ticket = await prisma.ticket.create({
            data: {
                key: ticketKey,
                idempotencyKey,
                title,
                description: description ? sanitizeHtml(description) : null,
                status: 'NEW',
                priority,
                severity,
                queueId,
                categoryId,
                requesterId: session.user.id,
                assigneeId: null,
                dueAt,
                formData: (customFormValidation.sanitized as any) ?? undefined,
            },
            include: {
                queue: true,
                requester: true,
                assignee: true,
            },
        });

        if (uniqueTagIds.length > 0) {
            await prisma.ticketTag.createMany({
                data: uniqueTagIds.map((tagId) => ({
                    ticketId: ticket.id,
                    tagId,
                })),
                skipDuplicates: true,
            });
        }

        // Process temp attachments (uploaded before ticket was created)
        const rawAttachments = body.attachments;
        if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
            const ticketUploadDir = path.join(process.cwd(), 'public', 'uploads', ticket.id);
            await mkdir(ticketUploadDir, { recursive: true });

            for (const att of rawAttachments.slice(0, 5)) {
                if (!att.url || !att.filename) continue;
                try {
                    const oldPath = path.join(process.cwd(), 'public', att.url);
                    const filename = path.basename(att.url);
                    const newPath = path.join(ticketUploadDir, filename);
                    const newUrl = `/uploads/${ticket.id}/${filename}`;
                    try { await rename(oldPath, newPath); } catch { /* file may already be moved */ }
                    await prisma.attachment.create({
                        data: {
                            ticketId: ticket.id,
                            filename: att.filename,
                            mimetype: att.mimetype || 'application/octet-stream',
                            size: att.size || 0,
                            path: newUrl,
                        },
                    });
                } catch (err) {
                    logger.error('Failed to process attachment', { error: err, filename: att.filename });
                }
            }
        }

        // Add requester as watcher
        await prisma.ticketWatcher.create({
            data: { ticketId: ticket.id, userId: session.user.id },
        });

        // Notify all department agents (add as watchers + email)
        const [groupAgents, directAgents] = await Promise.all([
            prisma.groupMember.findMany({
                where: { group: { queueAssignments: { some: { queueId, role: 'agent' } } } },
                include: { user: { select: { id: true, email: true } } },
            }),
            prisma.queueMember.findMany({
                where: { queueId, role: 'agent' },
                include: { user: { select: { id: true, email: true } } },
            }),
        ]);

        const agentMap = new Map<string, string>();
        for (const m of groupAgents) agentMap.set(m.user.id, m.user.email);
        for (const m of directAgents) agentMap.set(m.user.id, m.user.email);
        agentMap.delete(session.user.id); // Don't notify the requester if they're also an agent

        // Add agents as watchers
        if (agentMap.size > 0) {
            await prisma.ticketWatcher.createMany({
                data: Array.from(agentMap.keys()).map(agentId => ({
                    ticketId: ticket.id,
                    userId: agentId,
                })),
                skipDuplicates: true,
            });
        }

        await prisma.timelineEvent.create({
            data: {
                ticketId: ticket.id,
                userId: session.user.id,
                type: 'CREATED',
                content: `Ticket created: ${title}`,
            },
        });

        // Email the requester
        sendTicketCreatedEmail(session.user.email!, ticketKey, title);

        // Email all department agents about the new ticket
        const agentEmails = Array.from(agentMap.values()).filter(Boolean);
        if (agentEmails.length > 0) {
            sendNewTicketForDepartmentEmail(agentEmails, ticketKey, title, queue.name);
        }

        fireWebhook('ticket.created', {
            ticketId: ticket.id,
            key: ticketKey,
            title,
            queueId,
            requesterId: session.user.id,
        });

        auditLog({
            userId: session.user.id,
            action: 'ticket.created',
            entity: 'ticket',
            entityId: ticket.id,
            metadata: { key: ticketKey, queueId },
        });

        return NextResponse.json(ticket, { status: 201 });
    } catch (error: any) {
        if (error?.code === 'P2002' && requestUserId && requestIdempotencyKey) {
            try {
                const existingTicket = await prisma.ticket.findFirst({
                    where: { requesterId: requestUserId, idempotencyKey: requestIdempotencyKey },
                    include: {
                        queue: true,
                        requester: true,
                        assignee: true,
                    },
                });
                if (existingTicket) {
                    return NextResponse.json(existingTicket, { status: 200 });
                }
            } catch {
                // Fall through to the generic error response.
            }
        }
        logger.error('Failed to create ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
