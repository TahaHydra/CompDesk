const mockAuth = jest.fn();
const mockCanAccessTicket = jest.fn();
const mockSendReminderEmail = jest.fn();
const mockAuditLog = jest.fn();
const mockPrisma = {
    appSetting: { findMany: jest.fn() },
    timelineEvent: { findFirst: jest.fn(), create: jest.fn() },
    ticketReminder: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    ticket: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({
    canAccessTicket: mockCanAccessTicket,
    isAgentRole: (role: string) => ['AGENT', 'ADMIN', 'SUPER_ADMIN'].includes(role),
}));
jest.mock('@/lib/email', () => ({ sendTicketReminderEmail: mockSendReminderEmail }));
jest.mock('@/lib/audit', () => ({ auditLog: mockAuditLog }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/tickets/[id]/reminders/route';
import { parseTicketReminderSettings, roleCanSendTicketReminder } from '@/lib/ticket-reminders';

const ticketId = '550e8400-e29b-41d4-a716-446655440000';
const pendingSince = new Date('2026-08-20T10:00:00.000Z');
const requesterReply = new Date('2026-08-22T12:00:00.000Z');
const ticket = {
    id: ticketId,
    key: 'TCK-2026-000100',
    title: 'Printer approval needed',
    status: 'PENDING_USER',
    version: 4,
    queueId: 'queue-id',
    requesterId: 'requester-id',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    requester: { id: 'requester-id', name: 'Request Person', email: 'requester@example.com', isActive: true },
};

function enabledSettings() {
    return [
        { key: 'ticket_reminders_enabled', value: 'true' },
        { key: 'ticket_reminder_cooldown_hours', value: '24' },
        { key: 'ticket_reminder_max_per_cycle', value: '3' },
        { key: 'ticket_reminder_allow_agents', value: 'true' },
        { key: 'ticket_reminder_allow_admins', value: 'true' },
    ];
}

describe('ticket reminders', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth.mockResolvedValue({ user: { id: 'agent-id', role: 'AGENT' } });
        mockCanAccessTicket.mockResolvedValue(true);
        mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
        mockPrisma.appSetting.findMany.mockResolvedValue(enabledSettings());
        mockPrisma.timelineEvent.findFirst
            .mockResolvedValueOnce({ createdAt: pendingSince })
            .mockResolvedValueOnce({ createdAt: requesterReply });
        mockPrisma.ticketReminder.count.mockResolvedValue(0);
        mockPrisma.ticketReminder.findFirst.mockResolvedValue(null);
        mockPrisma.ticketReminder.create.mockResolvedValue({ id: 'reminder-id', sentAt: new Date('2026-08-23T12:00:00.000Z') });
        mockPrisma.ticketReminder.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.timelineEvent.create.mockResolvedValue({ id: 'timeline-id' });
        mockPrisma.$queryRaw.mockResolvedValue([]);
        mockPrisma.$transaction.mockImplementation((callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
        mockSendReminderEmail.mockResolvedValue(true);
    });

    it('uses secure disabled defaults and never permits end users', () => {
        const settings = parseTicketReminderSettings({});
        expect(settings).toMatchObject({ enabled: false, cooldownHours: 24, maxPerCycle: 3 });
        expect(roleCanSendTicketReminder('USER', { ...settings, enabled: true })).toBe(false);
        expect(roleCanSendTicketReminder('SUPER_ADMIN', settings)).toBe(true);
    });

    it('rejects requester access before loading the ticket', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'requester-id', role: 'USER' } });
        const response = await GET(new Request(`http://localhost/api/tickets/${ticketId}/reminders`), { params: Promise.resolve({ id: ticketId }) });
        expect(response.status).toBe(403);
        expect(mockPrisma.ticket.findUnique).not.toHaveBeenCalled();
    });

    it('does not expose reminder state outside existing ticket access', async () => {
        mockCanAccessTicket.mockResolvedValue(false);
        const response = await GET(new Request(`http://localhost/api/tickets/${ticketId}/reminders`), { params: Promise.resolve({ id: ticketId }) });
        expect(response.status).toBe(403);
        expect(mockPrisma.appSetting.findMany).not.toHaveBeenCalled();
    });

    it('sends once under a per-ticket database lock and records history without duplicating the email address', async () => {
        const response = await POST(new NextRequest(`http://localhost/api/tickets/${ticketId}/reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedVersion: ticket.version }),
        }), { params: Promise.resolve({ id: ticketId }) });
        expect(response.status).toBe(201);
        expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
        expect(mockCanAccessTicket).toHaveBeenCalledWith('agent-id', 'AGENT', ticket, mockPrisma);
        expect(mockSendReminderEmail).toHaveBeenCalledTimes(1);
        expect(mockPrisma.ticketReminder.create).toHaveBeenCalledWith({
            data: { ticketId, sentById: 'agent-id', recipientId: 'requester-id' },
            select: { id: true, createdAt: true },
        });
        expect(mockPrisma.timelineEvent.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ type: 'REMINDER_SENT', metadata: expect.objectContaining({ recipientId: 'requester-id' }) }),
        }));
        expect(JSON.stringify(mockPrisma.timelineEvent.create.mock.calls)).not.toContain('requester@example.com');
    });

    it('uses the latest requester reply as the new cycle boundary', async () => {
        await GET(new Request(`http://localhost/api/tickets/${ticketId}/reminders`), { params: Promise.resolve({ id: ticketId }) });
        expect(mockPrisma.ticketReminder.count).toHaveBeenCalledWith({ where: { ticketId, status: 'SENT', sentAt: { gte: requesterReply } } });
    });

    it('does not record history when SMTP delivery fails', async () => {
        mockSendReminderEmail.mockResolvedValue(false);
        const response = await POST(new NextRequest(`http://localhost/api/tickets/${ticketId}/reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedVersion: ticket.version }),
        }), { params: Promise.resolve({ id: ticketId }) });
        expect(response.status).toBe(502);
        expect(mockPrisma.ticketReminder.create).toHaveBeenCalledTimes(1);
        expect(mockPrisma.ticketReminder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'reminder-id', status: 'PENDING' },
            data: expect.objectContaining({ status: 'FAILED' }),
        }));
        expect(mockPrisma.timelineEvent.create).not.toHaveBeenCalled();
    });

    it('enforces the per-cycle maximum before email delivery', async () => {
        mockPrisma.ticketReminder.count.mockResolvedValue(3);
        const response = await POST(new NextRequest(`http://localhost/api/tickets/${ticketId}/reminders`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedVersion: ticket.version }),
        }), { params: Promise.resolve({ id: ticketId }) });
        expect(response.status).toBe(409);
        expect(mockSendReminderEmail).not.toHaveBeenCalled();
    });
});
