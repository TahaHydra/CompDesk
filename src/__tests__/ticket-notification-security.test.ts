const mockAuth = jest.fn();
const mockSend = jest.fn();
const mockPrisma = {
    ticket: { findUnique: jest.fn(), updateMany: jest.fn() },
    timelineEvent: { create: jest.fn() },
    ticketWatcher: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(),
};
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({ canAccessTicket: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/email', () => ({ sendNewCommentEmail: mockSend }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tickets/[id]/comments/route';

const person = (id: string, role: string, membershipRoles: string[] = [], isActive = true) => ({
    id, email: `${id}@example.com`, role, isActive,
    queueMemberships: membershipRoles.map((membershipRole) => ({ role: membershipRole })), groupMemberships: [],
});

beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'author', role: 'AGENT' } });
    mockPrisma.ticket.findUnique.mockResolvedValue({
        id: 'ticket', key: 'TCK-1', title: 'Title', requesterId: 'requester', queueId: 'current-department',
        firstPublicResponseAt: new Date(), requester: { id: 'requester', email: 'requester@example.com' }, assignments: [],
    });
    mockPrisma.timelineEvent.create.mockResolvedValue({ id: 'comment' });
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
});

it('emails only active recipients with current ticket access after a move or membership change', async () => {
    const candidates = [
        person('former-agent', 'AGENT'), person('disabled-agent', 'AGENT', ['agent'], false),
        person('demoted-agent', 'USER', ['agent']), person('wrong-admin-membership', 'AGENT', ['admin']),
        person('current-agent', 'AGENT', ['agent']), person('requester', 'USER'),
        person('department-admin', 'ADMIN', ['admin']), person('global-admin', 'SUPER_ADMIN'),
        { ...person('group-agent', 'AGENT'), groupMemberships: [{ group: { queueAssignments: [{ role: 'agent' }] } }] },
    ];
    mockPrisma.ticketWatcher.findMany.mockResolvedValue(candidates.map((user) => ({ user })));
    mockPrisma.user.findMany.mockResolvedValue(candidates);
    const response = await POST(new NextRequest('http://localhost/api/tickets/ticket/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Comment' }),
    }), { params: Promise.resolve({ id: 'ticket' }) });
    expect(response.status).toBe(201);
    expect(mockSend.mock.calls[0][0].sort()).toEqual([
        'current-agent@example.com', 'department-admin@example.com', 'global-admin@example.com',
        'group-agent@example.com', 'requester@example.com',
    ]);
});

it('never sends internal note content by email', async () => {
    const response = await POST(new NextRequest('http://localhost/api/tickets/ticket/comments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'Internal note', isInternal: true }),
    }), { params: Promise.resolve({ id: 'ticket' }) });
    expect(response.status).toBe(201);
    expect(mockSend).not.toHaveBeenCalled();
});
