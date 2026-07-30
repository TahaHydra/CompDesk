const mockAuth = jest.fn();
const mockGetQueueInboxQueueIds = jest.fn();
const mockPrisma = {
    ticket: { findMany: jest.fn(), count: jest.fn() },
    category: { findFirst: jest.fn() },
    slaPolicy: { findMany: jest.fn() },
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({ getQueueInboxQueueIds: mockGetQueueInboxQueueIds }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { GET as getTickets } from '@/app/api/tickets/route';
import { filterDashboardLinksForQueueAccess, parseDashboardLinks } from '@/lib/dashboard-links';
import { broadestTicketView, buildTicketTextSearch, buildTicketVisibilityWhere } from '@/lib/ticket-search';

function source(relativePath: string) { return fs.readFileSync(path.join(process.cwd(), ...relativePath.split('/')), 'utf8'); }
function request(query = '') { return new NextRequest(`http://localhost/api/tickets${query ? `?${query}` : ''}`); }
function session(role: 'USER' | 'AGENT' | 'ADMIN' | 'SUPER_ADMIN') { return { user: { id: `${role.toLowerCase()}-1`, email: `${role.toLowerCase()}@example.com`, role } }; }
function lastWhere() { return mockPrisma.ticket.findMany.mock.calls.at(-1)?.[0]?.where; }

beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.ticket.findMany.mockResolvedValue([]);
    mockPrisma.ticket.count.mockResolvedValue(0);
    mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
    mockGetQueueInboxQueueIds.mockResolvedValue(['queue-a', 'queue-b']);
});

describe('Phase 2 ticket authorization and search', () => {
    it.each([
        ['USER', 'my'], ['AGENT', 'queue'], ['ADMIN', 'all'], ['SUPER_ADMIN', 'all'],
    ] as const)('chooses the broadest permitted search scope for %s', (role, expected) => {
        expect(broadestTicketView(role)).toBe(expected);
    });

    it('never lets USER search escape requested tickets', async () => {
        mockAuth.mockResolvedValue(session('USER'));
        await getTickets(request('search=finance'));
        expect(lastWhere().AND[0]).toEqual({ requesterId: 'user-1' });
        expect(JSON.stringify(lastWhere())).toContain('finance');
        expect(JSON.stringify(lastWhere())).toContain('"status":{"not":"WITHDRAWN"}');
    });

    it('keeps AGENT and ADMIN searches inside centralized department scope', async () => {
        mockAuth.mockResolvedValue(session('AGENT'));
        await getTickets(request('search=printer'));
        expect(mockGetQueueInboxQueueIds).toHaveBeenCalledWith('agent-1', 'AGENT');
        expect(lastWhere().AND[0]).toEqual({ queueId: { in: ['queue-a', 'queue-b'] } });

        mockAuth.mockResolvedValue(session('ADMIN'));
        await getTickets(request('view=all&search=printer'));
        expect(lastWhere().AND[0]).toEqual({ queueId: { in: ['queue-a', 'queue-b'] } });
    });

    it('allows SUPER_ADMIN global search without changing other roles', async () => {
        mockAuth.mockResolvedValue(session('SUPER_ADMIN'));
        await getTickets(request('search=printer'));
        expect(lastWhere().AND[0]).toEqual({});
        expect(mockGetQueueInboxQueueIds).not.toHaveBeenCalled();
    });

    it('searches requester, assignee, exact IDs, tags, categories, and departments', () => {
        const serialized = JSON.stringify(buildTicketTextSearch('needle'));
        for (const field of ['requesterId', 'assignments', 'userId', 'requester', 'user', 'email', 'tags', 'category', 'queue']) {
            expect(serialized).toContain(`"${field}"`);
        }
    });

    it('supports unassigned, tags-any, and matching category/department filters', async () => {
        mockAuth.mockResolvedValue(session('AGENT'));
        mockPrisma.category.findFirst.mockResolvedValue({ queueId: 'queue-a' });
        const response = await getTickets(request('view=queue&queueId=queue-a&categoryId=category-a&assigneeId=unassigned&tagIds=tag-a,tag-b'));
        expect(response.status).toBe(200);
        const serialized = JSON.stringify(lastWhere());
        expect(serialized).toContain('"assignments":{"none":{}}');
        expect(serialized).toContain('"tagId":{"in":["tag-a","tag-b"]}');
        expect(serialized).toContain('"categoryId":"category-a"');
    });

    it('rejects a category combined with another department', async () => {
        mockAuth.mockResolvedValue(session('AGENT'));
        mockPrisma.category.findFirst.mockResolvedValue({ queueId: 'queue-b' });
        const response = await getTickets(request('queueId=queue-a&categoryId=category-b'));
        expect(response.status).toBe(400);
        expect(mockPrisma.ticket.findMany).not.toHaveBeenCalled();
    });

    it('maps pending to the same two statuses counted by the dashboard', async () => {
        mockAuth.mockResolvedValue(session('AGENT'));
        await getTickets(request('view=queue&status=pending'));
        expect(JSON.stringify(lastWhere())).toContain('"in":["PENDING_USER","PENDING_AGENT"]');
        expect(source('src/app/api/dashboard/stats/route.ts')).toContain("status: { in: ['PENDING_USER', 'PENDING_AGENT'] }");
    });
});

describe('Phase 2 dashboard and quick links', () => {
    const queueId = '550e8400-e29b-41d4-a716-446655440000';
    const categoryId = '550e8400-e29b-41d4-a716-446655440001';

    it('parses existing untyped links as external links', () => {
        expect(parseDashboardLinks([{ title: 'Docs', url: 'https://example.com', iconUrl: '' }])).toEqual([
            { type: 'external', title: 'Docs', url: 'https://example.com', iconUrl: '' },
        ]);
    });

    it('parses ticket-form links without storing a template ID', () => {
        const parsed = parseDashboardLinks([{ type: 'ticket_form', title: 'IT request', queueId, categoryId, iconUrl: '' }]);
        expect(parsed[0]).toMatchObject({ type: 'ticket_form', queueId, categoryId });
        expect(parsed[0]).not.toHaveProperty('templateId');
    });

        it('filters ticket-form quick links by effective department access while preserving external links', () => {
        const links = parseDashboardLinks([
            { type: 'external', title: 'Docs', url: 'https://example.com', iconUrl: '' },
            { type: 'ticket_form', title: 'Allowed', queueId, iconUrl: '' },
            { type: 'ticket_form', title: 'Forbidden', queueId: '550e8400-e29b-41d4-a716-446655440099', iconUrl: '' },
        ]);
        expect(filterDashboardLinksForQueueAccess(links, [queueId]).map((link) => link.title)).toEqual(['Docs', 'Allowed']);
        expect(filterDashboardLinksForQueueAccess(links, null)).toEqual(links);
        expect(source('src/app/api/dashboard/stats/route.ts')).toContain('filterDashboardLinksForQueueAccess');
    });
it('uses role-specific dashboard scope and a multi-status pending link', () => {
        const dashboard = source('src/app/(dashboard)/dashboard/page.tsx');
        const stats = source('src/app/api/dashboard/stats/route.ts');
        expect(stats).toContain('broadestTicketView(role)');
        expect(dashboard).toContain("ticketHref('&status=pending')");
        expect(buildTicketVisibilityWhere('agent-1', 'AGENT', 'queue', ['queue-a'])).toEqual({ queueId: { in: ['queue-a'] } });
    });

    it('preselects only returned departments/categories and keeps the resolver authoritative', () => {
        const newTicket = source('src/app/(dashboard)/tickets/new/page.tsx');
        expect(newTicket).toContain("departmentsQuery.data.find((item) => item.id === requestedQueueId)");
        expect(newTicket).toContain("categoriesQuery.data.find((item) => item.id === requestedCategoryId)");
        expect(newTicket).toContain('inactive or not available to your account');
        expect(newTicket).toContain('/api/ticket-form/resolve');
        expect(newTicket).not.toContain("searchParams.get('templateId')");
    });
});