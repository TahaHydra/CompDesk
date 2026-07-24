const mockQueueGroupFindMany = jest.fn();
const mockQueueMemberFindMany = jest.fn();

jest.mock('@/lib/prisma', () => ({
    prisma: {
        queueGroup: { findMany: mockQueueGroupFindMany },
        queueMember: { findMany: mockQueueMemberFindMany },
    },
}));

import {
    canAccessTicket,
    canAdministerQueue,
    getAdministeredQueueIds,
    isAdminRole,
    isAgentRole,
} from '@/lib/permissions';

describe('permissions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockQueueGroupFindMany.mockResolvedValue([]);
        mockQueueMemberFindMany.mockResolvedValue([]);
    });

    it('recognizes admin roles', () => {
        expect(isAdminRole('ADMIN')).toBe(true);
        expect(isAdminRole('SUPER_ADMIN')).toBe(true);
        expect(isAdminRole('AGENT')).toBe(false);
    });

    it('recognizes agent-or-above roles', () => {
        expect(isAgentRole('AGENT')).toBe(true);
        expect(isAgentRole('ADMIN')).toBe(true);
        expect(isAgentRole('USER')).toBe(false);
    });

    it('merges direct and group department-admin assignments without duplicates', async () => {
        mockQueueGroupFindMany.mockResolvedValue([{ queueId: 'queue-1' }, { queueId: 'queue-2' }]);
        mockQueueMemberFindMany.mockResolvedValue([{ queueId: 'queue-2' }, { queueId: 'queue-3' }]);

        await expect(getAdministeredQueueIds('admin-1')).resolves.toEqual(['queue-1', 'queue-2', 'queue-3']);
        expect(mockQueueGroupFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ role: 'admin' }),
        }));
        expect(mockQueueMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { userId: 'admin-1', role: 'admin' },
        }));
    });

    it('limits an ADMIN to departments explicitly administered', async () => {
        mockQueueMemberFindMany.mockResolvedValue([{ queueId: 'queue-1' }]);

        await expect(canAdministerQueue('admin-1', 'ADMIN', 'queue-1')).resolves.toBe(true);
        await expect(canAdministerQueue('admin-1', 'ADMIN', 'queue-2')).resolves.toBe(false);
    });

    it('lets a SUPER_ADMIN administer every department without membership', async () => {
        await expect(canAdministerQueue('super-1', 'SUPER_ADMIN', 'queue-any')).resolves.toBe(true);
        expect(mockQueueGroupFindMany).not.toHaveBeenCalled();
        expect(mockQueueMemberFindMany).not.toHaveBeenCalled();
    });

    it('never grants department administration to agents', async () => {
        await expect(canAdministerQueue('agent-1', 'AGENT', 'queue-1')).resolves.toBe(false);
    });

    it('lets requesters access their own tickets', async () => {
        await expect(
            canAccessTicket('user-1', 'USER', { requesterId: 'user-1', queueId: 'queue-1' })
        ).resolves.toBe(true);
    });

    it('blocks users from other people tickets', async () => {
        await expect(
            canAccessTicket('user-1', 'USER', { requesterId: 'user-2', queueId: 'queue-1' })
        ).resolves.toBe(false);
    });

    it('always lets admins access tickets', async () => {
        await expect(
            canAccessTicket('admin-1', 'ADMIN', { requesterId: 'user-2', queueId: 'queue-1' })
        ).resolves.toBe(true);
    });
});