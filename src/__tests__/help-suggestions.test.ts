const mockAuth = jest.fn();
const mockTx = {
    helpArticle: { count: jest.fn() },
    categoryHelpArticle: { deleteMany: jest.fn(), createMany: jest.fn() },
    category: { update: jest.fn() },
};
const mockPrisma = {
    category: { findFirst: jest.fn(), findUnique: jest.fn() },
    categoryHelpArticle: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    queue: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof mockTx) => unknown) => callback(mockTx)),
};
const mockCanAccessQueue = jest.fn();
const mockCanAdministerQueue = jest.fn();

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('@/lib/permissions', () => ({
    canAccessQueue: (...args: unknown[]) => mockCanAccessQueue(...args),
    canAdministerQueue: (...args: unknown[]) => mockCanAdministerQueue(...args),
    getAdministeredQueueIds: jest.fn().mockResolvedValue([]),
    isAdminRole: (role: string) => role === 'ADMIN' || role === 'SUPER_ADMIN',
}));

import { NextRequest } from 'next/server';
import { GET as suggestions } from '@/app/api/help/suggestions/route';
import { PATCH as patchCategory } from '@/app/api/categories/route';
import { PUBLISHED_ARTICLE_WHERE } from '@/lib/help-suggestions';

const CATEGORY = '66666666-6666-4666-8666-666666666666';
const ARTICLES = ['77777777-7777-4777-8777-777777777771', '77777777-7777-4777-8777-777777777772', '77777777-7777-4777-8777-777777777773', '77777777-7777-4777-8777-777777777774'];
const as = (role: string) => mockAuth.mockResolvedValue({ user: { id: `${role}-id`, role } });
const read = (categoryId = CATEGORY) => suggestions(new NextRequest(`http://localhost/api/help/suggestions?categoryId=${categoryId}`));
const patch = (body: unknown) => patchCategory(new NextRequest('http://localhost/api/categories', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));

describe('help suggestions while creating a ticket', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.category.findFirst.mockResolvedValue({ queueId: 'queue-it', queue: { isActive: true, isPublic: true } });
        mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'fr' });
        mockPrisma.categoryHelpArticle.findMany.mockResolvedValue([
            { article: { id: ARTICLES[0], slug: 'delegate-a-mailbox', titleEn: 'Delegate a mailbox', titleFr: 'Déléguer une boîte', summaryEn: 'Share it yourself', summaryFr: null } },
        ]);
    });

    it('returns only published articles in published collections, localized, in order', async () => {
        as('USER');
        const response = await read();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([{ id: ARTICLES[0], slug: 'delegate-a-mailbox', title: 'Déléguer une boîte', summary: 'Share it yourself' }]);
        expect(mockPrisma.categoryHelpArticle.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { categoryId: CATEGORY, article: PUBLISHED_ARTICLE_WHERE },
            orderBy: { sortOrder: 'asc' },
        }));
        expect(PUBLISHED_ARTICLE_WHERE).toEqual({ isPublished: true, collection: { isPublished: true } });
    });

    it('follows who may create a ticket in the department', async () => {
        as('USER');
        mockPrisma.category.findFirst.mockResolvedValue({ queueId: 'queue-hr', queue: { isActive: true, isPublic: false } });
        expect((await read()).status).toBe(403);
        as('AGENT');
        mockCanAccessQueue.mockResolvedValue(false);
        expect((await read()).status).toBe(403);
        expect(mockPrisma.categoryHelpArticle.findMany).not.toHaveBeenCalled();
    });

    it('suggests nothing for inactive categories and rejects malformed ids', async () => {
        as('USER');
        mockPrisma.category.findFirst.mockResolvedValue(null);
        expect(await (await read()).json()).toEqual([]);
        expect((await read('nope')).status).toBe(400);
    });
});

describe('choosing suggested articles for a category', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.category.findUnique.mockResolvedValue({ id: CATEGORY, queueId: 'queue-it', templateId: null, _count: { tickets: 0 } });
        mockTx.helpArticle.count.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.length);
        mockTx.category.update.mockResolvedValue({ id: CATEGORY, queueId: 'queue-it', templateId: null });
    });

    it('lets the administrator of the department set suggestions, in order', async () => {
        as('ADMIN');
        mockCanAdministerQueue.mockResolvedValue(true);
        const response = await patch({ id: CATEGORY, suggestedArticleIds: [ARTICLES[1], ARTICLES[0]] });
        expect(response.status).toBe(200);
        expect(mockTx.categoryHelpArticle.deleteMany).toHaveBeenCalledWith({ where: { categoryId: CATEGORY } });
        expect(mockTx.categoryHelpArticle.createMany).toHaveBeenCalledWith({ data: [
            { categoryId: CATEGORY, articleId: ARTICLES[1], sortOrder: 0 },
            { categoryId: CATEGORY, articleId: ARTICLES[0], sortOrder: 1 },
        ] });
    });

    it('does not widen what a department administrator may change', async () => {
        as('ADMIN');
        mockCanAdministerQueue.mockResolvedValue(true);
        expect((await patch({ id: CATEGORY, suggestedArticleIds: [], name: 'Renamed' })).status).toBe(403);
        mockCanAdministerQueue.mockResolvedValue(false);
        expect((await patch({ id: CATEGORY, suggestedArticleIds: [ARTICLES[0]] })).status).toBe(403);
        expect(mockTx.categoryHelpArticle.deleteMany).not.toHaveBeenCalled();
    });

    it('accepts only published articles, at most three, each once', async () => {
        as('SUPER_ADMIN');
        mockTx.helpArticle.count.mockResolvedValue(0);
        expect((await patch({ id: CATEGORY, suggestedArticleIds: [ARTICLES[0]] })).status).toBe(400);
        expect(mockTx.categoryHelpArticle.deleteMany).not.toHaveBeenCalled();
        expect((await patch({ id: CATEGORY, suggestedArticleIds: ARTICLES })).status).toBe(400);
        expect((await patch({ id: CATEGORY, suggestedArticleIds: [ARTICLES[0], ARTICLES[0]] })).status).toBe(400);
    });
});
