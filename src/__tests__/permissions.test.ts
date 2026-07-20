jest.mock('@/lib/prisma', () => ({
    prisma: {
        queueGroup: { findMany: jest.fn() },
        queueMember: { findMany: jest.fn() },
    },
}));

import { canAccessTicket, isAdminRole, isAgentRole } from '@/lib/permissions';

describe('permissions', () => {
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
