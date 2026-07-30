import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertApiResponseSafe } from '@/lib/api-dto';
import { checkRateLimit } from '@/lib/utils';
import { authenticateApiRequest } from '@/lib/api-clients';
import { getFeatureFlag } from '@/lib/feature-flags';
import { createTicketSchema } from '@/lib/validations';
import { createTicketFromResolvedTemplate } from '@/lib/tickets/create-ticket';
import { TemplateResolutionError } from '@/lib/ticket-form/service';
import { TicketFormValidationError } from '@/lib/ticket-form/validation';
import logger from '@/lib/logger';
import { normalizeEmail } from '@/lib/email-identity';

const externalTicketSchema = createTicketSchema.extend({ userEmail: z.string().email() });

export async function GET(req: NextRequest) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }
    const authResult = await authenticateApiRequest(req, 'tickets:read');
    if (!authResult.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!checkRateLimit(`api:v1:tickets:read:${authResult.client.id}`, 100, 60000)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
    const queueId = url.searchParams.get('queueId');
    const allowedQueueIds = authResult.client.allowedQueueIds;
    if (queueId && allowedQueueIds.length > 0 && !allowedQueueIds.includes(queueId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const where = queueId ? { queueId } : allowedQueueIds.length > 0 ? { queueId: { in: allowedQueueIds } } : {};
    const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
            where,
            include: {
                queue: { select: { id: true, name: true } },
                category: { select: { id: true, name: true } },
                requester: { select: { name: true, email: true } },
                assignments: {
                    select: { user: { select: { id: true, name: true, email: true, role: true } } },
                    orderBy: { assignedAt: 'asc' },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
        }),
        prisma.ticket.count({ where }),
    ]);
    return NextResponse.json({ tickets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}

export async function POST(req: NextRequest) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }
    const authResult = await authenticateApiRequest(req, 'tickets:write');
    if (!authResult.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!checkRateLimit(`api:v1:tickets:write:${authResult.client.id}`, 50, 60000)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    try {
        const parsed = externalTicketSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Ticket validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const { userEmail, ...input } = parsed.data;
        if (authResult.client.allowedQueueIds.length > 0 && !authResult.client.allowedQueueIds.includes(input.queueId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const normalizedEmail = normalizeEmail(userEmail);
        const requester = await prisma.user.upsert({
            where: { normalizedEmail },
            update: {},
            create: { email: normalizedEmail, normalizedEmail, name: normalizedEmail.split('@')[0], role: Role.USER },
        });
        const result = await createTicketFromResolvedTemplate({
            source: 'api',
            actor: { id: requester.id, email: requester.email, role: Role.USER },
            requester: { id: requester.id, email: requester.email, role: Role.USER },
            input,
        });
        return NextResponse.json(assertApiResponseSafe(result.ticket), { status: result.replayed ? 200 : 201 });
    } catch (error) {
        if (error instanceof TemplateResolutionError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        if (error instanceof TicketFormValidationError) {
            return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
        }
        logger.error('API v1 ticket creation failed', { error });
        return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }
}
