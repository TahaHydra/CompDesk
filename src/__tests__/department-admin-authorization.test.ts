const mockAuth = jest.fn();
const mockCanAdministerQueue = jest.fn();
const mockCloneTicketFormTemplate = jest.fn();
const mockAuditLog = jest.fn();

const mockPrisma = {
    queue: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    category: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    ticketFormTemplate: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { count: jest.fn() },
    queueMember: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/audit', () => ({ auditLog: mockAuditLog }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
jest.mock('@/lib/permissions', () => ({
    isAdminRole: (role: string) => role === 'ADMIN' || role === 'SUPER_ADMIN',
    canAdministerQueue: mockCanAdministerQueue,
    getAdministeredQueueIds: jest.fn().mockResolvedValue([]),
    getAgentAccessibleQueueIds: jest.fn().mockResolvedValue([]),
    canAccessQueue: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/lib/ticket-form/service', () => ({
    cloneTicketFormTemplate: mockCloneTicketFormTemplate,
    serializeTemplate: (template: unknown) => template,
    TemplateResolutionError: class TemplateResolutionError extends Error {},
}));

import { NextRequest } from 'next/server';
import { PATCH as updateDepartment } from '@/app/api/queues/route';
import { PATCH as updateCategory } from '@/app/api/categories/route';
import { POST as createTemplate } from '@/app/api/ticket-form-templates/route';

const departmentId = '550e8400-e29b-41d4-a716-446655440000';
const categoryId = '550e8400-e29b-41d4-a716-446655440001';
const templateId = '550e8400-e29b-41d4-a716-446655440002';
const adminSession = { user: { id: 'admin-1', email: 'admin@example.com', name: 'Department Admin', role: 'ADMIN', groupIds: [] } };

function jsonRequest(url: string, method: string, body: unknown) {
    return new NextRequest(url, {
        method,
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('department administrator authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth.mockResolvedValue(adminSession);
        mockCanAdministerQueue.mockResolvedValue(true);
        mockPrisma.ticketFormTemplate.findFirst.mockResolvedValue({ id: templateId });
        mockPrisma.queue.findUnique.mockResolvedValue({ id: departmentId, defaultTemplateId: null });
        mockPrisma.queue.update.mockResolvedValue({
            id: departmentId,
            defaultTemplateId: templateId,
            members: [],
            _count: { tickets: 0, categories: 0 },
        });
        mockPrisma.category.findUnique.mockResolvedValue({
            id: categoryId,
            queueId: departmentId,
            templateId: null,
            _count: { tickets: 0 },
        });
        mockPrisma.category.update.mockResolvedValue({
            id: categoryId,
            queueId: departmentId,
            templateId,
            queue: { id: departmentId, name: 'IT' },
            template: { id: templateId, name: 'IT form' },
            _count: { tickets: 0 },
        });
        mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
    });

    it('allows an ADMIN to create a shared template without a department assignment', async () => {
        mockCanAdministerQueue.mockResolvedValue(false);
        mockCloneTicketFormTemplate.mockResolvedValue({ id: templateId, name: 'Shared form', fields: [] });

        const response = await createTemplate(jsonRequest('http://localhost/api/ticket-form-templates', 'POST', { name: 'Shared form' }));

        expect(response.status).toBe(201);
        expect(mockCloneTicketFormTemplate).toHaveBeenCalledWith({ name: 'Shared form' });
    });

    it('allows an ADMIN to assign a template to a department they administer', async () => {
        const response = await updateDepartment(jsonRequest('http://localhost/api/queues', 'PATCH', {
            id: departmentId,
            defaultTemplateId: templateId,
        }));

        expect(response.status).toBe(200);
        expect(mockCanAdministerQueue).toHaveBeenCalledWith('admin-1', 'ADMIN', departmentId);
        expect(mockPrisma.queue.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: departmentId },
            data: { defaultTemplateId: templateId },
        }));
    });

    it('blocks an ADMIN from assigning another department', async () => {
        mockCanAdministerQueue.mockResolvedValue(false);

        const response = await updateDepartment(jsonRequest('http://localhost/api/queues', 'PATCH', {
            id: departmentId,
            defaultTemplateId: templateId,
        }));

        expect(response.status).toBe(403);
        expect(mockPrisma.queue.update).not.toHaveBeenCalled();
    });

    it('blocks an ADMIN from changing department settings beyond the template', async () => {
        const response = await updateDepartment(jsonRequest('http://localhost/api/queues', 'PATCH', {
            id: departmentId,
            name: 'Renamed department',
        }));

        expect(response.status).toBe(403);
        expect(mockPrisma.queue.update).not.toHaveBeenCalled();
    });

    it('allows an ADMIN to assign a category override in their department', async () => {
        const response = await updateCategory(jsonRequest('http://localhost/api/categories', 'PATCH', {
            id: categoryId,
            templateId,
        }));

        expect(response.status).toBe(200);
        expect(mockCanAdministerQueue).toHaveBeenCalledWith('admin-1', 'ADMIN', departmentId);
        expect(mockPrisma.category.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: categoryId },
            data: { templateId },
        }));
    });

    it('blocks an ADMIN from editing category content', async () => {
        const response = await updateCategory(jsonRequest('http://localhost/api/categories', 'PATCH', {
            id: categoryId,
            name: 'Renamed category',
        }));

        expect(response.status).toBe(403);
        expect(mockPrisma.category.update).not.toHaveBeenCalled();
    });

    it('blocks an ADMIN from assigning a category in another department', async () => {
        mockCanAdministerQueue.mockResolvedValue(false);

        const response = await updateCategory(jsonRequest('http://localhost/api/categories', 'PATCH', {
            id: categoryId,
            templateId,
        }));

        expect(response.status).toBe(403);
        expect(mockPrisma.category.update).not.toHaveBeenCalled();
    });
});