import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createCommentSchema } from '@/lib/validations';
import { sanitizeHtml, isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail } from '@/lib/email';
import logger from '@/lib/logger';

// POST /api/tickets/[id]/comments
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await req.json();
        const parsed = createCommentSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const { content, isInternal } = parsed.data;

        // Only agents/admins can create internal notes
        if (isInternal && !isAgentOrAbove(session.user.role)) {
            return NextResponse.json({ error: 'Only agents can create internal notes' }, { status: 403 });
        }

        const ticket = await prisma.ticket.findUnique({ where: { id } });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        // RBAC: Users can only comment on their own tickets
        if (session.user.role === 'USER' && ticket.requesterId !== session.user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const event = await prisma.timelineEvent.create({
            data: {
                ticketId: id,
                userId: session.user.id,
                type: isInternal ? 'INTERNAL_NOTE' : 'COMMENT',
                content: sanitizeHtml(content),
            },
            include: {
                user: { select: { id: true, name: true, image: true } },
            },
        });

        // First response tracking
        if (!ticket.firstResponseAt && isAgentOrAbove(session.user.role) && !isInternal) {
            await prisma.ticket.update({
                where: { id },
                data: { firstResponseAt: new Date() },
            });
        }

        // Notify watchers (not for internal notes)
        if (!isInternal) {
            const watchers = await prisma.ticketWatcher.findMany({
                where: { ticketId: id, userId: { not: session.user.id } },
                include: { user: { select: { email: true } } },
            });
            const emails = watchers.map((w) => w.user.email).filter(Boolean);
            if (emails.length > 0) {
                sendTicketUpdatedEmail(emails, ticket.key, ticket.title, 'New Comment', content.substring(0, 200));
            }
        }

        return NextResponse.json(event, { status: 201 });
    } catch (error) {
        logger.error('Failed to create comment', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
