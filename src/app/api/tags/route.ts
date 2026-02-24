import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { createTagSchema, updateTagSchema } from '@/lib/validations';
import logger from '@/lib/logger';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const tags = await prisma.tag.findMany({ orderBy: { name: 'asc' } });
        return NextResponse.json(tags);
    } catch (error) {
        logger.error('Failed to fetch tags', { error });
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
        const parsed = createTagSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
        }
        const tag = await prisma.tag.create({ data: parsed.data });
        return NextResponse.json(tag, { status: 201 });
    } catch (error: any) {
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'Tag name already exists' }, { status: 400 });
        }
        logger.error('Failed to create tag', { error });
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
        const parsed = updateTagSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const { id, ...updateData } = parsed.data;

        const tag = await prisma.tag.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json(tag);
    } catch (error: any) {
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'Tag name already exists' }, { status: 400 });
        }
        logger.error('Failed to update tag', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'id required' }, { status: 400 });
        }

        await prisma.tag.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete tag', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
