import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const groups = await prisma.group.findMany({
            include: {
                _count: { select: { members: true } },
                queueAssignments: { include: { queue: { select: { id: true, name: true } } } },
            },
            orderBy: { name: 'asc' },
        });
        return NextResponse.json(groups);
    } catch (error) {
        logger.error('Failed to fetch groups', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/groups/sync - Sync Entra groups (placeholder, needs Graph API token)
export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { groups } = await req.json();

        if (!groups || !Array.isArray(groups)) {
            return NextResponse.json({ error: 'Invalid groups data' }, { status: 400 });
        }

        const results = [];
        for (const group of groups) {
            const upserted = await prisma.group.upsert({
                where: { entraObjectId: group.id },
                update: {
                    name: group.displayName,
                    description: group.description,
                    syncedAt: new Date(),
                },
                create: {
                    entraObjectId: group.id,
                    name: group.displayName,
                    description: group.description,
                    syncedAt: new Date(),
                },
            });
            results.push(upserted);
        }

        return NextResponse.json({ synced: results.length, groups: results });
    } catch (error) {
        logger.error('Failed to sync groups', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
