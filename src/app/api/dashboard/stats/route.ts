import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

// GET /api/dashboard/stats
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const userId = session.user.id;
        const role = session.user.role;

        let whereClause: Record<string, unknown> = {};

        if (role === 'USER') {
            // End users see only their own tickets
            whereClause = { requesterId: userId };
        } else if (role === 'AGENT') {
            // Agents see tickets in their departments (via groups and direct memberships)
            const [groupDepts, directDepts] = await Promise.all([
                prisma.queueGroup.findMany({
                    where: {
                        group: { members: { some: { userId } } },
                        role: 'agent',
                    },
                    select: { queueId: true },
                }),
                prisma.queueMember.findMany({
                    where: { userId },
                    select: { queueId: true },
                })
            ]);
            const deptIds = [...new Set([
                ...groupDepts.map((d: { queueId: string }) => d.queueId),
                ...directDepts.map((d: { queueId: string }) => d.queueId)
            ])];

            if (deptIds.length > 0) {
                whereClause = { queueId: { in: deptIds } };
            } else {
                // Agent not assigned to any department — show only assigned
                whereClause = { assigneeId: userId };
            }
        }
        // ADMIN / SUPER_ADMIN: no filter, see all tickets

        const [total, open, pending, resolved, urgent, recentTickets, escalated, dashboardLinksSetting] = await Promise.all([
            prisma.ticket.count({ where: whereClause }),
            prisma.ticket.count({ where: { ...whereClause, status: { in: ['NEW', 'OPEN'] } } }),
            prisma.ticket.count({ where: { ...whereClause, status: { in: ['PENDING_USER', 'PENDING_AGENT'] } } }),
            prisma.ticket.count({ where: { ...whereClause, status: { in: ['RESOLVED', 'CLOSED'] } } }),
            prisma.ticket.count({ where: { ...whereClause, priority: 'URGENT', status: { notIn: ['CLOSED', 'RESOLVED'] } } }),
            prisma.ticket.findMany({
                where: whereClause as any,
                include: {
                    queue: { select: { name: true } },
                    requester: { select: { name: true } },
                    assignee: { select: { name: true } },
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
                } as any,
            }).catch(() => 0), // Field doesn't exist yet — graceful fallback
            prisma.appSetting.findUnique({ where: { key: 'dashboard_links' } })
        ]);

        let customLinks = [];
        try {
            if (dashboardLinksSetting?.value) {
                customLinks = JSON.parse(dashboardLinksSetting.value);
            }
        } catch {
            logger.warn('Failed to parse dashboard_links JSON');
        }

        return NextResponse.json({
            stats: { total, open, pending, resolved, urgent, escalated },
            recentTickets,
            customLinks,
        });
    } catch (error) {
        logger.error('Failed to fetch dashboard stats', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
