const mockAuth = jest.fn();
const mockAccess = jest.fn();
const mockSend = jest.fn();
const mockPrisma = { $queryRaw: jest.fn(), $transaction: jest.fn(), ticket: { findUnique: jest.fn() }, ticketReminder: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), count: jest.fn(), create: jest.fn() } };
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({ canAccessTicket: mockAccess }));
jest.mock('@/lib/email', () => ({ sendEmail: mockSend }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/tickets/[id]/reminders/route';
import { processTicketReminders, reminderRetryTime } from '@/lib/ticket-reminders';
const params = { params: Promise.resolve({ id: 'ticket' }) };
beforeEach(() => { jest.clearAllMocks(); mockAuth.mockResolvedValue({ user: { id: 'me', role: 'USER' } }); mockAccess.mockResolvedValue(true); mockPrisma.ticket.findUnique.mockResolvedValue({ id: 'ticket', status: 'OPEN' }); mockPrisma.ticketReminder.findMany.mockResolvedValue([]); mockPrisma.ticketReminder.updateMany.mockResolvedValue({ count: 0 }); });
test('personal reminder queries and edits are scoped to the signed-in owner', async () => {
    await GET(new NextRequest('http://localhost'), params);
    expect(mockPrisma.ticketReminder.findMany.mock.calls[0][0].where).toEqual({ ticketId: 'ticket', userId: 'me' });
    const response = await PATCH(new NextRequest('http://localhost', { method: 'PATCH', body: JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', scheduledAt: new Date(Date.now() + 60000).toISOString() }) }), params);
    expect(response.status).toBe(409);
    expect(mockPrisma.ticketReminder.updateMany.mock.calls[0][0].where.userId).toBe('me');
});
test('revoked ticket access denies reminder inspection', async () => { mockAccess.mockResolvedValue(false); expect((await GET(new NextRequest('http://localhost'), params)).status).toBe(403); expect(mockPrisma.ticketReminder.findMany).not.toHaveBeenCalled(); });
test.each([false, true])('worker persists retry or completion and cancels inactive owners (%s)', async (active) => {
    mockPrisma.ticketReminder.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'r' }]); mockSend.mockResolvedValue(false);
    mockPrisma.ticketReminder.findUnique.mockImplementation(async () => ({ id: 'r', status: 'PENDING', leaseToken: mockPrisma.$queryRaw.mock.calls[0][1], userId: 'me', ticketId: 'ticket', attempts: 1, email: true, note: 'Private note', user: { id: 'me', isActive: active, role: 'USER', email: 'me@example.test', preferredLanguage: 'en' }, ticket: { id: 'ticket', key: 'T', title: 'Title', status: 'OPEN' } }));
    await processTicketReminders();
    if (!active) { expect(mockSend).not.toHaveBeenCalled(); expect(mockPrisma.ticketReminder.updateMany.mock.calls.at(-1)?.[0].data.status).toBe('CANCELLED'); }
    else { expect(mockPrisma.ticketReminder.updateMany.mock.calls.at(-1)?.[0].data).toMatchObject({ status: 'PENDING', leaseToken: null, nextAttemptAt: expect.any(Date) }); }
});
test('retry backoff is bounded', () => { expect(reminderRetryTime(1, 0).getTime()).toBe(60000); expect(reminderRetryTime(50, 0).getTime()).toBe(3600000); });

test.each([1, 6])('worker persists acceptance or stops retries after the limit (%s)', async (attempts) => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'r' }]); mockSend.mockResolvedValue(true);
    mockPrisma.ticketReminder.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.ticketReminder.findUnique.mockImplementation(async () => ({ id: 'r', status: 'PENDING', leaseToken: mockPrisma.$queryRaw.mock.calls[0][1], userId: 'me', ticketId: 'ticket', attempts, email: true, deliveredAt: new Date(), emailAccepted: false, note: '', user: { id: 'me', isActive: true, role: 'USER', email: 'me@example.test', preferredLanguage: 'en' }, ticket: { id: 'ticket', key: 'T', title: 'Title', status: 'OPEN' } }));
    await processTicketReminders();
    expect(mockSend).toHaveBeenCalledTimes(attempts === 1 ? 1 : 0);
    expect(mockPrisma.ticketReminder.updateMany.mock.calls.at(-1)?.[0].data).toMatchObject({ status: attempts === 1 ? 'DELIVERED' : 'FAILED', emailAccepted: attempts === 1, leaseToken: null });
    expect(mockPrisma.ticketReminder.updateMany.mock.calls.some(([arg]) => arg.data.deliveredAt)).toBe(false);
});

test('a reminder reclaimed by another worker is not delivered', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'r' }]);
    mockPrisma.ticketReminder.findUnique.mockResolvedValue({ id: 'r', status: 'PENDING', leaseToken: 'another-worker' });
    await processTicketReminders();
    expect(mockSend).not.toHaveBeenCalled(); expect(mockPrisma.ticketReminder.updateMany).not.toHaveBeenCalled();
});
