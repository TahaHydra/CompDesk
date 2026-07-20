import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sanitizeHtml } from '@/lib/utils';
import logger from '@/lib/logger';
import { authenticateApiRequest } from '@/lib/api-clients';
import { getFeatureFlag } from '@/lib/feature-flags';

// POST /api/v1/tickets/[id]/notes - Append internal note
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    if (!(await getFeatureFlag('feature_external_api_enabled'))) {
        return NextResponse.json({ error: 'External API is disabled' }, { status: 403 });
    }

    const authResult = await authenticateApiRequest(req, 'tickets:write');
    if (!authResult.ok) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const { id } = await params;
        const { content, authorEmail } = await req.json();

        if (!content) {
            return NextResponse.json({ error: 'content is required' }, { status: 400 });
        }

        const ticket = await prisma.ticket.findUnique({ where: { id } });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }
        if (
            authResult.source === 'client' &&
            authResult.client.allowedQueueIds.length > 0 &&
            !authResult.client.allowedQueueIds.includes(ticket.queueId)
        ) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Find author or use system
        let userId = ticket.requesterId;
        if (authorEmail) {
            const author = await prisma.user.findUnique({ where: { email: authorEmail } });
            if (author) userId = author.id;
        }

        const event = await prisma.timelineEvent.create({
            data: {
                ticketId: id,
                userId,
                type: 'INTERNAL_NOTE',
                content: sanitizeHtml(content),
            },
        });

        return NextResponse.json(event, { status: 201 });
    } catch (error) {
        logger.error('API v1 note creation failed', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
