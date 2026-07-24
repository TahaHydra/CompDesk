import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sanitizeHtml, checkRateLimit } from '@/lib/utils';
import logger from '@/lib/logger';
import { authenticateApiRequest } from '@/lib/api-clients';
import { getFeatureFlag } from '@/lib/feature-flags';
import { canAccessQueue, isAgentRole } from '@/lib/permissions';

const externalNoteSchema = z.object({
    content: z.string().trim().min(1).max(10_000),
    authorEmail: z.string().email().optional(),
}).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }
    const authResult = await authenticateApiRequest(req, 'tickets:write');
    if (!authResult.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!checkRateLimit(`api:v1:notes:write:${authResult.client.id}`, 50, 60000)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    try {
        const { id } = await params;
        const parsed = externalNoteSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Note validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const { content, authorEmail } = parsed.data;
        const ticket = await prisma.ticket.findUnique({ where: { id } });
        if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        if (authResult.client.allowedQueueIds.length > 0 && !authResult.client.allowedQueueIds.includes(ticket.queueId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        let author = authorEmail
            ? await prisma.user.findUnique({ where: { email: authorEmail.toLowerCase() } })
            : await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
        if (authorEmail && (!author || !author.isActive || !isAgentRole(author.role))) {
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
            return NextResponse.json({ error: 'The note author cannot access this department' }, { status: 400 });
        }
        if (!author) return NextResponse.json({ error: 'No active administrator is available to attribute this integration note' }, { status: 409 });

        const event = await prisma.timelineEvent.create({
            data: {
                ticketId: id,
                userId: author.id,
                type: 'INTERNAL_NOTE',
                content: sanitizeHtml(content),
                metadata: { source: 'external_api', apiClientId: authResult.client.id },
            },
        });
        return NextResponse.json(event, { status: 201 });
    } catch (error) {
        logger.error('API v1 note creation failed', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
