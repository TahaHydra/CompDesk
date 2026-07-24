const mockAuth = jest.fn();
const mockPrisma = {
    queue: { findFirst: jest.fn(), findUnique: jest.fn() },
    category: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    ticketFormTemplate: { findFirst: jest.fn(), findUnique: jest.fn() },
    appSetting: { findMany: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));

import { NextRequest } from 'next/server';
import { GET as getCategories, POST as createCategory } from '@/app/api/categories/route';
import { PATCH as updateBranding } from '@/app/api/branding/admin/route';
import { PATCH as updateTemplate } from '@/app/api/ticket-form-templates/[id]/route';
import { GET as getSettings } from '@/app/api/settings/route';

const userSession = {
    user: { id: 'user-id', email: 'user@example.com', name: 'User', role: 'USER', groupIds: [] },
};

describe('API authorization and category filtering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth.mockResolvedValue(userSession);
    });

    it('filters active category results by the requested public department', async () => {
        const queueId = '550e8400-e29b-41d4-a716-446655440000';
        mockPrisma.queue.findFirst.mockResolvedValue({ id: queueId });
        mockPrisma.category.findMany.mockResolvedValue([]);
        const response = await getCategories(new NextRequest(`http://localhost/api/categories?queueId=${queueId}`));
        expect(response.status).toBe(200);
        expect(mockPrisma.category.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { queueId, isActive: true, archivedAt: null },
        }));
    });

    it('does not expose categories from a private department to an end user', async () => {
        const queueId = '550e8400-e29b-41d4-a716-446655440000';
        mockPrisma.queue.findFirst.mockResolvedValue(null);
        const response = await getCategories(new NextRequest(`http://localhost/api/categories?queueId=${queueId}`));
        expect(response.status).toBe(403);
        expect(mockPrisma.category.findMany).not.toHaveBeenCalled();
    });

    it('requires a department filter for non-admin category reads', async () => {
        const response = await getCategories(new NextRequest('http://localhost/api/categories'));
        expect(response.status).toBe(400);
    });

    it('blocks non-admin category creation', async () => {
        const response = await createCategory(new NextRequest('http://localhost/api/categories', {
            method: 'POST', body: JSON.stringify({ queueId: crypto.randomUUID(), name: 'General' }),
            headers: { 'Content-Type': 'application/json' },
        }));
        expect(response.status).toBe(403);
        expect(mockPrisma.category.create).not.toHaveBeenCalled();
    });

    it('blocks non-admin branding changes', async () => {
        const response = await updateBranding(new NextRequest('http://localhost/api/branding/admin', {
            method: 'PATCH', body: '{}', headers: { 'Content-Type': 'application/json' },
        }));
        expect(response.status).toBe(403);
    });

    it('blocks department administrators from global settings', async () => {
        mockAuth.mockResolvedValue({ user: { ...userSession.user, role: 'ADMIN' } });
        const response = await getSettings();
        expect(response.status).toBe(403);
        expect(mockPrisma.appSetting.findMany).not.toHaveBeenCalled();
    });

    it('returns only allowlisted settings to a super administrator', async () => {
        mockAuth.mockResolvedValue({ user: { ...userSession.user, role: 'SUPER_ADMIN' } });
        mockPrisma.appSetting.findMany.mockResolvedValue([]);
        const response = await getSettings();
        expect(response.status).toBe(200);
        const query = mockPrisma.appSetting.findMany.mock.calls[0][0];
        expect(query.where.key.in).not.toContain('api_clients');
        expect(query.where.key.in).not.toContain('notifications_read_user-id');
    });

    it('blocks non-admin ticket form template changes', async () => {
        const response = await updateTemplate(
            new NextRequest('http://localhost/api/ticket-form-templates/template-id', {
                method: 'PATCH', body: '{}', headers: { 'Content-Type': 'application/json' },
            }),
            { params: Promise.resolve({ id: 'template-id' }) }
        );
        expect(response.status).toBe(403);
    });
});