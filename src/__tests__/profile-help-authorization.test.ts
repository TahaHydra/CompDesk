const mockAuth = jest.fn();
const mockAuditLog = jest.fn();
const mockRemoveUploadedImage = jest.fn();
const mockPrisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    helpCollection: { create: jest.fn() },
    helpArticle: { findUnique: jest.fn(), findMany: jest.fn() },
    appSetting: { findUnique: jest.fn() },
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/audit', () => ({ auditLog: mockAuditLog }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/uploaded-image', () => ({
    isUploadedImageUrl: (url: string, folder: string) => url.startsWith('/uploads/' + folder + '/') && /\.(png|jpe?g|webp|gif|ico)$/i.test(url),
    removeUploadedImage: mockRemoveUploadedImage,
    storeUploadedImage: jest.fn(),
}));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { NextRequest } from 'next/server';
import { PATCH as updatePreferences } from '@/app/api/profile/preferences/route';
import { POST as createHelpCollection } from '@/app/api/help/collections/route';
import { GET as getHelpArticles } from '@/app/api/help/articles/route';
import { DELETE as deleteQuickLinkIcon } from '@/app/api/settings/quick-link-icons/route';

const userSession = { user: { id: 'user-id', email: 'user@example.com', name: 'User', role: 'USER', groupIds: [] } };
const adminSession = { user: { ...userSession.user, id: 'admin-id', role: 'ADMIN' } };
const superSession = { user: { ...userSession.user, id: 'super-id', role: 'SUPER_ADMIN' } };

describe('profile preference and help-center authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth.mockResolvedValue(userSession);
    });

    it('updates only the authenticated user language and audits the change', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'en' });
        mockPrisma.user.update.mockResolvedValue({ preferredLanguage: 'fr' });
        const response = await updatePreferences(new NextRequest('http://localhost/api/profile/preferences', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ preferredLanguage: 'fr' }),
        }));
        expect(response.status).toBe(200);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-id' }, data: { preferredLanguage: 'fr' } }));
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'profile.language_updated', userId: 'user-id' }));
    });

    it('rejects unsupported languages and extra preference fields', async () => {
        const invalidLanguage = await updatePreferences(new NextRequest('http://localhost/api/profile/preferences', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferredLanguage: 'de' }),
        }));
        const extraField = await updatePreferences(new NextRequest('http://localhost/api/profile/preferences', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preferredLanguage: 'fr', role: 'SUPER_ADMIN' }),
        }));
        expect(invalidLanguage.status).toBe(400);
        expect(extraField.status).toBe(400);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('loads a localized published help article by slug without server rendering', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'fr' });
        mockPrisma.helpArticle.findUnique.mockResolvedValue({
            id: 'article-id', collectionId: 'collection-id', slug: 'welcome-to-compdesk',
            titleEn: 'Welcome', titleFr: 'Bienvenue', summaryEn: 'Start here', summaryFr: 'Commencez ici',
            contentEn: 'English content', contentFr: 'Contenu français', isPublished: true,
            collection: {
                id: 'collection-id', slug: 'getting-started', titleEn: 'Getting started', titleFr: 'Bien démarrer',
                isPublished: true,
                articles: [{ id: 'article-id', slug: 'welcome-to-compdesk', titleEn: 'Welcome', titleFr: 'Bienvenue' }],
            },
        });
        const response = await getHelpArticles(new NextRequest('http://localhost/api/help/articles?slug=welcome-to-compdesk'));
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ title: 'Bienvenue', content: 'Contenu français' });
    });

    it('does not expose a draft help article to a normal user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'en' });
        mockPrisma.helpArticle.findUnique.mockResolvedValue({
            id: 'draft-id', slug: 'draft-article', titleEn: 'Draft', titleFr: 'Brouillon',
            contentEn: 'Draft content', contentFr: 'Brouillon', isPublished: false,
            collection: { id: 'collection-id', slug: 'drafts', titleEn: 'Drafts', titleFr: 'Brouillons', isPublished: true, articles: [] },
        });
        const response = await getHelpArticles(new NextRequest('http://localhost/api/help/articles?slug=draft-article'));
        expect(response.status).toBe(404);
    });

    it('searches both languages and falls back when the preferred translation is unavailable', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ preferredLanguage: 'fr' });
        mockPrisma.helpArticle.findMany.mockResolvedValue([{
            id: 'article-id', collectionId: 'collection-id', slug: 'english-only',
            titleEn: 'Reset your password', titleFr: '', summaryEn: 'Account recovery', summaryFr: '',
            contentEn: 'Complete account recovery instructions.', contentFr: '', isPublished: true, sortOrder: 0,
            collection: { id: 'collection-id', slug: 'accounts', titleEn: 'Accounts', titleFr: '', isPublished: true },
        }]);
        const response = await getHelpArticles(new NextRequest('http://localhost/api/help/articles?q=password'));
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual([expect.objectContaining({ title: 'Reset your password', summary: 'Account recovery' })]);
        const query = mockPrisma.helpArticle.findMany.mock.calls[0][0];
        expect(JSON.stringify(query.where.OR)).toContain('titleEn');
        expect(JSON.stringify(query.where.OR)).toContain('titleFr');
    });

    it('blocks normal users from creating help content', async () => {
        const response = await createHelpCollection(new NextRequest('http://localhost/api/help/collections', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }));
        expect(response.status).toBe(403);
        expect(mockPrisma.helpCollection.create).not.toHaveBeenCalled();
    });

    it('does not delete a quick-link icon while saved settings still reference it', async () => {
        mockAuth.mockResolvedValue(superSession);
        const iconUrl = '/uploads/quick-links/123e4567-e89b-12d3-a456-426614174000.png';
        mockPrisma.appSetting.findUnique.mockResolvedValue({ value: JSON.stringify([{ title: 'Intranet', url: 'https://intranet.example.com', iconUrl }]) });
        const response = await deleteQuickLinkIcon(new NextRequest(`http://localhost/api/settings/quick-link-icons?url=${encodeURIComponent(iconUrl)}`, { method: 'DELETE' }));
        expect(response.status).toBe(409);
        expect(mockRemoveUploadedImage).not.toHaveBeenCalled();
    });
    it('allows administrators to create validated bilingual help collections', async () => {
        mockAuth.mockResolvedValue(adminSession);
        mockPrisma.helpCollection.create.mockResolvedValue({ id: crypto.randomUUID(), slug: 'getting-started' });
        const response = await createHelpCollection(new NextRequest('http://localhost/api/help/collections', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: 'getting-started', titleEn: 'Getting started', titleFr: 'Bien démarrer', icon: 'book', sortOrder: 10, isPublished: true }),
        }));
        expect(response.status).toBe(201);
        expect(mockPrisma.helpCollection.create).toHaveBeenCalled();
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'help.collection_created', userId: 'admin-id' }));
    });
});
