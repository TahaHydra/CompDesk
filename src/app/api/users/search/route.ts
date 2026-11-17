import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getQueueInboxQueueIds } from '@/lib/permissions';
import { redactPerson } from '@/lib/people-privacy';
import { loadPrivacyContext } from '@/lib/people-privacy-server';
import logger from '@/lib/logger';

const EMPTY_SCOPE = ['__none__'];
// How many email-only matches are considered before the visibility filter.
const EMAIL_MATCH_CANDIDATES = 50;

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
        // Name (or exact id) matches and email-only matches are fetched separately, so that people
        // matched only through an email the viewer may not see can never crowd out real name matches.
        const nameWhere: Prisma.UserWhereInput = query
            ? { OR: [{ id: query }, { name: { contains: query, mode: 'insensitive' } }] }
            : {};
        const emailOnlyWhere: Prisma.UserWhereInput | null = query
            ? { email: { contains: query, mode: 'insensitive' }, NOT: nameWhere }
            : null;
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

        const select = {
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
        } satisfies Prisma.UserSelect;
        const orderBy: Prisma.UserOrderByWithRelationInput[] = [{ name: 'asc' }, { email: 'asc' }];
        const [nameMatches, emailMatches] = await Promise.all([
            prisma.user.findMany({ where: { AND: [nameWhere, relevance] }, select, orderBy, take: limit }),
            emailOnlyWhere
                ? prisma.user.findMany({ where: { AND: [emailOnlyWhere, relevance] }, select, orderBy, take: EMAIL_MATCH_CANDIDATES })
                : Promise.resolve([]),
        ]);

        // Contact details follow the people privacy policy, and an email-only match is kept only
        // when the viewer may see that email, so hidden addresses cannot be probed.
        const privacy = await loadPrivacyContext(session.user);
        const present = (user: (typeof nameMatches)[number]) => {
            const queueIds = [...new Set([
                ...user.queueMemberships.map((membership) => membership.queueId),
                ...user.groupMemberships.flatMap((membership) => membership.group.queueAssignments.map((assignment) => assignment.queueId)),
            ])];
            const context = kind === 'requester' ? (scopeQueueIds ?? queueIds) : queueIds;
            return {
                ...redactPerson({ id: user.id, name: user.name, email: user.email, role: user.role }, privacy.policy, privacy.viewer, context),
                departmentNames: [...new Set([
                    ...user.queueMemberships.map((membership) => membership.queue.name),
                    ...user.groupMemberships.flatMap((membership) => membership.group.queueAssignments.map((assignment) => assignment.queue.name)),
                ])].sort(),
            };
        };
        const results = [
            ...nameMatches.map(present),
            ...emailMatches.map(present).filter((user) => 'email' in user),
        ].sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit);
        return NextResponse.json(results);
    } catch (error) {
        logger.error('Failed to search scoped users', { error });
        return NextResponse.json({ error: 'Failed to search users' }, { status: 500 });
    }
}