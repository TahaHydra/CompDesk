import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sanitizeHtml } from '@/lib/utils';
import logger from '@/lib/logger';
import { apiClientCanAccessQueue, auditExternalApiRequest, authenticateApiRequest } from '@/lib/api-clients';
import { consumeDatabaseRateLimit } from '@/lib/database-rate-limit';
import { getFeatureFlag } from '@/lib/feature-flags';
import { canAccessQueue, isAgentRole } from '@/lib/permissions';
import { normalizeEmail } from '@/lib/email-identity';
import { assertApiResponseSafe } from '@/lib/api-dto';

const externalNoteSchema = z.object({
    content: z.string().trim().min(1).max(10_000),
    authorEmail: z.string().email().optional(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const target = '/api/v1/tickets/:id/notes';
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        await auditExternalApiRequest({ req, scope: 'tickets:write', result: 'feature_disabled', target });
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }
    const authResult = await authenticateApiRequest(req, 'tickets:write');
    if (!authResult.ok) {
        await auditExternalApiRequest({ req, scope: 'tickets:write', result: authResult.rateLimited ? 'rate_limited_authentication' : 'unauthorized', target });
        return NextResponse.json(
            { error: authResult.rateLimited ? 'Too many authentication failures' : 'Unauthorized' },
            { status: authResult.rateLimited ? 429 : 401, ...(authResult.retryAfterSeconds ? { headers: { 'Retry-After': String(authResult.retryAfterSeconds) } } : {}) }
        );
    }
    const client = authResult.client;
    const rateLimit = await consumeDatabaseRateLimit('external-api-note-write', client.id, 50, 60_000);
    if (!rateLimit.allowed) {
        await auditExternalApiRequest({ req, client, scope: 'tickets:write', result: 'rate_limited', target });
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } });
    }

    let queueId: string | null = null;
    try {
        const { id } = await params;
        const parsed = externalNoteSchema.safeParse(await req.json());
        if (!parsed.success) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', result: 'validation_failed', target: id });
            return NextResponse.json({ error: 'Note validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const { content, authorEmail } = parsed.data;
        const ticket = await prisma.ticket.findUnique({ where: { id } });
        if (!ticket) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', result: 'not_found', target: id });
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }
        queueId = ticket.queueId;
        if (!apiClientCanAccessQueue(client, ticket.queueId)) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId, result: 'forbidden_department', target: id });
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        let author = authorEmail
            ? await prisma.user.findUnique({ where: { normalizedEmail: normalizeEmail(authorEmail) } })
            : await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
        if (authorEmail && (!author || !author.isActive || !isAgentRole(author.role))) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId, result: 'invalid_author', target: id });
            return NextResponse.json({ error: 'authorEmail must identify an active agent or administrator' }, { status: 400 });
        }
        if (!author && !authorEmail) {
            const administrators = await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
            for (const candidate of administrators) {
                if (await canAccessQueue(candidate.id, candidate.role, ticket.queueId)) {
                    author = candidate;
                    break;
                }
            }
        }
        if (author && !(await canAccessQueue(author.id, author.role, ticket.queueId))) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId, result: 'invalid_author_scope', target: id });
            return NextResponse.json({ error: 'The note author cannot access this department' }, { status: 400 });
        }
        if (!author) {
            await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId, result: 'no_attribution_actor', target: id });
            return NextResponse.json({ error: 'No active administrator is available to attribute this integration note' }, { status: 409 });
        }

        const event = await prisma.timelineEvent.create({
            data: {
                ticketId: id,
                userId: author.id,
                type: 'INTERNAL_NOTE',
                content: sanitizeHtml(content),
                metadata: { source: 'external_api', apiClientId: client.id, apiClientName: client.name },
            },
        });
        await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId, result: 'created', target: id });
        return NextResponse.json(assertApiResponseSafe(event), { status: 201 });
    } catch (error) {
        await auditExternalApiRequest({ req, client, scope: 'tickets:write', queueId, result: 'failed', target });
        logger.error('API v1 note creation failed', { apiClientId: client.id, error: error instanceof Error ? error.message : 'Unknown API error' });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
