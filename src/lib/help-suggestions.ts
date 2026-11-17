import type { Prisma } from '@prisma/client';
import { z } from 'zod';

/** At most this many Help Center articles are suggested for one category. */
export const MAX_SUGGESTED_ARTICLES = 3;

export const suggestedArticleIdsSchema = z.array(z.guid()).max(MAX_SUGGESTED_ARTICLES)
    .refine((ids) => new Set(ids).size === ids.length, 'Each article can be suggested only once');

/** A suggestion is shown only while both the article and its collection are published. */
export const PUBLISHED_ARTICLE_WHERE = {
    isPublished: true,
    collection: { isPublished: true },
} satisfies Prisma.HelpArticleWhereInput;

export class SuggestedArticleError extends Error {}

/**
 * Replaces a category's suggestions, keeping the given order. Only published articles in
 * published collections can be chosen.
 */
export async function replaceCategorySuggestions(tx: Prisma.TransactionClient, categoryId: string, articleIds: readonly string[]) {
    if (articleIds.length > 0) {
        const published = await tx.helpArticle.count({ where: { id: { in: [...articleIds] }, ...PUBLISHED_ARTICLE_WHERE } });
        if (published !== articleIds.length) throw new SuggestedArticleError('Only published help articles can be suggested');
    }
    await tx.categoryHelpArticle.deleteMany({ where: { categoryId } });
    if (articleIds.length > 0) {
        await tx.categoryHelpArticle.createMany({ data: articleIds.map((articleId, sortOrder) => ({ categoryId, articleId, sortOrder })) });
    }
}
