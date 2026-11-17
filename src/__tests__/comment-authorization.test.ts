const mockAuth = jest.fn();
const mockPrisma = {
    timelineEvent: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    ticket: { findUnique: jest.fn() },
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
const mockCanAdministerQueue = jest.fn();
jest.mock('@/lib/permissions', () => ({
    canAccessTicket: jest.fn().mockResolvedValue(true),
    canAdministerQueue: (...args: unknown[]) => mockCanAdministerQueue(...args),
}));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendNewCommentEmail: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/tickets/[id]/comments/route';

const ticketId = '550e8400-e29b-41d4-a716-446655440000';
const eventId = '550e8400-e29b-41d4-a716-446655440001';

describe('comment authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Only Super Admins administer every department unless a test says otherwise.
        mockCanAdministerQueue.mockImplementation(async (_userId: string, role: string) => role === 'SUPER_ADMIN');
        mockPrisma.timelineEvent.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.ticket.findUnique.mockResolvedValue({
            id: ticketId,
            requesterId: 'user-id',
            queueId: 'queue-id',
        });
    });

    it('does not let an end user edit an internal note attributed to them', async () => {
        mockAuth.mockResolvedValue({
            user: { id: 'user-id', email: 'user@example.com', name: 'User', role: 'USER', groupIds: [] },
        });
        mockPrisma.timelineEvent.findUnique.mockResolvedValue({
            id: eventId,
            ticketId,
            userId: 'user-id',
            type: 'INTERNAL_NOTE',
            content: 'Private note',
            createdAt: new Date(),
        });
        const response = await PATCH(
            new NextRequest(`http://localhost/api/tickets/${ticketId}/comments`, {
                method: 'PATCH',
                body: JSON.stringify({ eventId, content: 'Changed' }),
                headers: { 'Content-Type': 'application/json' },
            }),
            { params: Promise.resolve({ id: ticketId }) }
        );
        expect(response.status).toBe(403);
        expect(mockPrisma.timelineEvent.update).not.toHaveBeenCalled();
    });

    it('does not let an administrator edit a system timeline event', async () => {
        mockAuth.mockResolvedValue({
            user: { id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'SUPER_ADMIN', groupIds: [] },
        });
        mockPrisma.timelineEvent.findUnique.mockResolvedValue({
            id: eventId,
            ticketId,
            userId: 'admin-id',
            type: 'STATUS_CHANGE',
            content: 'Status changed',
            createdAt: new Date(),
        });
        const response = await PATCH(
            new NextRequest(`http://localhost/api/tickets/${ticketId}/comments`, {
                method: 'PATCH',
                body: JSON.stringify({ eventId, content: 'Rewritten history' }),
                headers: { 'Content-Type': 'application/json' },
            }),
            { params: Promise.resolve({ id: ticketId }) }
        );
        expect(response.status).toBe(409);
        expect(mockPrisma.timelineEvent.update).not.toHaveBeenCalled();
    });

    it('does not let an administrator delete a system timeline event', async () => {
        mockAuth.mockResolvedValue({
            user: { id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', groupIds: [] },
        });
        mockPrisma.timelineEvent.findUnique.mockResolvedValue({
            id: eventId,
            ticketId,
            userId: 'admin-id',
            type: 'CREATED',
            content: 'Ticket created',
            createdAt: new Date(),
        });
        const response = await DELETE(
            new NextRequest(`http://localhost/api/tickets/${ticketId}/comments?eventId=${eventId}`, { method: 'DELETE' }),
            { params: Promise.resolve({ id: ticketId }) }
        );
        expect(response.status).toBe(409);
        expect(mockPrisma.timelineEvent.delete).not.toHaveBeenCalled();
    });
    it('does not let an agent delete another person conversation entry', async () => {
        mockAuth.mockResolvedValue({
            user: { id: 'agent-id', email: 'agent@example.com', name: 'Agent', role: 'AGENT', groupIds: [] },
        });
        mockPrisma.timelineEvent.findUnique.mockResolvedValue({
            id: eventId,
            ticketId,
            userId: 'other-agent-id',
            type: 'COMMENT',
            content: 'Original reply',
            createdAt: new Date(),
        });
        const response = await DELETE(
            new NextRequest(`http://localhost/api/tickets/${ticketId}/comments?eventId=${eventId}`, { method: 'DELETE' }),
            { params: Promise.resolve({ id: ticketId }) }
        );
        expect(response.status).toBe(403);
        expect(mockPrisma.timelineEvent.delete).not.toHaveBeenCalled();
    });

    const deleteRequest = () => DELETE(
        new NextRequest(`http://localhost/api/tickets/${ticketId}/comments?eventId=${eventId}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id: ticketId }) }
    );
    const otherAgentComment = (authorRole: string) => ({
        id: eventId,
        ticketId,
        userId: 'other-id',
        type: 'COMMENT',
        content: 'Original reply',
        createdAt: new Date(),
        deletedAt: null,
        user: { role: authorRole },
    });

    it('does not let an ADMIN moderate a ticket in a department it does not administer', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', groupIds: [] } });
        mockPrisma.timelineEvent.findUnique.mockResolvedValue(otherAgentComment('AGENT'));
        const response = await deleteRequest();
        expect(response.status).toBe(403);
        expect(mockCanAdministerQueue).toHaveBeenCalledWith('admin-id', 'ADMIN', 'queue-id');
        expect(mockPrisma.timelineEvent.updateMany).not.toHaveBeenCalled();
    });

    it('lets the administrator of the ticket department remove an agent reply', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', groupIds: [] } });
        mockCanAdministerQueue.mockResolvedValue(true);
        mockPrisma.timelineEvent.findUnique.mockResolvedValue(otherAgentComment('AGENT'));
        const response = await deleteRequest();
        expect(response.status).toBe(200);
        expect(mockPrisma.timelineEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: eventId, deletedAt: null },
            data: expect.objectContaining({ deletedById: 'admin-id', deleteReason: 'user_requested' }),
        }));
    });

    it('never lets a department administrator remove a Super Admin reply', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', groupIds: [] } });
        mockCanAdministerQueue.mockResolvedValue(true);
        mockPrisma.timelineEvent.findUnique.mockResolvedValue(otherAgentComment('SUPER_ADMIN'));
        const response = await deleteRequest();
        expect(response.status).toBe(403);
        expect(mockPrisma.timelineEvent.updateMany).not.toHaveBeenCalled();
    });

    it('reports a closed edit window for an author editing after 24 hours', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'agent-id', email: 'agent@example.com', name: 'Agent', role: 'AGENT', groupIds: [] } });
        mockPrisma.timelineEvent.findUnique.mockResolvedValue({
            ...otherAgentComment('AGENT'),
            userId: 'agent-id',
            createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        });
        const response = await PATCH(
            new NextRequest(`http://localhost/api/tickets/${ticketId}/comments`, {
                method: 'PATCH',
                body: JSON.stringify({ eventId, content: 'Late change' }),
                headers: { 'Content-Type': 'application/json' },
            }),
            { params: Promise.resolve({ id: ticketId }) }
        );
        expect(response.status).toBe(400);
        expect(mockPrisma.timelineEvent.update).not.toHaveBeenCalled();
    });
});
