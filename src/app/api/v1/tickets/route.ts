import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, sanitizeHtml, generateTicketKey } from '@/lib/utils';
import { fireWebhook } from '@/lib/webhooks';
import logger from '@/lib/logger';
import { authenticateApiRequest } from '@/lib/api-clients';
import { getFeatureFlag } from '@/lib/feature-flags';

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

// GET /api/v1/tickets
export async function GET(req: NextRequest) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }

    const authResult = await authenticateApiRequest(req, 'tickets:read');
    if (!authResult.ok) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '20'), 50);
    const queueId = searchParams.get('queueId');
    const where: Record<string, unknown> = {};

    if (authResult.source === 'client' && authResult.client.allowedQueueIds.length > 0) {
        where.queueId = { in: authResult.client.allowedQueueIds };
    }
    if (queueId) {
        if (authResult.source === 'client' && authResult.client.allowedQueueIds.length > 0 && !authResult.client.allowedQueueIds.includes(queueId)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        where.queueId = queueId;
    }

    const tickets = await prisma.ticket.findMany({
        where: where as any,
        include: {
            queue: { select: { name: true } },
            requester: { select: { name: true, email: true } },
            assignee: { select: { name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
    });

    return NextResponse.json({ tickets });
}

// POST /api/v1/tickets - Create ticket on behalf of user
export async function POST(req: NextRequest) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }

    const authResult = await authenticateApiRequest(req, 'tickets:write');
    if (!authResult.ok) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!checkRateLimit('api:v1:tickets', 50, 60000)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    try {
        const body = await req.json();
        const { title, description, queueId, userEmail, priority, categoryId } = body;

        if (!title || !queueId || !userEmail) {
            return NextResponse.json({ error: 'title, queueId, and userEmail are required' }, { status: 400 });
        }
        if (
            authResult.source === 'client' &&
            authResult.client.allowedQueueIds.length > 0 &&
            !authResult.client.allowedQueueIds.includes(queueId)
        ) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Find or create user
        let user = await prisma.user.findUnique({ where: { email: userEmail } });
        if (!user) {
            user = await prisma.user.create({
                data: { email: userEmail, name: userEmail.split('@')[0], role: 'USER' },
            });
        }

        // Generate key
        const year = new Date().getFullYear();
        const nextCount = await reserveNextTicketCount(year);
        const ticketKey = generateTicketKey(year, nextCount);

        const ticket = await prisma.ticket.create({
            data: {
                key: ticketKey,
                title,
                description: description ? sanitizeHtml(description) : null,
                queueId,
                requesterId: user.id,
                priority: priority || 'NORMAL',
                categoryId,
                status: 'NEW',
            },
        });

        await prisma.timelineEvent.create({
            data: {
                ticketId: ticket.id,
                userId: user.id,
                type: 'CREATED',
                content: `Ticket created via API: ${title}`,
            },
        });

        fireWebhook('ticket.created', { ticketId: ticket.id, key: ticketKey, title });

        return NextResponse.json(ticket, { status: 201 });
    } catch (error) {
        logger.error('API v1 ticket creation failed', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
