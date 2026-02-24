import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';

// GET /api/audit-logs — list audit logs with pagination and filters
export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
        const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
        const action = searchParams.get('action'); // e.g. "auth.login", "user.created"
        const entity = searchParams.get('entity'); // e.g. "auth", "user", "ticket"
        const userId = searchParams.get('userId');
        const dateFrom = searchParams.get('dateFrom');
        const dateTo = searchParams.get('dateTo');
        const search = searchParams.get('search');

        const where: any = {};

        if (action) where.action = action;
        if (entity) where.entity = entity;
        if (userId) where.userId = userId;
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt.gte = new Date(dateFrom);
            if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z');
        }
        if (search) {
            where.OR = [
                { action: { contains: search, mode: 'insensitive' } },
                { entity: { contains: search, mode: 'insensitive' } },
                { ipAddress: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                include: {
                    user: { select: { id: true, name: true, email: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.auditLog.count({ where }),
        ]);

        return NextResponse.json({
            logs,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Failed to fetch audit logs', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
