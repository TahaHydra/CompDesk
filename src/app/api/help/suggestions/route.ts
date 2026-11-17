import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessQueue } from '@/lib/permissions';
import { localizedHelpFields } from '@/lib/help-center';
import { normalizeLanguage } from '@/lib/i18n';
import { PUBLISHED_ARTICLE_WHERE } from '@/lib/help-suggestions';
import logger from '@/lib/logger';

// GET /api/help/suggestions?categoryId=uuid
// Help articles an administrator linked to a category, shown while creating a ticket in it.
// Anyone allowed to create a ticket in the category's department may read them (the same rule
// as /api/ticket-form/resolve). Only published articles in published collections are returned.
export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const categoryId = z.guid().safeParse(req.nextUrl.searchParams.get('categoryId'));
        if (!categoryId.success) return NextResponse.json({ error: 'categoryId is required' }, { status: 400 });

        const category = await prisma.category.findFirst({
            where: { id: categoryId.data, isActive: true, archivedAt: null },
            select: { queueId: true, queue: { select: { isActive: true, isPublic: true } } },
        });
        if (!category) return NextResponse.json([]);
        const role = session.user.role;
        const allowed = role === 'SUPER_ADMIN'
            || (role === 'USER' ? category.queue.isActive && category.queue.isPublic : await canAccessQueue(session.user.id, role, category.queueId));
        if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        const [links, user] = await Promise.all([
            prisma.categoryHelpArticle.findMany({
                where: { categoryId: categoryId.data, article: PUBLISHED_ARTICLE_WHERE },
                orderBy: { sortOrder: 'asc' },
                select: { article: { select: { id: true, slug: true, titleEn: true, titleFr: true, summaryEn: true, summaryFr: true } } },
            }),
            prisma.user.findUnique({ where: { id: session.user.id }, select: { preferredLanguage: true } }),
        ]);
        const language = normalizeLanguage(user?.preferredLanguage);
        return NextResponse.json(links.map(({ article }) => {
            const fields = localizedHelpFields(article, language);
            return { id: article.id, slug: article.slug, title: fields.title, summary: fields.summary };
        }), { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
        logger.error('Failed to load help suggestions', { error });
        return NextResponse.json({ error: 'Failed to load help suggestions' }, { status: 500 });
    }
}
