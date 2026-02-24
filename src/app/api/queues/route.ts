import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { createQueueSchema } from '@/lib/validations';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const queues = await prisma.queue.findMany({
            include: {
                _count: { select: { tickets: true } },
                groups: { include: { group: { select: { id: true, name: true } } } },
            },
            orderBy: { name: 'asc' },
        });

        return NextResponse.json(queues);
    } catch (error) {
        logger.error('Failed to fetch queues', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const parsed = createQueueSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const queue = await prisma.queue.create({ data: parsed.data });

        auditLog({ userId: session.user.id, action: 'queue.created', entity: 'queue', entityId: queue.id });

        return NextResponse.json(queue, { status: 201 });
    } catch (error) {
        logger.error('Failed to create queue', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { id, name, description } = body;

        if (!id || !name) {
            return NextResponse.json({ error: 'ID and Name are required' }, { status: 400 });
        }

        const queue = await prisma.queue.update({
            where: { id },
            data: { name, description },
        });

        auditLog({ userId: session.user.id, action: 'queue.updated', entity: 'queue', entityId: queue.id });

        return NextResponse.json(queue);
    } catch (error: any) {
        if (error.code === 'P2002') return NextResponse.json({ error: 'Department name already exists' }, { status: 400 });
        logger.error('Failed to update queue', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const url = new URL(req.url);
        const id = url.searchParams.get('id');

        if (!id) return NextResponse.json({ error: 'ID is required' }, { status: 400 });

        // Check if queue has tickets
        const ticketCount = await prisma.ticket.count({ where: { queueId: id } });
        if (ticketCount > 0) {
            return NextResponse.json({ error: `Cannot delete department with ${ticketCount} existing tickets. Reassign them first.` }, { status: 400 });
        }

        await prisma.queue.delete({ where: { id } });

        auditLog({ userId: session.user.id, action: 'queue.deleted', entity: 'queue', entityId: id });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete queue', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
