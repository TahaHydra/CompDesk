import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAgentAccessibleQueueIds, getQueueInboxQueueIds } from '@/lib/permissions';

// GET /api/notifications — fetch recent activity for the current user
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const userId = session.user.id;
        const role = session.user.role;

        // Get the user's last-read timestamp from app settings
        const lastReadSetting = await prisma.appSetting.findUnique({
            where: { key: `notifications_read_${userId}` },
        });
        const lastReadAt = lastReadSetting ? new Date(lastReadSetting.value) : new Date(0);

        // Build the where clause based on role
        let ticketFilter: Prisma.TicketWhereInput = {};

        if (role === 'USER') {
            // End users see notifications for tickets they submitted
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
        } else {
            // SUPER_ADMIN sees all recent activity.
            ticketFilter = {};
        }

        // Fetch recent timeline events (excluding the user's own actions)
        const items = await prisma.timelineEvent.findMany({
            where: {
                ticket: ticketFilter,
                userId: { not: userId }, // Don't show the user's own actions
                ...(role === 'USER' ? { type: { not: 'INTERNAL_NOTE' as const } } : {}),
            },
            include: {
                user: { select: { name: true } },
                ticket: { select: { id: true, key: true, title: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });

        // Count unread
        const unreadCount = items.filter(item => item.createdAt > lastReadAt).length;

        return NextResponse.json({
            items: items.map(item => ({
                id: item.id,
                type: item.type,
                content: item.content,
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

// POST /api/notifications — mark all as read
export async function POST() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const key = `notifications_read_${session.user.id}`;
        await prisma.appSetting.upsert({
            where: { key },
            update: { value: new Date().toISOString() },
            create: { key, value: new Date().toISOString() },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Failed to mark notifications as read', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
