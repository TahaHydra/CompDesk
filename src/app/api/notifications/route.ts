import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAgentAccessibleQueueIds, getQueueInboxQueueIds } from '@/lib/permissions';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const userId = session.user.id;
        const role = session.user.role;
        const lastReadSetting = await prisma.appSetting.findUnique({ where: { key: `notifications_read_${userId}` } });
        const parsedLastRead = lastReadSetting ? new Date(lastReadSetting.value) : new Date(0);
        const lastReadAt = Number.isNaN(parsedLastRead.getTime()) ? new Date(0) : parsedLastRead;

        let ticketFilter: Prisma.TicketWhereInput = {};
        if (role === 'USER') {
            ticketFilter = { requesterId: userId };
        } else if (role === 'AGENT') {
            const departmentIds = await getAgentAccessibleQueueIds(userId);
            ticketFilter = {
                OR: [
                    { requesterId: userId },
                    ...(departmentIds.length ? [{ queueId: { in: departmentIds } }] : []),
                ],
            };
        } else if (role === 'ADMIN') {
            const departmentIds = await getQueueInboxQueueIds(userId, role);
            ticketFilter = departmentIds?.length
                ? { queueId: { in: departmentIds } }
                : { queueId: { in: ['__none__'] } };
        }

        const eventFilter: Prisma.TimelineEventWhereInput = {
            ticket: ticketFilter,
            userId: { not: userId },
            ...(role === 'USER' ? { type: { not: 'INTERNAL_NOTE' as const } } : {}),
        };
        const [items, unreadCount] = await Promise.all([
            prisma.timelineEvent.findMany({
                where: eventFilter,
                include: {
                    user: { select: { name: true } },
                    ticket: { select: { id: true, key: true, title: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 20,
            }),
            prisma.timelineEvent.count({
                where: { ...eventFilter, createdAt: { gt: lastReadAt } },
            }),
        ]);

        return NextResponse.json({
            items: items.map((item) => ({
                id: item.id,
                type: item.type,
                content: item.deletedAt && role !== 'SUPER_ADMIN' ? '[Deleted comment]' : item.content,
                createdAt: item.createdAt,
                userName: item.user.name,
                ticketId: item.ticket.id,
                ticketKey: item.ticket.key,
                ticketTitle: item.ticket.title,
            })),
            unreadCount,
        });
    } catch (error) {
        console.error('Failed to fetch notifications', error);
        return NextResponse.json({ items: [], unreadCount: 0 });
    }
}

export async function POST() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const key = `notifications_read_${session.user.id}`;
        const value = new Date().toISOString();
        await prisma.appSetting.upsert({
            where: { key },
            update: { value },
            create: { key, value },
        });
        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to mark notifications as read', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
