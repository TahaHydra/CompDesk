const mockAuth = jest.fn();
const mockAuditLog = jest.fn();
const mockRemoveUploadedImage = jest.fn();
const mockPrisma = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    helpCollection: { create: jest.fn() },
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
import { DELETE as deleteQuickLinkIcon } from '@/app/api/settings/quick-link-icons/route';

const userSession = { user: { id: 'user-id', email: 'user@example.com', name: 'User', role: 'USER', groupIds: [] } };
const adminSession = { user: { ...userSession.user, id: 'admin-id', role: 'ADMIN' } };

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

    it('blocks normal users from creating help content', async () => {
        const response = await createHelpCollection(new NextRequest('http://localhost/api/help/collections', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        }));
        expect(response.status).toBe(403);
        expect(mockPrisma.helpCollection.create).not.toHaveBeenCalled();
    });

    it('does not delete a quick-link icon while saved settings still reference it', async () => {
        mockAuth.mockResolvedValue(adminSession);
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