const mockAuth = jest.fn();
const mockPrisma = {
    user: { findUnique: jest.fn() },
    ticket: { findUnique: jest.fn(), count: jest.fn() },
    timelineEvent: { count: jest.fn() },
    appSetting: { findUnique: jest.fn() },
    queueMember: { findMany: jest.fn() },
    groupMember: { findMany: jest.fn() },
};
const mockCanAccessTicket = jest.fn();
const mockInbox = jest.fn();
const mockAdministered = jest.fn();

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({
    canAccessTicket: (...args: unknown[]) => mockCanAccessTicket(...args),
    getQueueInboxQueueIds: (...args: unknown[]) => mockInbox(...args),
    getAdministeredQueueIds: (...args: unknown[]) => mockAdministered(...args),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/users/[id]/card/route';

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const REQUESTER_ID = '22222222-2222-4222-8222-222222222222';
const TICKET_ID = '33333333-3333-4333-8333-333333333333';
const IT = 'queue-it';
const HR = 'queue-hr';

const agent = { id: AGENT_ID, name: 'Martin Bernard', image: null, email: 'martin@example.com', role: 'AGENT', isActive: true, preferredLanguage: 'fr', jobTitle: 'Technician' };
const as = (id: string, role: string) => mockAuth.mockResolvedValue({ user: { id, role } });
const open = (subjectId: string, ticketId?: string) => GET(
    new NextRequest(`http://localhost/api/users/${subjectId}/card${ticketId ? `?ticketId=${ticketId}` : ''}`),
    { params: Promise.resolve({ id: subjectId }) },
);

describe('person card endpoint', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.findUnique.mockResolvedValue(agent);
        mockPrisma.appSetting.findUnique.mockResolvedValue(null);
        mockPrisma.queueMember.findMany.mockResolvedValue([
            { userId: AGENT_ID, queue: { id: IT, name: 'IT Support' } },
            { userId: AGENT_ID, queue: { id: HR, name: 'HR' } },
        ]);
        mockPrisma.groupMember.findMany.mockResolvedValue([]);
        mockPrisma.ticket.findUnique.mockResolvedValue({ id: TICKET_ID, requesterId: REQUESTER_ID, queueId: IT, assignments: [{ userId: AGENT_ID }], watchers: [] });
        mockPrisma.ticket.count.mockResolvedValue(2);
        mockPrisma.timelineEvent.count.mockResolvedValue(0);
        mockCanAccessTicket.mockResolvedValue(true);
        mockInbox.mockResolvedValue([IT]);
        mockAdministered.mockResolvedValue([]);
    });

    it('shows a requester the identity of their assigned agent, but no contact details by default', async () => {
        as(REQUESTER_ID, 'USER');
        const response = await open(AGENT_ID, TICKET_ID);
        expect(response.status).toBe(200);
        const card = await response.json();
        expect(card).toMatchObject({ name: 'Martin Bernard', role: 'AGENT', departments: ['IT Support'] });
        // Only the ticket's department, never the agent's full list; no email, language, job title or status.
        expect(card).not.toHaveProperty('email');
        expect(card).not.toHaveProperty('preferredLanguage');
        expect(card).not.toHaveProperty('jobTitle');
        expect(card).not.toHaveProperty('isActive');
        expect(card).not.toHaveProperty('openRequests');
    });

    it('applies the organisation policy when it widens visibility', async () => {
        mockPrisma.appSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ email: 'everyone', language: 'higher', jobTitle: 'everyone' }) });
        as(REQUESTER_ID, 'USER');
        const card = await (await open(AGENT_ID, TICKET_ID)).json();
        expect(card.email).toBe('martin@example.com');
        expect(card.jobTitle).toBe('Technician');
        expect(card).not.toHaveProperty('preferredLanguage');
    });

    it('requires the person to actually be on the ticket, not just ticket access', async () => {
        as(REQUESTER_ID, 'USER');
        mockPrisma.ticket.findUnique.mockResolvedValue({ id: TICKET_ID, requesterId: REQUESTER_ID, queueId: IT, assignments: [], watchers: [{ userId: AGENT_ID }] });
        expect((await open(AGENT_ID, TICKET_ID)).status).toBe(404);
        // Requesters never reach someone through internal notes.
        expect(mockPrisma.timelineEvent.count).toHaveBeenCalledWith({ where: { ticketId: TICKET_ID, userId: AGENT_ID, type: { not: 'INTERNAL_NOTE' } } });
    });

    it('refuses tickets the viewer cannot open', async () => {
        as(REQUESTER_ID, 'USER');
        mockCanAccessTicket.mockResolvedValue(false);
        expect((await open(AGENT_ID, TICKET_ID)).status).toBe(404);
    });

    it('never lets a requester open a card without a ticket', async () => {
        as(REQUESTER_ID, 'USER');
        expect((await open(AGENT_ID)).status).toBe(404);
    });

    it('lets staff open colleagues in a shared department, and nobody else', async () => {
        as('44444444-4444-4444-8444-444444444444', 'AGENT');
        expect((await open(AGENT_ID)).status).toBe(200);
        mockInbox.mockResolvedValue(['queue-finance']);
        expect((await open(AGENT_ID)).status).toBe(404);
    });

    it('gives the administrator of the ticket department the agent email and staff context', async () => {
        as('55555555-5555-4555-8555-555555555555', 'ADMIN');
        mockAdministered.mockResolvedValue([IT]);
        const card = await (await open(AGENT_ID, TICKET_ID)).json();
        expect(card.email).toBe('martin@example.com');
        // The agent also works in HR, which this IT admin cannot reach: not disclosed.
        expect(card.departments).toEqual(['IT Support']);
        expect(card).toMatchObject({ isActive: true, openRequests: 2, requestsHref: `/tickets?view=all&requesterId=${AGENT_ID}` });
    });

    it('shows staff the departments they share with the person, and Super Admins all of them', async () => {
        as('44444444-4444-4444-8444-444444444444', 'AGENT');
        mockInbox.mockResolvedValue([IT, HR]);
        expect((await (await open(AGENT_ID)).json()).departments).toEqual(['HR', 'IT Support']);
        as('99999999-9999-4999-8999-999999999999', 'SUPER_ADMIN');
        mockInbox.mockResolvedValue(null);
        expect((await (await open(AGENT_ID)).json()).departments).toEqual(['HR', 'IT Support']);
    });

    it('shows an agent the contact details of a colleague whose ticket they handle', async () => {
        as('44444444-4444-4444-8444-444444444444', 'AGENT');
        mockPrisma.ticket.findUnique.mockResolvedValue({ id: TICKET_ID, requesterId: AGENT_ID, queueId: IT, assignments: [], watchers: [] });
        const card = await (await open(AGENT_ID, TICKET_ID)).json();
        expect(card.email).toBe('martin@example.com');
        // Turned off by the organisation: back to the role levels (an agent does not see an agent).
        mockPrisma.appSetting.findUnique.mockResolvedValue({ value: JSON.stringify({ email: 'higher', language: 'higher', jobTitle: 'higher', requesterVisibleToHandlers: false }) });
        expect(await (await open(AGENT_ID, TICKET_ID)).json()).not.toHaveProperty('email');
    });

    it('treats malformed ids as not found', async () => {
        as(REQUESTER_ID, 'USER');
        expect((await open('not-a-uuid')).status).toBe(404);
        expect((await open(AGENT_ID, 'nope')).status).toBe(404);
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
});
