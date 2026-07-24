import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import {
    canAdministerQueue,
    getAdministeredQueueIds,
    getAgentAccessibleQueueIds,
    getQueueInboxQueueIds,
    isAdminRole,
} from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createQueueSchema, updateQueueSchema } from '@/lib/validations';
import logger from '@/lib/logger';

const queueInclude = {
    _count: { select: { tickets: true, categories: true } },
    groups: { include: { group: { select: { id: true, name: true } } } },
    members: {
        where: { role: 'admin' },
        select: { id: true, role: true, user: { select: { id: true, name: true, email: true, role: true, isActive: true } } },
    },
    defaultTemplate: { select: { id: true, name: true, isActive: true, archivedAt: true } },
} satisfies Prisma.QueueInclude;

async function activeTemplateExists(id: string | null | undefined) {
    if (!id) return true;
    return Boolean(await prisma.ticketFormTemplate.findFirst({
        where: { id, isActive: true, archivedAt: null },
        select: { id: true },
    }));
}

export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const url = new URL(req.url);
        const includeInactive = url.searchParams.get('includeInactive') === 'true';
        const accessible = url.searchParams.get('accessible') === 'true';
        const where: Prisma.QueueWhereInput = {};

        if (session.user.role === 'SUPER_ADMIN') {
            if (!includeInactive) where.isActive = true;
        } else if (session.user.role === 'ADMIN') {
            const queueIds = accessible
                ? await getQueueInboxQueueIds(session.user.id, session.user.role) ?? []
                : await getAdministeredQueueIds(session.user.id);
            where.id = { in: queueIds };
            if (!includeInactive) where.isActive = true;
        } else if (session.user.role === 'AGENT') {
            where.id = { in: await getAgentAccessibleQueueIds(session.user.id) };
            where.isActive = true;
        } else {
            where.isPublic = true;
            where.isActive = true;
        }

        const queues = await prisma.queue.findMany({ where, include: queueInclude, orderBy: { name: 'asc' } });
        const administrativeView = session.user.role === 'SUPER_ADMIN'
            || (session.user.role === 'ADMIN' && !accessible);
        if (administrativeView) return NextResponse.json(queues);
        return NextResponse.json(queues.map((queue) => ({
            id: queue.id,
            name: queue.name,
            description: queue.description,
            isActive: queue.isActive,
            isPublic: queue.isPublic,
        })));
    } catch (error) {
        logger.error('Failed to fetch departments', { error });
        return NextResponse.json({ error: 'Failed to load departments' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can create departments' }, { status: 403 });
        }
        const parsed = createQueueSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Department validation failed', details: parsed.error.flatten() }, { status: 400 });
        if (!(await activeTemplateExists(parsed.data.defaultTemplateId))) {
            return NextResponse.json({ error: 'The selected default template is not active' }, { status: 400 });
        }
        const queue = await prisma.queue.create({ data: parsed.data, include: queueInclude });
        await auditLog({
            userId: session.user.id,
            action: 'department.created',
            entity: 'queue',
            entityId: queue.id,
            metadata: { defaultTemplateId: queue.defaultTemplateId },
        });
        return NextResponse.json(queue, { status: 201 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return NextResponse.json({ error: 'Department name already exists' }, { status: 409 });
        }
        logger.error('Failed to create department', { error });
        return NextResponse.json({ error: 'Failed to create department' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const parsed = updateQueueSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Department validation failed', details: parsed.error.flatten() }, { status: 400 });
        const { id, administratorIds, ...changes } = parsed.data;
        const existing = await prisma.queue.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 });

        if (session.user.role === 'ADMIN') {
            if (!(await canAdministerQueue(session.user.id, session.user.role, id))) {
                return NextResponse.json({ error: 'You do not administer this department' }, { status: 403 });
            }
            const disallowedFields = Object.keys(changes).filter((key) => key !== 'defaultTemplateId');
            if (administratorIds !== undefined || disallowedFields.length > 0) {
                return NextResponse.json({ error: 'Department administrators may only assign the default ticket form' }, { status: 403 });
            }
        }

        if (Object.prototype.hasOwnProperty.call(changes, 'defaultTemplateId') && !(await activeTemplateExists(changes.defaultTemplateId))) {
            return NextResponse.json({ error: 'The selected default template is not active' }, { status: 400 });
        }

        const uniqueAdministratorIds = administratorIds === undefined ? undefined : [...new Set(administratorIds)];
        if (uniqueAdministratorIds?.length) {
            const validAdministratorCount = await prisma.user.count({
                where: { id: { in: uniqueAdministratorIds }, role: 'ADMIN', isActive: true },
            });
            if (validAdministratorCount !== uniqueAdministratorIds.length) {
                return NextResponse.json({ error: 'Department administrators must be active users with the ADMIN role' }, { status: 400 });
            }
        }

        const queue = await prisma.$transaction(async (tx) => {
            if (uniqueAdministratorIds !== undefined) {
                await tx.queueMember.deleteMany({ where: { queueId: id, role: 'admin' } });
                if (uniqueAdministratorIds.length) {
                    await tx.queueMember.createMany({
                        data: uniqueAdministratorIds.map((userId) => ({ queueId: id, userId, role: 'admin' })),
                        skipDuplicates: true,
                    });
                }
            }
            return tx.queue.update({ where: { id }, data: changes, include: queueInclude });
        });

        const templateChanged = Object.prototype.hasOwnProperty.call(changes, 'defaultTemplateId')
            && existing.defaultTemplateId !== changes.defaultTemplateId;
        const administratorsChanged = uniqueAdministratorIds !== undefined;
        await auditLog({
            userId: session.user.id,
            action: administratorsChanged
                ? 'department.administrators_assigned'
                : templateChanged ? 'department.template_assigned' : 'department.updated',
            entity: 'queue',
            entityId: id,
            metadata: {
                previousTemplateId: existing.defaultTemplateId,
                defaultTemplateId: queue.defaultTemplateId,
                administratorIds: uniqueAdministratorIds,
            },
        });
        return NextResponse.json(queue);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return NextResponse.json({ error: 'Department name already exists' }, { status: 409 });
        }
        logger.error('Failed to update department', { error });
        return NextResponse.json({ error: 'Failed to update department' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Only super administrators can delete departments' }, { status: 403 });
        }
        const id = new URL(req.url).searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        const queue = await prisma.queue.findUnique({ where: { id }, include: { _count: { select: { tickets: true, categories: true } } } });
        if (!queue) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
        if (queue._count.tickets > 0 || queue._count.categories > 0) {
            return NextResponse.json({ error: 'Archive this department or reassign its tickets and categories before deletion' }, { status: 409 });
        }
        await prisma.queue.delete({ where: { id } });
        await auditLog({ userId: session.user.id, action: 'department.deleted', entity: 'queue', entityId: id });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete department', { error });
        return NextResponse.json({ error: 'Failed to delete department' }, { status: 500 });
    }
}