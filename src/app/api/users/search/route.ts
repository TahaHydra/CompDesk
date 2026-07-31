import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getQueueInboxQueueIds } from '@/lib/permissions';
import logger from '@/lib/logger';

const EMPTY_SCOPE = ['__none__'];

export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) ?? '';
        const kind = request.nextUrl.searchParams.get('kind') === 'assignee' ? 'assignee' : 'requester';
        const queueId = request.nextUrl.searchParams.get('queueId')?.trim() || null;
        const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10);
        const limit = Math.min(20, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 20));
        const role = session.user.role;
        const accessibleQueueIds = role === 'SUPER_ADMIN'
            ? null
            : await getQueueInboxQueueIds(session.user.id, role) ?? [];

        if (queueId && accessibleQueueIds && !accessibleQueueIds.includes(queueId)) {
            return NextResponse.json({ error: 'Department is outside your authorized scope' }, { status: 403 });
        }
        if (role === 'USER') {
            const own = await prisma.user.findUnique({
                where: { id: session.user.id },
                select: { id: true, name: true, email: true, role: true },
            });
            return NextResponse.json(own && kind === 'requester' ? [{ ...own, departmentNames: [] }] : []);
        }

        const scopeQueueIds = queueId ? [queueId] : accessibleQueueIds;
        const textWhere: Prisma.UserWhereInput = query
            ? { OR: [
                { id: query },
                { name: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
            ] }
            : {};
        let relevance: Prisma.UserWhereInput;
        if (kind === 'assignee') {
            relevance = {
                isActive: true,
                role: { in: ['AGENT', 'ADMIN', 'SUPER_ADMIN'] },
                ...(scopeQueueIds ? {
                    OR: [
                        { role: 'SUPER_ADMIN' },
                        { queueMemberships: { some: { queueId: { in: scopeQueueIds.length ? scopeQueueIds : EMPTY_SCOPE }, role: { in: ['agent', 'admin'] } } } },
                        { groupMemberships: { some: { group: { queueAssignments: { some: { queueId: { in: scopeQueueIds.length ? scopeQueueIds : EMPTY_SCOPE }, role: { in: ['agent', 'admin'] } } } } } } },
                    ],
                } : {}),
            };
        } else {
            relevance = {
                requestedTickets: {
                    some: scopeQueueIds ? { queueId: { in: scopeQueueIds.length ? scopeQueueIds : EMPTY_SCOPE } } : {},
                },
            };
        }

        const users = await prisma.user.findMany({
            where: { AND: [textWhere, relevance] },
            select: {
                id: true, name: true, email: true, role: true,
                queueMemberships: {
                    where: scopeQueueIds ? { queueId: { in: scopeQueueIds.length ? scopeQueueIds : EMPTY_SCOPE } } : {},
                    select: { queueId: true, queue: { select: { name: true } } },
                },
                groupMemberships: {
                    where: scopeQueueIds ? { group: { queueAssignments: { some: { queueId: { in: scopeQueueIds.length ? scopeQueueIds : EMPTY_SCOPE } } } } } : {},
                    select: { group: { select: { queueAssignments: {
                        where: scopeQueueIds ? { queueId: { in: scopeQueueIds.length ? scopeQueueIds : EMPTY_SCOPE } } : {},
                        select: { queueId: true, queue: { select: { name: true } } },
                    } } } },
                },
            },
            orderBy: [{ name: 'asc' }, { email: 'asc' }],
            take: limit,
        });
        return NextResponse.json(users.map((user) => ({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            departmentNames: [...new Set([
                ...user.queueMemberships.map((membership) => membership.queue.name),
                ...user.groupMemberships.flatMap((membership) => membership.group.queueAssignments.map((assignment) => assignment.queue.name)),
            ])].sort(),
        })));
    } catch (error) {
        logger.error('Failed to search scoped users', { error });
        return NextResponse.json({ error: 'Failed to search users' }, { status: 500 });
    }
}