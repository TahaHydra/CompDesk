const mockAuth = jest.fn();
const mockGetQueueInboxQueueIds = jest.fn();
const mockGetAgentAccessibleQueueIds = jest.fn();
const mockPrisma = {
    appSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    timelineEvent: { findMany: jest.fn() },
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({
    getQueueInboxQueueIds: mockGetQueueInboxQueueIds,
    getAgentAccessibleQueueIds: mockGetAgentAccessibleQueueIds,
}));

import { GET as getNotifications } from '@/app/api/notifications/route';

describe('notification authorization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.appSetting.findUnique.mockResolvedValue(null);
        mockPrisma.timelineEvent.findMany.mockResolvedValue([]);
        mockGetQueueInboxQueueIds.mockResolvedValue([]);
        mockGetAgentAccessibleQueueIds.mockResolvedValue([]);
    });

    it('excludes internal notes from end-user notification queries', async () => {
        mockAuth.mockResolvedValue({
            user: { id: 'user-id', email: 'user@example.com', name: 'User', role: 'USER', groupIds: [] },
        });
        const response = await getNotifications();
        expect(response.status).toBe(200);
        expect(mockPrisma.timelineEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                ticket: { requesterId: 'user-id' },
                type: { not: 'INTERNAL_NOTE' },
            }),
        }));
    });

    it('limits department-administrator notifications to their departments', async () => {
        mockAuth.mockResolvedValue({
            user: { id: 'admin-id', email: 'admin@example.com', name: 'Admin', role: 'ADMIN', groupIds: [] },
        });
        mockGetQueueInboxQueueIds.mockResolvedValue(['queue-1', 'queue-2']);
        await getNotifications();
        const query = mockPrisma.timelineEvent.findMany.mock.calls[0][0];
        expect(query.where.ticket).toEqual({ queueId: { in: ['queue-1', 'queue-2'] } });
    });
    it('does not apply the end-user filter to an agent', async () => {
        mockAuth.mockResolvedValue({
            user: { id: 'agent-id', email: 'agent@example.com', name: 'Agent', role: 'AGENT', groupIds: [] },
        });
        mockGetAgentAccessibleQueueIds.mockResolvedValue(['queue-1']);
        await getNotifications();
        const query = mockPrisma.timelineEvent.findMany.mock.calls[0][0];
        expect(query.where.type).toBeUndefined();
        expect(query.where.ticket).toEqual({
            OR: [{ requesterId: 'agent-id' }, { queueId: { in: ['queue-1'] } }],
        });
        expect(JSON.stringify(query.where.ticket)).not.toContain('watchers');
    });
});
