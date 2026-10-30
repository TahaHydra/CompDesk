import type { Prisma } from '@prisma/client';

/** A department, or one of its categories when categoryId is set. */
export interface TagScopeRule { queueId: string; categoryId: string | null }
export interface ScopedTag { allDepartments: boolean; scopes: TagScopeRule[] }
export interface NamedTagScope extends TagScopeRule { queueName?: string | null; categoryName?: string | null }

/**
 * Whether a tag can be newly applied to a ticket in this department and category. Tags already on a
 * ticket stay when it moves elsewhere; this rule only governs adding them.
 */
export function isTagAvailable(tag: ScopedTag, queueId: string, categoryId: string | null): boolean {
    if (tag.allDepartments) return true;
    return tag.scopes.some((scope) => scope.queueId === queueId && (scope.categoryId === null || scope.categoryId === categoryId));
}

/**
 * Database filter matching isTagAvailable(). Without a category (undefined), every tag usable somewhere
 * in the department matches, including category-specific ones: that is what a department filter needs.
 */
export function tagAvailabilityWhere(queueId: string, categoryId?: string | null): Prisma.TagWhereInput {
    const scope: Prisma.TagScopeWhereInput = categoryId === undefined
        ? { queueId }
        : { queueId, OR: [{ categoryId: null }, ...(categoryId ? [{ categoryId }] : [])] };
    return { OR: [{ allDepartments: true }, { scopes: { some: scope } }] };
}

/** Removes duplicates and category rules already covered by a whole-department rule. */
export function normalizeTagScopes(scopes: TagScopeRule[]): TagScopeRule[] {
    const wholeDepartments = new Set(scopes.filter((scope) => !scope.categoryId).map((scope) => scope.queueId));
    const seen = new Set<string>();
    return scopes
        .map((scope) => ({ queueId: scope.queueId, categoryId: scope.categoryId || null }))
        .filter((scope) => !(scope.categoryId && wholeDepartments.has(scope.queueId)))
        .filter((scope) => {
            const key = `${scope.queueId}:${scope.categoryId ?? '*'}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

/** Human-readable availability, e.g. "All departments" or "IT Support · HR › Leave & absence". */
export function describeTagScope(tag: { allDepartments: boolean; scopes?: NamedTagScope[] }): string {
    if (tag.allDepartments) return 'All departments';
    const scopes = tag.scopes ?? [];
    if (scopes.length === 0) return 'Not available anywhere';
    return scopes
        .map((scope) => scope.categoryId ? `${scope.queueName ?? 'Department'} › ${scope.categoryName ?? 'Category'}` : `${scope.queueName ?? 'Department'}`)
        .sort((left, right) => left.localeCompare(right))
        .join(' · ');
}
