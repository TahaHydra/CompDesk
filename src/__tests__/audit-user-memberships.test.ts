const mockAuth = jest.fn();
const mockPrisma = {
    user: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
    queue: { count: jest.fn() }, queueMember: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    $executeRaw: jest.fn(), $transaction: jest.fn(),
};
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('@/lib/login-throttle', () => ({ clearLoginFailures: jest.fn() }));
jest.mock('@/lib/permissions', () => ({ isAgentRole: () => true, getAgentAccessibleQueueIds: jest.fn(), getQueueInboxQueueIds: jest.fn() }));
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/users/route';
const userId = '550e8400-e29b-41d4-a716-446655440000';
const archivedId = '550e8400-e29b-41d4-a716-446655440001';
const activeId = '550e8400-e29b-41d4-a716-446655440002';
beforeEach(() => {
    jest.clearAllMocks(); mockAuth.mockResolvedValue({ user: { id: 'super', role: 'SUPER_ADMIN' } });
    mockPrisma.$transaction.mockImplementation((callback: any) => callback(mockPrisma));
    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, role: 'AGENT', isActive: true });
    mockPrisma.user.update.mockResolvedValue({ id: userId, role: 'AGENT' });
    mockPrisma.queueMember.findMany.mockResolvedValue([{ queueId: archivedId }]);
    mockPrisma.queue.count.mockResolvedValue(1);
});
function update(queueIds: string[]) { return PATCH(new NextRequest('http://localhost/api/users', { method: 'PATCH', body: JSON.stringify({ userId, queueIds }), headers: { 'Content-Type': 'application/json' } })); }
test('directory projects membership role so agent and administration access remain distinct', async () => {
    mockPrisma.user.findMany.mockResolvedValue([]); await GET();
    expect(mockPrisma.user.findMany.mock.calls[0][0].select.queueMemberships.select.role).toBe(true);
});
test('existing archived membership can remain while another assignment is changed', async () => {
    const response = await update([archivedId, activeId]);
    expect(response.status).toBe(200);
    expect(mockPrisma.queue.count).toHaveBeenCalledWith({ where: { id: { in: [activeId] }, isActive: true } });
});
test('archived agent membership can be removed and replaced with an active one', async () => {
    expect((await update([activeId])).status).toBe(200);
    expect(mockPrisma.queueMember.createMany).toHaveBeenCalledWith({ data: [{ userId, queueId: activeId, role: 'agent' }] });
});
test('new inactive memberships are rejected even when another archived assignment already exists', async () => {
    mockPrisma.queue.count.mockResolvedValue(0);
    expect((await update([activeId])).status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
});
