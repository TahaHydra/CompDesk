import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessTicket, isAgentRole } from '@/lib/permissions';

async function authorize(ticketId: string) {
    const session = await auth();
    if (!session?.user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!isAgentRole(session.user.role)) {
        return { error: NextResponse.json({ error: 'Viewer presence is available to staff only' }, { status: 403 }) };
    }
    const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, queueId: true, requesterId: true },
    });
    if (!ticket) return { error: NextResponse.json({ error: 'Ticket not found' }, { status: 404 }) };
    if (!(await canAccessTicket(session.user.id, session.user.role, ticket))) {
        return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { session, ticket };
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const authorization = await authorize(id);
    if ('error' in authorization) return authorization.error;
    const now = new Date();
    await prisma.$transaction([
        prisma.ticketPresence.deleteMany({
            where: { lastSeenAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
        }),
        prisma.ticketPresence.upsert({
            where: { ticketId_userId: { ticketId: id, userId: authorization.session.user.id } },
            create: { ticketId: id, userId: authorization.session.user.id, lastSeenAt: now },
            update: { lastSeenAt: now },
        }),
    ]);
    return NextResponse.json({ active: true, lastSeenAt: now, exclusive: false });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const authorization = await authorize(id);
    if ('error' in authorization) return authorization.error;
    await prisma.ticketPresence.deleteMany({
        where: { ticketId: id, userId: authorization.session.user.id },
    });
    return NextResponse.json({ active: false, exclusive: false });
}
