import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { getFeatureFlag } from '@/lib/feature-flags';
import { parseDashboardLinks } from '@/lib/dashboard-links';
import { getQueueInboxQueueIds } from '@/lib/permissions';
import { broadestTicketView } from '@/lib/ticket-search';

// GET /api/dashboard/stats
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const userId = session.user.id;
        const role = session.user.role;

        let whereClause: Prisma.TicketWhereInput = {};
        if (role === 'USER') {
            whereClause = { requesterId: userId };
        } else if (role !== 'SUPER_ADMIN') {
            const departmentIds = await getQueueInboxQueueIds(userId, role);
            whereClause = departmentIds?.length
                ? { queueId: { in: departmentIds } }
                : { queueId: { in: ['__none__'] } };
        }
        const dashboardLinksEnabled = await getFeatureFlag('feature_dashboard_links_enabled');

        const [total, open, pending, resolved, urgent, recentTickets, escalated, dashboardLinksSetting] = await Promise.all([
            prisma.ticket.count({ where: whereClause }),
            prisma.ticket.count({ where: { ...whereClause, status: { in: ['NEW', 'OPEN'] } } }),
            prisma.ticket.count({ where: { ...whereClause, status: { in: ['PENDING_USER', 'PENDING_AGENT'] } } }),
            prisma.ticket.count({ where: { ...whereClause, status: { in: ['RESOLVED', 'CLOSED'] } } }),
            prisma.ticket.count({ where: { ...whereClause, priority: 'URGENT', status: { notIn: ['CLOSED', 'RESOLVED'] } } }),
            prisma.ticket.findMany({
                where: whereClause,
                include: {
                    queue: { select: { name: true } },
                    requester: { select: { name: true } },
                    assignments: {
                        select: { user: { select: { id: true, name: true } } },
                        orderBy: { assignedAt: 'asc' },
                    },
                },
                orderBy: { updatedAt: 'desc' },
                take: 5,
            }),
            // Count escalated tickets (escalation level > 0 and not resolved)
            prisma.ticket.count({
                where: {
                    ...whereClause,
                    escalationLevel: { gt: 0 },
                    status: { notIn: ['CLOSED', 'RESOLVED'] },
                },
            }).catch(() => 0), // Field doesn't exist yet — graceful fallback
            dashboardLinksEnabled
                ? prisma.appSetting.findUnique({ where: { key: 'dashboard_links' } })
                : Promise.resolve(null)
        ]);

        const customLinks = dashboardLinksEnabled
            ? parseDashboardLinks(dashboardLinksSetting?.value)
            : [];

return NextResponse.json({
            stats: { total, open, pending, resolved, urgent, escalated },
            recentTickets,
            customLinks,
            ticketView: broadestTicketView(role),
        });
    } catch (error) {
        logger.error('Failed to fetch dashboard stats', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
