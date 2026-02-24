import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { createCategorySchema } from '@/lib/validations';
import logger from '@/lib/logger';

// GET /api/categories
export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const categories = await prisma.category.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });
        return NextResponse.json(categories);
    } catch (error) {
        logger.error('Failed to fetch categories', { error });
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
        const parsed = createCategorySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
        }

        const category = await prisma.category.create({ data: parsed.data });
        return NextResponse.json(category, { status: 201 });
    } catch (error) {
        logger.error('Failed to create category', { error });
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
        const { id, name } = body;

        if (!id || !name) {
            return NextResponse.json({ error: 'ID and Name are required' }, { status: 400 });
        }

        const category = await prisma.category.update({
            where: { id },
            data: { name },
        });

        return NextResponse.json(category);
    } catch (error: any) {
        if (error.code === 'P2002') return NextResponse.json({ error: 'Category name already exists' }, { status: 400 });
        logger.error('Failed to update category', { error });
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

        // Detach tickets first before deleting (because restrict by default)
        await prisma.ticket.updateMany({
            where: { categoryId: id },
            data: { categoryId: null }
        });

        await prisma.category.delete({ where: { id } });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete category', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
