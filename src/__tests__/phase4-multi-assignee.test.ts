import fs from 'fs';
import path from 'path';
import { AssignmentSource, Prisma } from '@prisma/client';

const mockAssignments = new Map<string, { id: string; ticketId: string; userId: string; assignedById: string; assignedAt: Date; source: AssignmentSource; user: any; assignedBy: any }>();
const mockUsers = new Map<string, any>();
const mockCanAccessTicket = jest.fn();
const mockCanAccessQueue = jest.fn();
const mockSendAssigned = jest.fn();
const mockAudit = jest.fn();
const mockTimelineCreate = jest.fn();
const mockWebhook = jest.fn();
let mockVersion = 1;
let mockFirstAssignedAt: Date | null = null;

const mockPrisma: any = {
    ticket: {
        findUnique: jest.fn(async () => ({ id: 'ticket-1', key: 'TCK-1', title: 'Test', queueId: 'queue-1', requesterId: 'requester-1', firstAssignedAt: mockFirstAssignedAt, version: mockVersion })),
        updateMany: jest.fn(async ({ where, data }: any) => {
            if (where.version !== mockVersion) return { count: 0 };
            mockVersion += data.version?.increment ?? 0;
            if (data.firstAssignedAt) mockFirstAssignedAt = data.firstAssignedAt;
            return { count: 1 };
        }),
    },
    user: { findUnique: jest.fn(async ({ where }: any) => mockUsers.get(where.id) ?? null) },
    ticketAssignee: {
        findMany: jest.fn(async ({ where }: any) => [...mockAssignments.values()].filter((row) => row.ticketId === where.ticketId).map((row) => ({ ...row }))),
        findUnique: jest.fn(async ({ where }: any) => mockAssignments.get(`${where.ticketId_userId.ticketId}:${where.ticketId_userId.userId}`) ?? null),
        create: jest.fn(async ({ data }: any) => {
            const key = `${data.ticketId}:${data.userId}`;
            if (mockAssignments.has(key)) throw new Prisma.PrismaClientKnownRequestError('Unique assignment', { code: 'P2002', clientVersion: '6.19.3' });
            const user = mockUsers.get(data.userId);
            const actor = mockUsers.get(data.assignedById);
            const row = { id: `assignment-${mockAssignments.size + 1}`, ...data, assignedAt: new Date(), user, assignedBy: actor };
            mockAssignments.set(key, row);
            return row;
        }),
        deleteMany: jest.fn(async ({ where }: any) => ({ count: mockAssignments.delete(`${where.ticketId}:${where.userId}`) ? 1 : 0 })),
    },
    timelineEvent: { create: mockTimelineCreate },
};
mockPrisma.$transaction = jest.fn(async (callback: any) => callback(mockPrisma));

jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({
    canAccessTicket: mockCanAccessTicket,
    canAccessQueue: mockCanAccessQueue,
    isAgentRole: (role: string) => ['AGENT', 'ADMIN', 'SUPER_ADMIN'].includes(role),
    canDeleteTicket: (userId: string, role: string, ticket: { requesterId: string; assignmentCount: number }) => role === 'SUPER_ADMIN' || (ticket.requesterId === userId && ticket.assignmentCount === 0),
}));
jest.mock('@/lib/email', () => ({ sendTicketAssignedEmail: mockSendAssigned }));
jest.mock('@/lib/audit', () => ({ auditLog: mockAudit }));
jest.mock('@/lib/webhooks', () => ({ fireWebhook: mockWebhook }));

import { addAssignee, claimTicket, listAssignments, removeAssignee } from '@/lib/tickets/assignment-service';
import { buildTicketTextSearch, buildTicketVisibilityWhere } from '@/lib/ticket-search';
import { canDeleteTicket } from '@/lib/permissions';

const agent1 = '11111111-1111-4111-8111-111111111111';
const agent2 = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
function actor(id: string, role: 'AGENT' | 'ADMIN' | 'SUPER_ADMIN' = 'AGENT') { return { id, role }; }
function source(file: string) { return fs.readFileSync(path.join(process.cwd(), ...file.split('/')), 'utf8'); }

beforeEach(() => {
    jest.clearAllMocks();
    mockAssignments.clear();
    mockVersion = 1;
    mockFirstAssignedAt = null;
    mockUsers.clear();
    for (const [id, role, active] of [[agent1, 'AGENT', true], [agent2, 'ADMIN', true], [outsider, 'AGENT', true]] as const) {
        mockUsers.set(id, { id, name: id === agent1 ? 'Agent One' : id === agent2 ? 'Agent Two' : 'Outside Agent', email: `${id}@example.com`, image: null, role, isActive: active });
    }
    mockCanAccessTicket.mockResolvedValue(true);
    mockCanAccessQueue.mockResolvedValue(true);
    mockTimelineCreate.mockResolvedValue({});
    mockAudit.mockResolvedValue(undefined);
    mockSendAssigned.mockResolvedValue(true);
});

describe('Phase 4 multi-assignee service', () => {
    it('lets two different agents claim sequential versions and preserves both', async () => {
        await claimTicket(actor(agent1), 'ticket-1', 1);
        await claimTicket(actor(agent2, 'ADMIN'), 'ticket-1', 2);
        expect([...mockAssignments.values()].map((row) => row.userId).sort()).toEqual([agent1, agent2].sort());
        expect(mockFirstAssignedAt).toBeInstanceOf(Date);
        expect(mockPrisma.ticket.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ firstPublicResponseAt: expect.anything() }) }));
    });

    it('rejects one of two simultaneous stale assignment mutations', async () => {
        const results = await Promise.allSettled([
            claimTicket(actor(agent1), 'ticket-1', 1),
            claimTicket(actor(agent2, 'ADMIN'), 'ticket-1', 1),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect(mockAssignments.size).toBe(1);
    });

    it('makes a duplicate claim idempotent when submitted against the current version', async () => {
        await claimTicket(actor(agent1), 'ticket-1', 1);
        const duplicate = await claimTicket(actor(agent1), 'ticket-1', 2);
        expect(duplicate.alreadyAssigned).toBe(true);
        expect(mockAssignments.size).toBe(1);
        expect(mockSendAssigned).toHaveBeenCalledTimes(1);
    });

    it('rejects USER assignment while permitting scoped ADMIN and global SUPER_ADMIN actors', async () => {
        await expect(addAssignee({ id: 'requester-1', role: 'USER' }, 'ticket-1', agent1, 1)).rejects.toMatchObject({ status: 403 });
        await expect(addAssignee(actor(agent2, 'ADMIN'), 'ticket-1', agent1, 1)).resolves.toMatchObject({ alreadyAssigned: false });
        await removeAssignee(actor(agent2, 'ADMIN'), 'ticket-1', agent1, 2);
        await expect(addAssignee(actor(agent2, 'SUPER_ADMIN'), 'ticket-1', agent1, 3)).resolves.toMatchObject({ alreadyAssigned: false });
    });

    it('limits end-user assignment listings to safe identity fields', async () => {
        await addAssignee(actor(agent1), 'ticket-1', agent2, 1);
        const assignments = await listAssignments({ id: 'requester-1', role: 'USER' }, 'ticket-1');
        expect(assignments).toHaveLength(1);
        expect(assignments[0].user).toEqual({ id: agent2, name: 'Agent Two', image: null });
        expect(assignments[0].user).not.toHaveProperty('email');
        expect(assignments[0]).not.toHaveProperty('assignedBy');
    });

    it('rejects unauthorized departments and inactive candidates', async () => {
        mockCanAccessTicket.mockResolvedValueOnce(false);
        await expect(claimTicket(actor(agent1), 'ticket-1', 1)).rejects.toMatchObject({ status: 403 });
        mockCanAccessTicket.mockResolvedValue(true);
        mockUsers.set(outsider, { ...mockUsers.get(outsider), isActive: false });
        await expect(addAssignee(actor(agent1), 'ticket-1', outsider, 1)).rejects.toMatchObject({ status: 400 });
    });

    it('removes one assignee without disturbing another and the final removal is unassigned', async () => {
        await addAssignee(actor(agent1), 'ticket-1', agent1, 1);
        await addAssignee(actor(agent1), 'ticket-1', agent2, 2);
        await removeAssignee(actor(agent1), 'ticket-1', agent1, 3);
        expect([...mockAssignments.values()].map((row) => row.userId)).toEqual([agent2]);
        const final = await removeAssignee(actor(agent2, 'ADMIN'), 'ticket-1', agent2, 4);
        expect(final.resultingAssignmentIds).toEqual([]);
        expect(mockAssignments.size).toBe(0);
    });

    it('records actor/source/history and only notifies a newly added user', async () => {
        await addAssignee(actor(agent1), 'ticket-1', agent2, 1, AssignmentSource.ESCALATION);
        await addAssignee(actor(agent1), 'ticket-1', agent2, 2, AssignmentSource.ESCALATION);
        expect(mockTimelineCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'ASSIGNMENT_CHANGE', metadata: expect.objectContaining({ addedUserId: agent2, source: 'ESCALATION' }) }) }));
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ userId: agent1, action: 'ticket.assignment_added' }));
        expect(mockSendAssigned).toHaveBeenCalledTimes(1);
    });
});
describe('Phase 4 migration and workflow contracts', () => {
    it('backfills and verifies legacy assignments before dropping the legacy column', () => {
        const sql = source('prisma/migrations/20260727130000_add_multiple_ticket_assignees/migration.sql');
        const insert = sql.indexOf('INSERT INTO "ticket_assignees"');
        const verification = sql.indexOf('Ticket assignment backfill verification failed');
        const drop = sql.indexOf('DROP COLUMN "assignee_id"');
        expect(insert).toBeGreaterThan(0);
        expect(verification).toBeGreaterThan(insert);
        expect(drop).toBeGreaterThan(verification);
        expect(sql).toContain('UNIQUE INDEX "ticket_assignees_ticket_id_user_id_key"');
        expect(sql.toLowerCase()).toContain('rollback');
    });

    it('uses assignment membership for My Tickets, search, filters, and unassigned', () => {
        expect(buildTicketVisibilityWhere(agent1, 'AGENT', 'my', ['queue-1'])).toEqual({ OR: [{ assignments: { some: { userId: agent1 } } }, { requesterId: agent1 }] });
        const search = JSON.stringify(buildTicketTextSearch(agent2));
        expect(search).toContain('"assignments"');
        expect(search).toContain('"userId"');
        const route = source('src/app/api/tickets/route.ts');
        expect(route).toContain("{ assignments: { none: {} } }");
        expect(route).toContain("{ assignments: { some: { userId: assigneeId } } }");
    });

    it('forbids requester withdrawal after the first assignment while preserving SUPER_ADMIN deletion', () => {
        expect(canDeleteTicket('requester-1', 'USER', { requesterId: 'requester-1', assignmentCount: 1 })).toBe(false);
        expect(canDeleteTicket('super-1', 'SUPER_ADMIN', { requesterId: 'requester-1', assignmentCount: 2 })).toBe(true);
    });

    it('keeps escalation additive and exposes all assignees in external and internal payloads', () => {
        const escalation = source('src/app/api/tickets/[id]/escalate/route.ts');
        expect(escalation).toContain('AssignmentSource.ESCALATION');
        expect(escalation).toContain("assignmentBehavior: 'additive'");
        expect(escalation).not.toContain('assigneeId:');
        expect(source('src/app/api/v1/tickets/route.ts')).toContain('assignments:');
        expect(source('src/app/api/dashboard/stats/route.ts')).toContain('assignments:');
    });

    it('provides additive claim, unclaim, searchable management, and non-duplicating UI operations', () => {
        const page = source('src/app/(dashboard)/tickets/[id]/page.tsx');
        expect(page).toContain("runAssignment('claim')");
        expect(page).toContain("runAssignment('unclaim')");
        expect(page).toContain('assignmentRequestLock.current');
        expect(page).toContain('Search to add an assignee');
        expect(page).toContain('assignments.map');
    });
});
