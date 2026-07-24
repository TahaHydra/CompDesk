import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
    canAccessQueue,
    canAdministerQueue,
    getAdministeredQueueIds,
    isAdminRole,
} from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createCategorySchema, updateCategorySchema } from '@/lib/validations';
import logger from '@/lib/logger';

async function validateTemplateAssignment(templateId: string | null | undefined) {
    if (!templateId) return true;
    return Boolean(await prisma.ticketFormTemplate.findFirst({
        where: { id: templateId, isActive: true, archivedAt: null },
        select: { id: true },
    }));
}

export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const url = new URL(req.url);
        const queueId = url.searchParams.get('queueId');
        const admin = isAdminRole(session.user.role);
        const where: Prisma.CategoryWhereInput = {};

        if (session.user.role === 'SUPER_ADMIN') {
            if (queueId) where.queueId = queueId;
        } else if (session.user.role === 'ADMIN') {
            const queueIds = await getAdministeredQueueIds(session.user.id);
            if (queueId && !queueIds.includes(queueId)) {
                return NextResponse.json({ error: 'You do not administer this department' }, { status: 403 });
            }
            where.queueId = queueId ?? { in: queueIds };
        } else {
            if (!queueId) return NextResponse.json({ error: 'queueId is required' }, { status: 400 });
            if (session.user.role === 'AGENT') {
                if (!(await canAccessQueue(session.user.id, session.user.role, queueId))) {
                    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
                }
            } else {
                const queue = await prisma.queue.findFirst({
                    where: { id: queueId, isActive: true, isPublic: true },
                    select: { id: true },
                });
                if (!queue) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
            }
            where.queueId = queueId;
        }

        const includeInactive = admin && url.searchParams.get('includeInactive') === 'true';
        if (!includeInactive) Object.assign(where, { isActive: true, archivedAt: null });
        const categories = await prisma.category.findMany({
            where,
            include: {
                queue: { select: { id: true, name: true, defaultTemplateId: true } },
                template: { select: { id: true, name: true, isActive: true, archivedAt: true } },
                _count: { select: { tickets: true } },
            },
            orderBy: [{ queue: { name: 'asc' } }, { name: 'asc' }],
        });
        return NextResponse.json(categories);
    } catch (error) {
        logger.error('Failed to fetch categories', { error });
        return NextResponse.json({ error: 'Failed to load categories' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can create categories' }, { status: 403 });
        }
        const parsed = createCategorySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Category validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const queue = await prisma.queue.findUnique({ where: { id: parsed.data.queueId }, select: { id: true } });
        if (!queue) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
        if (!(await validateTemplateAssignment(parsed.data.templateId))) {
            return NextResponse.json({ error: 'Category overrides must use an active template' }, { status: 400 });
        }
        const category = await prisma.category.create({
            data: { ...parsed.data, archivedAt: parsed.data.isActive ? null : new Date() },
            include: { queue: { select: { id: true, name: true } }, template: { select: { id: true, name: true } } },
        });
        await auditLog({
            userId: session.user.id,
            action: 'category.created',
            entity: 'category',
            entityId: category.id,
            metadata: { queueId: category.queueId, templateId: category.templateId },
        });
        return NextResponse.json(category, { status: 201 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return NextResponse.json({ error: 'That category name already exists in this department' }, { status: 409 });
        }
        logger.error('Failed to create category', { error });
        return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const parsed = updateCategorySchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Category validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const { id, ...changes } = parsed.data;
        const existing = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
        if (!existing) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

        if (session.user.role === 'ADMIN') {
            if (!(await canAdministerQueue(session.user.id, session.user.role, existing.queueId))) {
                return NextResponse.json({ error: 'You do not administer this category department' }, { status: 403 });
            }
            const disallowedFields = Object.keys(changes).filter((key) => key !== 'templateId');
            if (disallowedFields.length > 0) {
                return NextResponse.json({ error: 'Department administrators may only assign the category ticket form' }, { status: 403 });
            }
        }

        if (changes.queueId && changes.queueId !== existing.queueId && existing._count.tickets > 0) {
            return NextResponse.json({ error: 'A category with historical tickets cannot be moved to another department' }, { status: 409 });
        }
        if (changes.queueId && !(await prisma.queue.findUnique({ where: { id: changes.queueId }, select: { id: true } }))) {
            return NextResponse.json({ error: 'Department not found' }, { status: 404 });
        }
        if (Object.prototype.hasOwnProperty.call(changes, 'templateId') && !(await validateTemplateAssignment(changes.templateId))) {
            return NextResponse.json({ error: 'Category overrides must use an active template' }, { status: 400 });
        }
        const category = await prisma.category.update({
            where: { id },
            data: {
                ...changes,
                ...(changes.isActive !== undefined ? { archivedAt: changes.isActive ? null : new Date() } : {}),
            },
            include: { queue: { select: { id: true, name: true } }, template: { select: { id: true, name: true } }, _count: { select: { tickets: true } } },
        });
        const moved = changes.queueId && changes.queueId !== existing.queueId;
        const templateChanged = Object.prototype.hasOwnProperty.call(changes, 'templateId') && changes.templateId !== existing.templateId;
        const archived = changes.isActive === false;
        await auditLog({
            userId: session.user.id,
            action: moved ? 'category.moved' : archived ? 'category.archived' : templateChanged ? 'category.template_override_assigned' : 'category.updated',
            entity: 'category',
            entityId: id,
            metadata: { previousQueueId: existing.queueId, queueId: category.queueId, templateId: category.templateId },
        });
        return NextResponse.json(category);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return NextResponse.json({ error: 'That category name already exists in this department' }, { status: 409 });
        }
        logger.error('Failed to update category', { error });
        return NextResponse.json({ error: 'Failed to update category' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can remove categories' }, { status: 403 });
        }
        const url = new URL(req.url);
        const id = url.searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        const category = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { tickets: true } } } });
        if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
        const hard = url.searchParams.get('mode') === 'hard';
        if (hard && category._count.tickets > 0) {
            return NextResponse.json({ error: 'Categories referenced by tickets must be archived, not deleted' }, { status: 409 });
        }
        if (hard) await prisma.category.delete({ where: { id } });
        else await prisma.category.update({ where: { id }, data: { isActive: false, archivedAt: new Date() } });
        await auditLog({
            userId: session.user.id,
            action: hard ? 'category.deleted' : 'category.archived',
            entity: 'category',
            entityId: id,
            metadata: { ticketCount: category._count.tickets, queueId: category.queueId },
        });
        return NextResponse.json({ success: true, archived: !hard });
    } catch (error) {
        logger.error('Failed to remove category', { error });
        return NextResponse.json({ error: 'Failed to remove category' }, { status: 500 });
    }
}