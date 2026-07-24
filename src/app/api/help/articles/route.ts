import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { helpArticleInputSchema, localizedHelpFields } from '@/lib/help-center';
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
        const collectionId = request.nextUrl.searchParams.get('collectionId');
        const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) || '';
        const slug = request.nextUrl.searchParams.get('slug')?.trim() || '';
        if (slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            return NextResponse.json({ error: 'Invalid article slug' }, { status: 400 });
        }
        const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { preferredLanguage: true } });
        const language = normalizeLanguage(user?.preferredLanguage);
        if (slug) {
            const article = await prisma.helpArticle.findUnique({
                where: { slug },
                include: {
                    collection: {
                        include: {
                            articles: {
                                where: includeDrafts ? {} : { isPublished: true },
                                orderBy: [{ sortOrder: 'asc' }, { titleEn: 'asc' }],
                            },
                        },
                    },
                },
            });
            if (!article || (!includeDrafts && (!article.isPublished || !article.collection.isPublished))) {
                return NextResponse.json({ error: 'Article not found' }, { status: 404 });
            }
            const localized = localizedHelpFields(article, language);
            const localizedCollection = localizedHelpFields(article.collection, language);
            return NextResponse.json({
                id: article.id,
                slug: article.slug,
                title: localized.title,
                summary: localized.summary,
                content: localized.content ?? '',
                collection: {
                    id: article.collection.id,
                    slug: article.collection.slug,
                    title: localizedCollection.title,
                    articles: article.collection.articles.map((item) => {
                        const fields = localizedHelpFields(item, language);
                        return { id: item.id, slug: item.slug, title: fields.title };
                    }),
                },
            });
        }

        const searchFields: Prisma.HelpArticleWhereInput[] = language === 'fr'
            ? [{ titleFr: { contains: query, mode: 'insensitive' } }, { summaryFr: { contains: query, mode: 'insensitive' } }, { contentFr: { contains: query, mode: 'insensitive' } }]
            : [{ titleEn: { contains: query, mode: 'insensitive' } }, { summaryEn: { contains: query, mode: 'insensitive' } }, { contentEn: { contains: query, mode: 'insensitive' } }];
        const articles = await prisma.helpArticle.findMany({
            where: {
                ...(includeDrafts ? {} : { isPublished: true, collection: { isPublished: true } }),
                ...(collectionId ? { collectionId } : {}),
                ...(query ? { OR: searchFields } : {}),
            },
            include: { collection: true },
            orderBy: [{ collection: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { titleEn: 'asc' }],
        });
        if (raw) return NextResponse.json(articles);
        return NextResponse.json(articles.map((article) => {
            const localized = localizedHelpFields(article, language);
            const localizedCollection = localizedHelpFields(article.collection, language);
            return {
                id: article.id,
                collectionId: article.collectionId,
                slug: article.slug,
                title: localized.title,
                summary: localized.summary,
                sortOrder: article.sortOrder,
                collection: { slug: article.collection.slug, title: localizedCollection.title },
            };
        }));
    } catch (error) {
        logger.error('Failed to list help articles', { error });
        return NextResponse.json({ error: 'Failed to load help articles' }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = helpArticleInputSchema.safeParse(await request.json());
        if (!parsed.success) return NextResponse.json({ error: 'Article validation failed', details: parsed.error.flatten() }, { status: 400 });
        const data = { ...parsed.data };
        delete data.id;
        const collection = await prisma.helpCollection.findUnique({ where: { id: data.collectionId }, select: { id: true } });
        if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 400 });
        const article = await prisma.helpArticle.create({ data });
        await auditLog({ userId: session.user.id, action: 'help.article_created', entity: 'help_article', entityId: article.id, metadata: { slug: article.slug, collectionId: article.collectionId } });
        return NextResponse.json(article, { status: 201 });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'That article slug is already in use' }, { status: 409 });
        logger.error('Failed to create help article', { error });
        return NextResponse.json({ error: 'Failed to create help article' }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = helpArticleInputSchema.safeParse(await request.json());
        if (!parsed.success || !parsed.data.id) return NextResponse.json({ error: 'Article validation failed', details: parsed.success ? { id: ['Article ID is required'] } : parsed.error.flatten() }, { status: 400 });
        const { id, ...data } = parsed.data;
        const collection = await prisma.helpCollection.findUnique({ where: { id: data.collectionId }, select: { id: true } });
        if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 400 });
        const article = await prisma.helpArticle.update({ where: { id }, data });
        await auditLog({ userId: session.user.id, action: 'help.article_updated', entity: 'help_article', entityId: id, metadata: { slug: article.slug, collectionId: article.collectionId } });
        return NextResponse.json(article);
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'That article slug is already in use' }, { status: 409 });
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ error: 'Article not found' }, { status: 404 });
        logger.error('Failed to update help article', { error });
        return NextResponse.json({ error: 'Failed to update help article' }, { status: 500 });
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const id = request.nextUrl.searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        const article = await prisma.helpArticle.delete({ where: { id } });
        await auditLog({ userId: session.user.id, action: 'help.article_deleted', entity: 'help_article', entityId: id, metadata: { slug: article.slug, collectionId: article.collectionId } });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ error: 'Article not found' }, { status: 404 });
        logger.error('Failed to delete help article', { error });
        return NextResponse.json({ error: 'Failed to delete help article' }, { status: 500 });
    }
}