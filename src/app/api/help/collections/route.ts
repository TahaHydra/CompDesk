import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { helpCollectionInputSchema, localizedHelpFields } from '@/lib/help-center';
import { normalizeLanguage } from '@/lib/i18n';
import logger from '@/lib/logger';
import { isAdminRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const admin = isAdminRole(session.user.role);
        const includeDrafts = admin && request.nextUrl.searchParams.get('includeDrafts') === 'true';
        const raw = admin && request.nextUrl.searchParams.get('raw') === 'true';
        const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { preferredLanguage: true } });
        const language = normalizeLanguage(user?.preferredLanguage);
        const collections = await prisma.helpCollection.findMany({
            where: includeDrafts ? {} : { isPublished: true },
            include: {
                _count: {
                    select: { articles: { where: includeDrafts ? {} : { isPublished: true } } },
                },
            },
            orderBy: [{ sortOrder: 'asc' }, { titleEn: 'asc' }],
        });
        if (raw) return NextResponse.json(collections);
        return NextResponse.json(collections.map((collection) => {
            const localized = localizedHelpFields(collection, language);
            return {
                id: collection.id,
                slug: collection.slug,
                title: localized.title,
                description: localized.description,
                icon: collection.icon,
                sortOrder: collection.sortOrder,
                articleCount: collection._count.articles,
            };
        }));
    } catch (error) {
        logger.error('Failed to list help collections', { error });
        return NextResponse.json({ error: 'Failed to load help collections' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = helpCollectionInputSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: 'Collection validation failed', details: parsed.error.flatten() }, { status: 400 });
        const data = { ...parsed.data };
        delete data.id;
        const collection = await prisma.helpCollection.create({ data });
        await auditLog({ userId: session.user.id, action: 'help.collection_created', entity: 'help_collection', entityId: collection.id, metadata: { slug: collection.slug } });
        return NextResponse.json(collection, { status: 201 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'That collection slug is already in use' }, { status: 409 });
        logger.error('Failed to create help collection', { error });
        return NextResponse.json({ error: 'Failed to create help collection' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = helpCollectionInputSchema.safeParse(await request.json());
        if (!parsed.success || !parsed.data.id) return NextResponse.json({ error: 'Collection validation failed', details: parsed.success ? { id: ['Collection ID is required'] } : parsed.error.flatten() }, { status: 400 });
        const { id, ...data } = parsed.data;
        const collection = await prisma.helpCollection.update({ where: { id }, data });
        await auditLog({ userId: session.user.id, action: 'help.collection_updated', entity: 'help_collection', entityId: id, metadata: { slug: collection.slug } });
        return NextResponse.json(collection);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'That collection slug is already in use' }, { status: 409 });
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
        logger.error('Failed to update help collection', { error });
        return NextResponse.json({ error: 'Failed to update help collection' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const id = request.nextUrl.searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        const collection = await prisma.helpCollection.findUnique({ where: { id }, include: { _count: { select: { articles: true } } } });
        if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 });
        if (collection._count.articles > 0) return NextResponse.json({ error: 'Move or delete the collection articles first' }, { status: 409 });
        await prisma.helpCollection.delete({ where: { id } });
        await auditLog({ userId: session.user.id, action: 'help.collection_deleted', entity: 'help_collection', entityId: id, metadata: { slug: collection.slug } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete help collection', { error });
        return NextResponse.json({ error: 'Failed to delete help collection' }, { status: 500 });
    }
}