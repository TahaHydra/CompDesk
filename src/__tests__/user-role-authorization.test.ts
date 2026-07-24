const mockAuth = jest.fn();
const mockPrisma = {
    user: {
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    },
    queue: { count: jest.fn() },
    queueMember: { deleteMany: jest.fn(), createMany: jest.fn() },
    groupMember: { deleteMany: jest.fn() },
    ticket: { count: jest.fn() },
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('@/lib/permissions', () => ({
    isAgentRole: (role: string) => ['AGENT', 'ADMIN', 'SUPER_ADMIN'].includes(role),
    getAgentAccessibleQueueIds: jest.fn().mockResolvedValue([]),
}));

import { NextRequest } from 'next/server';
import { DELETE, PATCH, POST } from '@/app/api/users/route';

const adminSession = {
    user: { id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', groupIds: [] },
};

function request(method: string, body?: unknown, query = '') {
    return new NextRequest(`http://localhost/api/users${query}`, {
        method,
        ...(body === undefined ? {} : {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
        }),
    });
}

describe('user role authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth.mockResolvedValue(adminSession);
    });

    it('prevents an ADMIN from creating a SUPER_ADMIN', async () => {
        const response = await POST(request('POST', {
            name: 'New Super',
            email: 'super@example.com',
            role: 'SUPER_ADMIN',
        }));
        expect(response.status).toBe(403);
        expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('prevents an ADMIN from modifying a SUPER_ADMIN', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'super-id', role: 'SUPER_ADMIN', isActive: true });
        const response = await PATCH(request('PATCH', {
            userId: 'super-id',
            role: 'USER',
        }));
        expect(response.status).toBe(403);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('prevents an ADMIN from deleting a SUPER_ADMIN', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN', isActive: true });
        const response = await DELETE(request('DELETE', undefined, '?id=super-id'));
        expect(response.status).toBe(403);
        expect(mockPrisma.user.delete).not.toHaveBeenCalled();
    });
});
