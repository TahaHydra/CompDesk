const mockAuth = jest.fn();
const mockPrisma = {
    timelineEvent: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    ticket: { findUnique: jest.fn() },
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({ canAccessTicket: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendTicketUpdatedEmail: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import { NextRequest } from 'next/server';
import { DELETE, PATCH } from '@/app/api/tickets/[id]/comments/route';

const ticketId = '550e8400-e29b-41d4-a716-446655440000';
const eventId = '550e8400-e29b-41d4-a716-446655440001';

describe('comment authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
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
});
