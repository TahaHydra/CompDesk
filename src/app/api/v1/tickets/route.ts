import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { assertApiResponseSafe } from '@/lib/api-dto';
import {
    apiClientCanAccessQueue,
    auditExternalApiRequest,
    authenticateApiRequest,
} from '@/lib/api-clients';
import { consumeDatabaseRateLimit } from '@/lib/database-rate-limit';
import { getFeatureFlag } from '@/lib/feature-flags';
import { createTicketSchema } from '@/lib/validations';
import { createTicketFromResolvedTemplate } from '@/lib/tickets/create-ticket';
import { TemplateResolutionError } from '@/lib/ticket-form/service';
import { TicketFormValidationError } from '@/lib/ticket-form/validation';
import logger from '@/lib/logger';
import { normalizeEmail } from '@/lib/email-identity';

const externalTicketSchema = createTicketSchema.extend({ userEmail: z.string().email() });

async function authenticate(req: NextRequest, scope: 'tickets:read' | 'tickets:write') {
    const result = await authenticateApiRequest(req, scope);
    if (result.ok) return { result, response: null };
    const status = result.rateLimited ? 429 : 401;
    await auditExternalApiRequest({ req, scope, result: result.rateLimited ? 'rate_limited_authentication' : 'unauthorized', target: '/api/v1/tickets' });
    return {
        result,
        response: NextResponse.json(
            { error: result.rateLimited ? 'Too many authentication failures' : 'Unauthorized' },
            { status, ...(result.retryAfterSeconds ? { headers: { 'Retry-After': String(result.retryAfterSeconds) } } : {}) }
        ),
    };
}

export async function GET(req: NextRequest) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        await auditExternalApiRequest({ req, scope: 'tickets:read', result: 'feature_disabled', target: '/api/v1/tickets' });
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }
    const authentication = await authenticate(req, 'tickets:read');
    if (!authentication.result.ok) return authentication.response!;
    const client = authentication.result.client;
    const rateLimit = await consumeDatabaseRateLimit('external-api-read', client.id, 100, 60_000);
    if (!rateLimit.allowed) {
        await auditExternalApiRequest({ req, client, scope: 'tickets:read', result: 'rate_limited', target: '/api/v1/tickets' });
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } });
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20));
    const queueId = url.searchParams.get('queueId');
    if (queueId && !apiClientCanAccessQueue(client, queueId)) {
        await auditExternalApiRequest({ req, client, scope: 'tickets:read', queueId, result: 'forbidden_department', target: '/api/v1/tickets' });
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const where = queueId
        ? { queueId }
        : client.allowAllQueues ? {} : { queueId: { in: client.allowedQueueIds } };
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
    await auditExternalApiRequest({ req, client, scope: 'tickets:read', queueId, result: 'success', target: '/api/v1/tickets' });
    return NextResponse.json(assertApiResponseSafe({ tickets, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }));
}

export async function POST(req: NextRequest) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        await auditExternalApiRequest({ req, scope: 'tickets:write', result: 'feature_disabled', target: '/api/v1/tickets' });
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }
    const authentication = await authenticate(req, 'tickets:write');
    if (!authentication.result.ok) return authentication.response!;
    const client = authentication.result.client;
    const rateLimit = await consumeDatabaseRateLimit('external-api-write', client.id, 50, 60_000);
    if (!rateLimit.allowed) {
        await auditExternalApiRequest({ req, client, scope: 'tickets:write', result: 'rate_limited', target: '/api/v1/tickets' });
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } });
    }

    let targetQueueId: string | null = null;
    try {
        const parsed = externalTicketSchema.safeParse(await req.json());
        if (!parsed.success) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', result: 'validation_failed', target: '/api/v1/tickets' });
            return NextResponse.json({ error: 'Ticket validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const { userEmail, ...input } = parsed.data;
        targetQueueId = input.queueId;
        if (!apiClientCanAccessQueue(client, input.queueId)) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId: input.queueId, result: 'forbidden_department', target: '/api/v1/tickets' });
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
            apiClient: { id: client.id, name: client.name },
        });
        await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId: input.queueId, result: result.replayed ? 'idempotent_replay' : 'created', target: result.ticket.id });
        return NextResponse.json(assertApiResponseSafe(result.ticket), { status: result.replayed ? 200 : 201 });
    } catch (error) {
        await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId: targetQueueId, result: 'failed', target: '/api/v1/tickets' });
        if (error instanceof TemplateResolutionError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        if (error instanceof TicketFormValidationError) {
            return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 });
        }
        logger.error('API v1 ticket creation failed', { apiClientId: client.id, error: error instanceof Error ? error.message : 'Unknown API error' });
        return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
    }
}
