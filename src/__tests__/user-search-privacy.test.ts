const mockAuth = jest.fn();
type FakeUser = { id: string; name: string; email: string; role: string; queueMemberships: unknown[]; groupMemberships: unknown[] };
let people: FakeUser[] = [];
const contains = (value: string, needle: string) => value.toLowerCase().includes(needle.toLowerCase());
/** Applies the search route's name/email filters the way PostgreSQL would, including `take`. */
function fakeFindMany({ where, take }: { where: { AND: Array<Record<string, any>> }; take: number }) {
    const text = where.AND[0];
    const nameMatch = (user: FakeUser, clause: Record<string, any>) => clause.OR.some((option: Record<string, any>) => option.id
        ? user.id === option.id
        : contains(user.name, option.name.contains));
    const rows = people.filter((user) => {
        if (!text || Object.keys(text).length === 0) return true;
        if (text.OR) return nameMatch(user, text);
        return contains(user.email, text.email.contains) && !nameMatch(user, text.NOT);
    });
    return Promise.resolve(rows.sort((left, right) => left.name.localeCompare(right.name)).slice(0, take));
}
const mockPrisma = {
    user: { findMany: jest.fn(fakeFindMany), findUnique: jest.fn() },
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

const agent = (id: string, name: string, email: string): FakeUser => ({
    id, name, email, role: 'AGENT',
    queueMemberships: [{ queueId: 'queue-it', queue: { name: 'IT Support' } }], groupMemberships: [],
});
const colleague = agent('colleague', 'Sophie Laurent', 'sophie.private@example.com');
const search = (q: string) => GET(new NextRequest(`http://localhost/api/users/search?kind=assignee&q=${encodeURIComponent(q)}`));

describe('user search under the people privacy policy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        people = [colleague];
        mockAuth.mockResolvedValue({ user: { id: 'agent', role: 'AGENT' } });
        mockPrisma.appSetting.findUnique.mockResolvedValue(null);
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

    it('never lets hidden-email matches push name matches out of the result limit', async () => {
        // 25 colleagues whose hidden emails contain "laur" and sort first, plus one real name match.
        people = [
            ...Array.from({ length: 25 }, (_, index) => agent(`hidden-${index}`, `Aaron ${String(index).padStart(2, '0')}`, `laur.${index}@example.com`)),
            agent('laurent', 'Zoé Laurent', 'zoe@example.com'),
        ];
        const results = await (await search('laur')).json();
        expect(results.map((user: { id: string }) => user.id)).toEqual(['laurent']);
    });
});
