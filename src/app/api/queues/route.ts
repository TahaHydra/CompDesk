import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { getAgentAccessibleQueueIds, isAdminRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createQueueSchema, updateQueueSchema } from '@/lib/validations';
import logger from '@/lib/logger';

async function activeTemplateExists(id: string | null | undefined) {
    if (!id) return true;
    return Boolean(await prisma.ticketFormTemplate.findFirst({ where: { id, isActive: true, archivedAt: null }, select: { id: true } }));
}

export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const url = new URL(req.url);
        const admin = isAdminRole(session.user.role);
        const where: Prisma.QueueWhereInput = {};
        if (!admin || url.searchParams.get('includeInactive') !== 'true') where.isActive = true;
        if (!admin) {
            if (session.user.role === 'AGENT') {
                const queueIds = await getAgentAccessibleQueueIds(session.user.id);
                where.id = { in: queueIds };
            } else {
                where.isPublic = true;
            }
        }
        const queues = await prisma.queue.findMany({
            where,
            include: {
                _count: { select: { tickets: true, categories: true } },
                groups: { include: { group: { select: { id: true, name: true } } } },
                defaultTemplate: { select: { id: true, name: true, isActive: true, archivedAt: true } },
            },
            orderBy: { name: 'asc' },
        });
        return NextResponse.json(queues);
    } catch (error) {
        logger.error('Failed to fetch departments', { error });
        return NextResponse.json({ error: 'Failed to load departments' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = createQueueSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Department validation failed', details: parsed.error.flatten() }, { status: 400 });
        if (!(await activeTemplateExists(parsed.data.defaultTemplateId))) {
            return NextResponse.json({ error: 'The selected default template is not active' }, { status: 400 });
        }
        const queue = await prisma.queue.create({ data: parsed.data });
        await auditLog({ userId: session.user.id, action: 'department.created', entity: 'queue', entityId: queue.id, metadata: { defaultTemplateId: queue.defaultTemplateId } });
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
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = updateQueueSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Department validation failed', details: parsed.error.flatten() }, { status: 400 });
        const { id, ...changes } = parsed.data;
        const existing = await prisma.queue.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: 'Department not found' }, { status: 404 });
        if (Object.prototype.hasOwnProperty.call(changes, 'defaultTemplateId') && !(await activeTemplateExists(changes.defaultTemplateId))) {
            return NextResponse.json({ error: 'The selected default template is not active' }, { status: 400 });
        }
        const queue = await prisma.queue.update({
            where: { id },
            data: changes,
            include: { defaultTemplate: { select: { id: true, name: true } }, _count: { select: { tickets: true, categories: true } } },
        });
        const templateChanged = Object.prototype.hasOwnProperty.call(changes, 'defaultTemplateId') && existing.defaultTemplateId !== changes.defaultTemplateId;
        await auditLog({
            userId: session.user.id,
            action: templateChanged ? 'department.template_assigned' : 'department.updated',
            entity: 'queue',
            entityId: id,
            metadata: { previousTemplateId: existing.defaultTemplateId, defaultTemplateId: queue.defaultTemplateId },
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
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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