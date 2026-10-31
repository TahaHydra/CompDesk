// Tag availability by department and category: the shared rules, the tags API permissions, and how
// ticket updates treat tags that a moved ticket already carries.
const mockAuth = jest.fn();
const mockAdministered = jest.fn();
const mockCanAccessTicket = jest.fn();
const mockPrisma = {
    tag: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), count: jest.fn() },
    tagScope: { deleteMany: jest.fn(), createMany: jest.fn() },
    ticketTag: { count: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    queue: { findMany: jest.fn() },
    category: { findMany: jest.fn(), findUnique: jest.fn() },
    ticket: { findUnique: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    ticketAssignee: { findMany: jest.fn() },
    slaPolicy: { findUnique: jest.fn() },
    timelineEvent: { createMany: jest.fn() },
    $transaction: jest.fn(),
};
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/permissions', () => ({
    ...jest.requireActual('@/lib/permissions'),
    getAdministeredQueueIds: (...args: unknown[]) => mockAdministered(...args),
    canAccessTicket: (...args: unknown[]) => mockCanAccessTicket(...args),
    canAccessQueue: jest.fn().mockResolvedValue(true),
}));
jest.mock('@/lib/email', () => ({ sendTicketUpdatedEmail: jest.fn() }));
jest.mock('@/lib/webhooks', () => ({ fireWebhook: jest.fn() }));
jest.mock('@/lib/tickets/notification-recipients', () => ({ ticketNotificationRecipients: jest.fn().mockResolvedValue([]) }));

import { NextRequest } from 'next/server';
import { describeTagScope, isTagAvailable, normalizeTagScopes, tagAvailabilityWhere } from '@/lib/tag-scope';
import { DELETE, GET, PATCH, POST } from '@/app/api/tags/route';
import { PATCH as patchTicket } from '@/app/api/tickets/[id]/route';

const IT = '11111111-1111-4111-8111-111111111111';
const HR = '22222222-2222-4222-8222-222222222222';
const FINANCE = '33333333-3333-4333-8333-333333333333';
const NETWORK = '44444444-4444-4444-8444-444444444444';
const LEAVE = '55555555-5555-4555-8555-555555555555';
const TAG = '66666666-6666-4666-8666-666666666666';
const OTHER_TAG = '77777777-7777-4777-8777-777777777777';

const asRole = (role: string) => mockAuth.mockResolvedValue({ user: { id: `${role.toLowerCase()}-user`, role } });
const tagRequest = (method: string, body?: unknown, query = '') => new NextRequest(`http://localhost/api/tags${query}`, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });

beforeEach(() => {
    jest.clearAllMocks();
    mockAdministered.mockResolvedValue([IT]);
    mockCanAccessTicket.mockResolvedValue(true);
    mockPrisma.queue.findMany.mockImplementation(async ({ where }) => where.id.in.map((id: string) => ({ id })));
    mockPrisma.category.findMany.mockResolvedValue([{ id: NETWORK, queueId: IT }, { id: LEAVE, queueId: HR }]);
    mockPrisma.tag.findFirst.mockResolvedValue(null);
    mockPrisma.tag.create.mockImplementation(async ({ data }) => ({ id: TAG, ...data }));
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
});

describe('tag availability rules', () => {
    const itOnly = { allDepartments: false, scopes: [{ queueId: IT, categoryId: null }] };
    const leaveOnly = { allDepartments: false, scopes: [{ queueId: HR, categoryId: LEAVE }] };

    it('offers an all-departments tag everywhere, including tickets without a category', () => {
        expect(isTagAvailable({ allDepartments: true, scopes: [] }, HR, null)).toBe(true);
    });

    it('limits a department tag to every category of that department only', () => {
        expect(isTagAvailable(itOnly, IT, NETWORK)).toBe(true);
        expect(isTagAvailable(itOnly, IT, null)).toBe(true);
        expect(isTagAvailable(itOnly, HR, LEAVE)).toBe(false);
    });

    it('limits a category tag to that category', () => {
        expect(isTagAvailable(leaveOnly, HR, LEAVE)).toBe(true);
        expect(isTagAvailable(leaveOnly, HR, null)).toBe(false);
        expect(isTagAvailable(leaveOnly, IT, LEAVE)).toBe(false);
    });

    it('never treats a limited tag that lost all its scopes as available everywhere', () => {
        expect(isTagAvailable({ allDepartments: false, scopes: [] }, IT, null)).toBe(false);
        expect(describeTagScope({ allDepartments: false, scopes: [] })).toBe('Not available anywhere');
    });

    it('shares one tag between departments', () => {
        const shared = { allDepartments: false, scopes: [{ queueId: IT, categoryId: null }, { queueId: HR, categoryId: null }] };
        expect(isTagAvailable(shared, IT, NETWORK) && isTagAvailable(shared, HR, LEAVE)).toBe(true);
        expect(isTagAvailable(shared, FINANCE, null)).toBe(false);
    });

    it('drops duplicates and category rules covered by a whole-department rule', () => {
        expect(normalizeTagScopes([
            { queueId: IT, categoryId: NETWORK }, { queueId: IT, categoryId: null }, { queueId: IT, categoryId: null },
            { queueId: HR, categoryId: LEAVE }, { queueId: HR, categoryId: LEAVE },
        ])).toEqual([{ queueId: IT, categoryId: null }, { queueId: HR, categoryId: LEAVE }]);
    });

    it('builds the matching database filters', () => {
        expect(tagAvailabilityWhere(IT)).toEqual({ OR: [{ allDepartments: true }, { scopes: { some: { queueId: IT } } }] });
        expect(tagAvailabilityWhere(HR, LEAVE)).toEqual({ OR: [{ allDepartments: true }, { scopes: { some: { queueId: HR, OR: [{ categoryId: null }, { categoryId: LEAVE }] } } }] });
        expect(tagAvailabilityWhere(HR, null)).toEqual({ OR: [{ allDepartments: true }, { scopes: { some: { queueId: HR, OR: [{ categoryId: null }] } } }] });
    });

    it('describes availability with department and category names', () => {
        expect(describeTagScope({ allDepartments: false, scopes: [
            { queueId: HR, categoryId: LEAVE, queueName: 'HR', categoryName: 'Leave & absence' },
            { queueId: IT, categoryId: null, queueName: 'IT Support' },
        ] })).toBe('HR › Leave & absence · IT Support');
    });
});

describe('GET /api/tags', () => {
    const stored = [{ id: TAG, name: 'vpn', color: '#2563eb', allDepartments: false, scopes: [{ queueId: IT, categoryId: null, queue: { name: 'IT Support' }, category: null }], _count: { tickets: 4 } }];

    it('returns only name and color to requesters', async () => {
        asRole('USER');
        mockPrisma.tag.findMany.mockResolvedValue(stored);
        expect(await (await GET(tagRequest('GET'))).json()).toEqual([{ id: TAG, name: 'vpn', color: '#2563eb' }]);
    });

    it('filters by department and category when asked', async () => {
        asRole('AGENT');
        mockPrisma.tag.findMany.mockResolvedValue([]);
        await GET(tagRequest('GET', undefined, `?queueId=${HR}&categoryId=${LEAVE}`));
        expect(mockPrisma.tag.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: tagAvailabilityWhere(HR, LEAVE) }));
        await GET(tagRequest('GET', undefined, `?queueId=${HR}&categoryId=`));
        expect(mockPrisma.tag.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: tagAvailabilityWhere(HR, null) }));
    });

    it('gives staff the availability and administrators usage and edit rights', async () => {
        asRole('ADMIN');
        mockPrisma.tag.findMany.mockResolvedValue(stored);
        const [tag] = await (await GET(tagRequest('GET', undefined, '?manage=true'))).json();
        expect(tag).toMatchObject({ allDepartments: false, ticketCount: 4, canManage: true, scopes: [{ queueId: IT, queueName: 'IT Support', categoryId: null }] });
    });

    it('refuses the management view to agents', async () => {
        asRole('AGENT');
        expect((await GET(tagRequest('GET', undefined, '?manage=true'))).status).toBe(403);
    });
});

describe('creating tags', () => {
    it('lets a Super Admin create a tag for all departments', async () => {
        asRole('SUPER_ADMIN');
        const response = await POST(tagRequest('POST', { name: ' vpn ', color: '#2563eb' }));
        expect(response.status).toBe(201);
        expect(mockPrisma.tag.create).toHaveBeenCalledWith({ data: { name: 'vpn', color: '#2563eb', allDepartments: true, scopes: { create: [] } } });
    });

    it('lets a department Admin create a tag limited to departments they administer', async () => {
        asRole('ADMIN');
        const response = await POST(tagRequest('POST', { name: 'vpn', allDepartments: false, scopes: [{ queueId: IT, categoryId: NETWORK }] }));
        expect(response.status).toBe(201);
        expect(mockPrisma.tag.create.mock.calls[0][0].data.scopes).toEqual({ create: [{ queueId: IT, categoryId: NETWORK }] });
    });

    it.each([
        ['an all-departments tag', { name: 'vpn' }],
        ['a tag in a department they do not administer', { name: 'vpn', allDepartments: false, scopes: [{ queueId: IT }, { queueId: HR }] }],
    ])('refuses a department Admin %s', async (_label, body) => {
        asRole('ADMIN');
        expect((await POST(tagRequest('POST', body))).status).toBe(403);
        expect(mockPrisma.tag.create).not.toHaveBeenCalled();
    });

    it('refuses agents', async () => {
        asRole('AGENT');
        expect((await POST(tagRequest('POST', { name: 'vpn' }))).status).toBe(403);
    });

    it('rejects a name that differs only by case', async () => {
        asRole('SUPER_ADMIN');
        mockPrisma.tag.findFirst.mockResolvedValue({ name: 'VPN' });
        const response = await POST(tagRequest('POST', { name: 'vpn' }));
        expect(response.status).toBe(409);
        expect((await response.json()).error).toContain('"VPN" already exists');
        expect(mockPrisma.tag.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { name: { equals: 'vpn', mode: 'insensitive' } } }));
    });

    it('tells a department Admin to edit a duplicate they manage, or to ask a Super Admin otherwise', async () => {
        asRole('ADMIN');
        const body = { name: 'vpn', allDepartments: false, scopes: [{ queueId: IT }] };
        mockPrisma.tag.findFirst.mockResolvedValue({ name: 'vpn', allDepartments: false, scopes: [{ queueId: IT, categoryId: null }] });
        expect((await (await POST(tagRequest('POST', body))).json()).error).toContain('Edit where it is available');
        mockPrisma.tag.findFirst.mockResolvedValue({ name: 'vpn', allDepartments: true, scopes: [] });
        expect((await (await POST(tagRequest('POST', body))).json()).error).toContain('Ask a Super Admin');
    });

    it('rejects a category listed under the wrong department', async () => {
        asRole('SUPER_ADMIN');
        const response = await POST(tagRequest('POST', { name: 'leave', allDepartments: false, scopes: [{ queueId: IT, categoryId: LEAVE }] }));
        expect(response.status).toBe(400);
    });

    it('rejects a limited tag without any department', async () => {
        asRole('SUPER_ADMIN');
        expect((await POST(tagRequest('POST', { name: 'nowhere', allDepartments: false, scopes: [] }))).status).toBe(400);
    });
});

describe('editing and deleting tags', () => {
    const sharedTag = { id: TAG, name: 'hardware', allDepartments: false, scopes: [{ queueId: IT, categoryId: null }, { queueId: HR, categoryId: null }] };
    const itTag = { id: TAG, name: 'vpn', allDepartments: false, scopes: [{ queueId: IT, categoryId: null }] };

    it('keeps a department Admin away from a tag another department also uses', async () => {
        asRole('ADMIN');
        mockPrisma.tag.findUnique.mockResolvedValue(sharedTag);
        expect((await PATCH(tagRequest('PATCH', { id: TAG, color: '#000000' }))).status).toBe(403);
        expect((await DELETE(tagRequest('DELETE', undefined, `?id=${TAG}`))).status).toBe(403);
        expect(mockPrisma.tag.update).not.toHaveBeenCalled();
        expect(mockPrisma.tag.delete).not.toHaveBeenCalled();
    });

    it('does not let a department Admin widen their tag to all departments', async () => {
        asRole('ADMIN');
        mockPrisma.tag.findUnique.mockResolvedValue(itTag);
        expect((await PATCH(tagRequest('PATCH', { id: TAG, allDepartments: true }))).status).toBe(403);
    });

    it('replaces the scopes atomically without touching tickets that carry the tag', async () => {
        asRole('SUPER_ADMIN');
        mockPrisma.tag.findUnique.mockResolvedValue(itTag);
        mockPrisma.tag.update.mockResolvedValue(itTag);
        const response = await PATCH(tagRequest('PATCH', { id: TAG, scopes: [{ queueId: HR, categoryId: LEAVE }] }));
        expect(response.status).toBe(200);
        expect(mockPrisma.tagScope.deleteMany).toHaveBeenCalledWith({ where: { tagId: TAG } });
        expect(mockPrisma.tagScope.createMany).toHaveBeenCalledWith({ data: [{ tagId: TAG, queueId: HR, categoryId: LEAVE }] });
        expect(mockPrisma.ticketTag.deleteMany).not.toHaveBeenCalled();
    });

    it('allows renaming to a different case of the same name', async () => {
        asRole('SUPER_ADMIN');
        mockPrisma.tag.findUnique.mockResolvedValue(itTag);
        mockPrisma.tag.update.mockResolvedValue({ ...itTag, name: 'VPN' });
        expect((await PATCH(tagRequest('PATCH', { id: TAG, name: 'VPN' }))).status).toBe(200);
        expect(mockPrisma.tag.findFirst).not.toHaveBeenCalled();
    });

    it('reports how many tickets lose a deleted tag', async () => {
        asRole('ADMIN');
        mockPrisma.tag.findUnique.mockResolvedValue(itTag);
        mockPrisma.ticketTag.count.mockResolvedValue(3);
        const response = await DELETE(tagRequest('DELETE', undefined, `?id=${TAG}`));
        expect(await response.json()).toEqual({ success: true, removedFromTickets: 3 });
    });
});

describe('ticket tag updates', () => {
    const ticket = { id: 'ticket', key: 'TCK-1', title: 'VPN', requesterId: 'requester', queueId: HR, categoryId: LEAVE, version: 3, status: 'OPEN', priority: 'NORMAL', formSchemaSnapshot: null };
    const patch = (body: Record<string, unknown>) => patchTicket(new NextRequest('http://localhost/api/tickets/ticket', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: 3, ...body }),
    }), { params: Promise.resolve({ id: 'ticket' }) });

    beforeEach(() => {
        asRole('AGENT');
        mockPrisma.ticket.findUnique.mockResolvedValue(ticket);
        mockPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.ticket.findUniqueOrThrow.mockResolvedValue({ ...ticket, version: 4, queue: { id: HR, name: 'HR' }, requester: null, assignments: [] });
        // The ticket moved to HR while carrying the IT-only tag TAG.
        mockPrisma.ticketTag.findMany.mockResolvedValue([{ tagId: TAG }]);
    });

    it('keeps a tag the ticket already carries after moving departments', async () => {
        const response = await patch({ tagIds: [TAG] });
        expect(response.status).toBe(200);
        expect(mockPrisma.tag.count).not.toHaveBeenCalled();
    });

    it('refuses to add a tag that is not available for the ticket', async () => {
        mockPrisma.tag.count.mockResolvedValue(0);
        const response = await patch({ tagIds: [TAG, OTHER_TAG] });
        expect(response.status).toBe(400);
        expect(mockPrisma.tag.count).toHaveBeenCalledWith({ where: { id: { in: [OTHER_TAG] }, ...tagAvailabilityWhere(HR, LEAVE) } });
        expect(mockPrisma.ticketTag.createMany).not.toHaveBeenCalled();
    });

    it('checks added tags against the department and category the ticket moves to', async () => {
        mockPrisma.category.findUnique.mockResolvedValue({ queueId: IT, isActive: true, archivedAt: null });
        mockPrisma.ticketAssignee.findMany.mockResolvedValue([]);
        mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
        mockPrisma.tag.count.mockResolvedValue(1);
        const response = await patch({ queueId: IT, categoryId: NETWORK, tagIds: [TAG, OTHER_TAG] });
        expect(response.status).toBe(200);
        expect(mockPrisma.tag.count).toHaveBeenCalledWith({ where: { id: { in: [OTHER_TAG] }, ...tagAvailabilityWhere(IT, NETWORK) } });
        expect(mockPrisma.ticketTag.createMany).toHaveBeenCalledWith({ data: [{ ticketId: 'ticket', tagId: TAG }, { ticketId: 'ticket', tagId: OTHER_TAG }] });
    });

    it('lets agents remove any tag, including one that no longer fits', async () => {
        expect((await patch({ tagIds: [] })).status).toBe(200);
        expect(mockPrisma.ticketTag.deleteMany).toHaveBeenCalledWith({ where: { ticketId: 'ticket' } });
        expect(mockPrisma.ticketTag.createMany).not.toHaveBeenCalled();
    });

    it('does not let requesters change tags', async () => {
        asRole('USER');
        expect((await patch({ tagIds: [] })).status).toBe(403);
    });
});
