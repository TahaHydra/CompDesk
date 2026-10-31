import { NextRequest, NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { getAdministeredQueueIds, isAdminRole, isAgentRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { normalizeTagScopes, tagAvailabilityWhere, type TagScopeRule } from '@/lib/tag-scope';
import { createTagSchema, updateTagSchema } from '@/lib/validations';

const SCOPE_SELECT = { queueId: true, categoryId: true, queue: { select: { name: true } }, category: { select: { name: true } } } as const;

class TagRequestError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

type TagAvailability = { allDepartments: boolean; scopes: TagScopeRule[] };

/** A department Admin manages a tag only when every place it is available is a department they administer. */
function managesTag(role: Role, administered: Set<string>, tag: TagAvailability): boolean {
    if (role === 'SUPER_ADMIN') return true;
    return role === 'ADMIN' && !tag.allDepartments && tag.scopes.length > 0 && tag.scopes.every((scope) => administered.has(scope.queueId));
}

async function administeredQueues(userId: string, role: Role): Promise<Set<string>> {
    return role === 'ADMIN' ? new Set(await getAdministeredQueueIds(userId)) : new Set();
}

/** Departments must exist and each category must belong to its department. */
async function resolveScopes(allDepartments: boolean, requested: Array<{ queueId: string; categoryId?: string | null }>): Promise<TagScopeRule[]> {
    if (allDepartments) return [];
    const scopes = normalizeTagScopes(requested.map((scope) => ({ queueId: scope.queueId, categoryId: scope.categoryId ?? null })));
    if (scopes.length === 0) throw new TagRequestError('Choose at least one department, or make the tag available in all departments.');
    const queueIds = [...new Set(scopes.map((scope) => scope.queueId))];
    const categoryIds = scopes.flatMap((scope) => scope.categoryId ? [scope.categoryId] : []);
    const [queues, categories] = await Promise.all([
        prisma.queue.findMany({ where: { id: { in: queueIds } }, select: { id: true } }),
        categoryIds.length ? prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, queueId: true } }) : Promise.resolve([]),
    ]);
    if (queues.length !== queueIds.length) throw new TagRequestError('One or more departments do not exist.');
    const categoryQueue = new Map(categories.map((category) => [category.id, category.queueId]));
    if (scopes.some((scope) => scope.categoryId && categoryQueue.get(scope.categoryId) !== scope.queueId)) {
        throw new TagRequestError('Each category must belong to the department it is listed under.');
    }
    return scopes;
}

/** Names are unique regardless of case, so "VPN" and "vpn" can never become two different tags. */
async function assertNameAvailable(name: string, role: Role, administered: Set<string>, exceptId?: string) {
    const existing = await prisma.tag.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
        select: { name: true, allDepartments: true, scopes: { select: { queueId: true, categoryId: true } } },
    });
    if (existing) {
        const advice = managesTag(role, administered, existing) ? 'Edit where it is available instead of creating another one.' : 'Ask a Super Admin to make it available in your department.';
        throw new TagRequestError(`A tag named "${existing.name}" already exists. ${advice}`, 409);
    }
}

function errorResponse(error: unknown, action: string) {
    if (error instanceof TagRequestError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return NextResponse.json({ error: 'Tag name already exists' }, { status: 409 });
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    logger.error(`Failed to ${action} tag`, { error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/**
 * GET /api/tags — every tag, or with ?queueId (and optional ?categoryId) only the tags that can be added
 * there. Staff also receive where each tag is available; ?manage=true adds usage counts and whether
 * the caller may edit it (administrators only).
 */
export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { role } = session.user;
        const params = new URL(req.url).searchParams;
        const queueId = params.get('queueId') || undefined;
        const categoryId = params.has('categoryId') ? params.get('categoryId') || null : undefined;
        const manage = params.get('manage') === 'true';
        if (manage && !isAdminRole(role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const tags = await prisma.tag.findMany({
            where: queueId ? tagAvailabilityWhere(queueId, categoryId) : undefined,
            include: {
                scopes: { select: SCOPE_SELECT },
                ...(manage ? { _count: { select: { tickets: true } } } : {}),
            },
            orderBy: { name: 'asc' },
        });
        if (!isAgentRole(role)) return NextResponse.json(tags.map(({ id, name, color }) => ({ id, name, color })));

        const administered = manage ? await administeredQueues(session.user.id, role) : new Set<string>();
        return NextResponse.json(tags.map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            allDepartments: tag.allDepartments,
            scopes: tag.scopes.map((scope) => ({ queueId: scope.queueId, categoryId: scope.categoryId, queueName: scope.queue.name, categoryName: scope.category?.name ?? null })),
            ...(manage ? { ticketCount: (tag as typeof tag & { _count?: { tickets: number } })._count?.tickets ?? 0, canManage: managesTag(role, administered, tag) } : {}),
        })));
    } catch (error) {
        return errorResponse(error, 'fetch');
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = createTagSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        const { name, color, allDepartments } = parsed.data;
        const scopes = await resolveScopes(allDepartments, parsed.data.scopes);
        const administered = await administeredQueues(session.user.id, session.user.role);
        if (!managesTag(session.user.role, administered, { allDepartments, scopes })) {
            return NextResponse.json({ error: 'Department administrators can only create tags limited to departments they administer.' }, { status: 403 });
        }
        await assertNameAvailable(name, session.user.role, administered);
        const tag = await prisma.tag.create({ data: { name, color, allDepartments, scopes: { create: scopes } } });
        await auditLog({ userId: session.user.id, action: 'tag.created', entity: 'tag', entityId: tag.id, metadata: { name, allDepartments, scopes } });
        return NextResponse.json(tag, { status: 201 });
    } catch (error) {
        return errorResponse(error, 'create');
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = updateTagSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        const { id, name, color } = parsed.data;

        const existing = await prisma.tag.findUnique({ where: { id }, include: { scopes: { select: { queueId: true, categoryId: true } } } });
        if (!existing) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
        const administered = await administeredQueues(session.user.id, session.user.role);
        if (!managesTag(session.user.role, administered, existing)) {
            return NextResponse.json({ error: 'This tag is also used outside the departments you administer. Ask a Super Admin to change it.' }, { status: 403 });
        }

        const availabilityChanged = parsed.data.allDepartments !== undefined || parsed.data.scopes !== undefined;
        const allDepartments = parsed.data.allDepartments ?? existing.allDepartments;
        const scopes = availabilityChanged
            ? await resolveScopes(allDepartments, parsed.data.scopes ?? existing.scopes)
            : existing.scopes;
        if (availabilityChanged && !managesTag(session.user.role, administered, { allDepartments, scopes })) {
            return NextResponse.json({ error: 'Department administrators can only limit tags to departments they administer.' }, { status: 403 });
        }
        if (name !== undefined && name.toLowerCase() !== existing.name.toLowerCase()) await assertNameAvailable(name, session.user.role, administered, id);

        // Narrowing availability never removes the tag from tickets that already carry it.
        const tag = await prisma.$transaction(async (tx) => {
            if (availabilityChanged) {
                await tx.tagScope.deleteMany({ where: { tagId: id } });
                if (scopes.length) await tx.tagScope.createMany({ data: scopes.map((scope) => ({ tagId: id, queueId: scope.queueId, categoryId: scope.categoryId })) });
            }
            return tx.tag.update({ where: { id }, data: { ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}), ...(availabilityChanged ? { allDepartments } : {}) } });
        });
        await auditLog({ userId: session.user.id, action: 'tag.updated', entity: 'tag', entityId: id, metadata: { name, color, ...(availabilityChanged ? { allDepartments, scopes } : {}) } });
        return NextResponse.json(tag);
    } catch (error) {
        return errorResponse(error, 'update');
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const id = new URL(req.url).searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

        const existing = await prisma.tag.findUnique({ where: { id }, include: { scopes: { select: { queueId: true, categoryId: true } } } });
        if (!existing) return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
        if (!managesTag(session.user.role, await administeredQueues(session.user.id, session.user.role), existing)) {
            return NextResponse.json({ error: 'This tag is also used outside the departments you administer. Ask a Super Admin to delete it.' }, { status: 403 });
        }
        const removedFromTickets = await prisma.ticketTag.count({ where: { tagId: id } });
        await prisma.tag.delete({ where: { id } });
        await auditLog({ userId: session.user.id, action: 'tag.deleted', entity: 'tag', entityId: id, metadata: { name: existing.name, removedFromTickets } });
        return NextResponse.json({ success: true, removedFromTickets });
    } catch (error) {
        return errorResponse(error, 'delete');
    }
}
