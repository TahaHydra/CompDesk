const mockAuth = jest.fn();
const mockPrisma = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    appSetting: { findUnique: jest.fn() },
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({
    getQueueInboxQueueIds: jest.fn().mockResolvedValue(['queue-it']),
    getAdministeredQueueIds: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/users/search/route';

const colleague = {
    id: 'colleague', name: 'Sophie Laurent', email: 'sophie.private@example.com', role: 'AGENT',
    queueMemberships: [{ queueId: 'queue-it', queue: { name: 'IT Support' } }], groupMemberships: [],
};
const search = (q: string) => GET(new NextRequest(`http://localhost/api/users/search?kind=assignee&q=${encodeURIComponent(q)}`));

describe('user search under the people privacy policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuth.mockResolvedValue({ user: { id: 'agent', role: 'AGENT' } });
        mockPrisma.appSetting.findUnique.mockResolvedValue(null);
        mockPrisma.user.findMany.mockResolvedValue([colleague]);
    });

    it('finds a colleague by name without exposing a hidden email', async () => {
        const results = await (await search('sophie')).json();
        expect(results).toEqual([{ id: 'colleague', name: 'Sophie Laurent', role: 'AGENT', departmentNames: ['IT Support'] }]);
    });

    it('does not reveal who owns a hidden email address searched for directly', async () => {
        expect(await (await search('sophie.private@')).json()).toEqual([]);
    });

    it('matches by email when the policy lets the viewer see it', async () => {
        mockPrisma.appSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ email: 'staff', language: 'higher', jobTitle: 'higher' }) });
        const results = await (await search('sophie.private@')).json();
        expect(results[0].email).toBe('sophie.private@example.com');
    });
});
