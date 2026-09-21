const mockAuth = jest.fn();
const mockCanAccessQueue = jest.fn();
const mockCanAccessTicket = jest.fn();
const mockAuthenticate = jest.fn();
const mockPrisma = {
    ticket: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), updateMany: jest.fn() },
    queue: { findFirst: jest.fn() },
    slaPolicy: { findMany: jest.fn(), findUnique: jest.fn() },
    user: { upsert: jest.fn(), findMany: jest.fn() },
    groupMember: { findMany: jest.fn() },
    queueMember: { findMany: jest.fn() },
    timelineEvent: { createMany: jest.fn() },
    $transaction: jest.fn(),
};
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/permissions', () => ({
    canAccessQueue: mockCanAccessQueue, canAccessTicket: mockCanAccessTicket,
    getQueueInboxQueueIds: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/api-clients', () => ({
    authenticateApiRequest: mockAuthenticate,
    apiClientCanAccessQueue: (client: { allowedQueueIds: string[] }, id: string) => client.allowedQueueIds.includes(id),
    auditExternalApiRequest: jest.fn(),
}));
jest.mock('@/lib/database-rate-limit', () => ({ consumeDatabaseRateLimit: jest.fn().mockResolvedValue({ allowed: true }) }));
jest.mock('@/lib/feature-flags', () => ({ getFeatureFlag: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendTicketCreatedEmail: jest.fn(), sendNewTicketForDepartmentEmail: jest.fn(), sendTicketUpdatedEmail: jest.fn() }));
jest.mock('@/lib/webhooks', () => ({ fireWebhook: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn(), info: jest.fn() } }));

import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { GET, POST } from '@/app/api/tickets/route';
import { PATCH } from '@/app/api/tickets/[id]/route';
import { POST as apiPost } from '@/app/api/v1/tickets/route';
import { createTicketFromResolvedTemplate } from '@/lib/tickets/create-ticket';
import * as templateService from '@/lib/ticket-form/service';

const queueId = '550e8400-e29b-41d4-a716-446655440000';
const otherQueueId = '550e8400-e29b-41d4-a716-446655440001';
const user = { id: '550e8400-e29b-41d4-a716-446655440002', email: 'user@example.com', role: 'USER' as const };
const idempotencyId = '550e8400-e29b-41d4-a716-446655440003';
const rawTicket = () => ({
    id: 'ticket', requesterId: user.id, queueId, version: 1, status: 'OPEN', priority: 'NORMAL', createdAt: new Date(),
    assignments: [], queue: { id: queueId, name: 'Support' },
    formSchemaSnapshot: { templateId: 'form', templateName: 'Form', version: 1, fields: [
        { id: 'public', fieldKey: 'public', label: 'Public', type: 'TEXT', visibleTo: ['USER', 'AGENT'], editableBy: ['USER', 'AGENT'], isActive: true },
        { id: 'internal', fieldKey: 'internal', label: 'Internal', type: 'TEXT', defaultValue: 'private-default', visibleTo: ['AGENT'], editableBy: ['AGENT'], isActive: true },
    ] },
    submittedFormValues: { public: 'visible', internal: 'private-value' },
});
const request = (external = false, requestedQueue = queueId) => new NextRequest(`http://localhost/api/${external ? 'v1/' : ''}tickets`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queueId: requestedQueue, idempotencyKey: idempotencyId, ...(external ? { userEmail: user.email } : {}) }),
});

beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ user });
    mockCanAccessQueue.mockResolvedValue(true);
    mockCanAccessTicket.mockResolvedValue(true);
    mockPrisma.queue.findFirst.mockResolvedValue({ id: queueId });
    mockPrisma.ticket.findMany.mockResolvedValue([rawTicket()]);
    mockPrisma.ticket.findFirst.mockResolvedValue(rawTicket());
    mockPrisma.ticket.count.mockResolvedValue(1);
    mockPrisma.slaPolicy.findMany.mockResolvedValue([]);
    mockPrisma.slaPolicy.findUnique.mockResolvedValue(null);
    mockPrisma.groupMember.findMany.mockResolvedValue([]);
    mockPrisma.queueMember.findMany.mockResolvedValue([]);
    mockPrisma.user.upsert.mockResolvedValue(user);
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.ticket.findUnique.mockResolvedValue(rawTicket());
    mockPrisma.ticket.findUniqueOrThrow.mockResolvedValue(rawTicket());
    mockPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.$transaction.mockImplementation((callback) => callback(mockPrisma));
    mockAuthenticate.mockResolvedValue({ ok: true, client: { id: 'client', name: 'Client', allowedQueueIds: [queueId] } });
});

function prepareCreation() {
    mockPrisma.ticket.findFirst.mockResolvedValueOnce(null);
    jest.spyOn(templateService, 'resolveTicketFormTemplate').mockResolvedValue({
        template: { id: 'template', name: 'Form', version: 1, description: null, isActive: true, isSystemDefault: false, archivedAt: null, fields: [] },
        allFields: [], fields: [], role: 'USER', source: 'system', queue: { id: queueId, name: 'Support' }, category: null,
    });
}

it('projects the freshly created response for the requester role', async () => {
    prepareCreation();
    mockPrisma.$transaction.mockResolvedValue(rawTicket());
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(await response.text()).not.toContain('private-');
});

it('projects the response when creation loses an idempotency race', async () => {
    prepareCreation();
    mockPrisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Duplicate key', { code: 'P2002', clientVersion: 'test' }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('private-');
});

it('rejects an out-of-scope result even after a concurrent duplicate-key conflict', async () => {
    prepareCreation();
    mockPrisma.ticket.findFirst.mockResolvedValue({ ...rawTicket(), queueId: otherQueueId });
    mockPrisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Duplicate key', { code: 'P2002', clientVersion: 'test' }));
    const response = await apiPost(request(true));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('private-');
});

it('projects requester status update responses without hidden historical fields', async () => {
    const response = await PATCH(new NextRequest('http://localhost/api/tickets/ticket', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PENDING_AGENT', expectedVersion: 1 }),
    }), { params: Promise.resolve({ id: 'ticket' }) });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('private-');
});

it('does not expose hidden field definitions or values in requester ticket lists', async () => {
    const response = await GET(new NextRequest('http://localhost/api/tickets'));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain('private-default');
    expect(JSON.stringify(payload)).not.toContain('private-value');
    expect(JSON.stringify(payload)).toContain('visible');
});

it('projects the idempotent web creation response for the requester role', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('private-');
});

it('projects the external creation replay as the requester role', async () => {
    const response = await apiPost(request(true));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('private-');
});

it('rejects replay from a ticket moved to a department outside the API client scope', async () => {
    mockPrisma.ticket.findFirst.mockResolvedValue({ ...rawTicket(), queueId: otherQueueId });
    const response = await apiPost(request(true));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('private-value');
});

it('rechecks web access to the stored ticket before replaying it', async () => {
    mockCanAccessTicket.mockResolvedValue(false);
    await expect(createTicketFromResolvedTemplate({ source: 'web', actor: user, requester: user, input: { queueId, idempotencyKey: idempotencyId } }))
        .rejects.toMatchObject({ status: 403 });
});

it('rejects replay when the current API client has lost access to the stored department', async () => {
    await expect(createTicketFromResolvedTemplate({
        source: 'api', actor: user, requester: user, input: { queueId, idempotencyKey: idempotencyId },
        apiClient: { id: 'client', name: 'Client', allowedQueueIds: [], allowAllQueues: false },
    })).rejects.toMatchObject({ status: 403 });
});
