const mockAuth = jest.fn();
const mockTx = {
    $executeRaw: jest.fn(),
    savedReply: { count: jest.fn(), create: jest.fn() },
};
const mockPrisma = {
    savedReply: { findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn((callback: (tx: typeof mockTx) => unknown) => callback(mockTx)),
};
const mockAudit = jest.fn();

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: mockAudit }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/saved-replies/route';
import { DELETE, PATCH } from '@/app/api/saved-replies/[id]/route';
import { POST as USE } from '@/app/api/saved-replies/[id]/use/route';
import { insertAtSelection, SAVED_REPLIES_PER_USER } from '@/lib/saved-replies';

const replyId = '550e8400-e29b-41d4-a716-446655440010';
const as = (role: string, id = `${role.toLowerCase()}-id`) => mockAuth.mockResolvedValue({ user: { id, role, name: role, email: `${id}@example.com` } });
const json = (method: string, body: unknown, url = 'http://localhost/api/saved-replies') =>
    new NextRequest(url, { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const params = (id = replyId) => ({ params: Promise.resolve({ id }) });

describe('saved replies API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTx.savedReply.count.mockResolvedValue(0);
        mockTx.savedReply.create.mockImplementation(async ({ data }: { data: { title: string; content: string } }) => ({ id: replyId, ...data, useCount: 0 }));
    });

    it('is a staff tool: requesters are refused everywhere', async () => {
        as('USER');
        expect((await GET()).status).toBe(403);
        expect((await POST(json('POST', { title: 'Hi', content: 'Hello' }))).status).toBe(403);
        expect((await PATCH(json('PATCH', { title: 'x' }), params())).status).toBe(403);
        expect((await DELETE(new NextRequest('http://localhost', { method: 'DELETE' }), params())).status).toBe(403);
        expect((await USE(new NextRequest('http://localhost', { method: 'POST' }), params())).status).toBe(403);
        expect(mockPrisma.savedReply.findMany).not.toHaveBeenCalled();
    });

    it('lists only the caller\'s own replies, most used first', async () => {
        as('AGENT', 'agent-1');
        mockPrisma.savedReply.findMany.mockResolvedValue([]);
        expect((await GET()).status).toBe(200);
        expect(mockPrisma.savedReply.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { ownerId: 'agent-1' },
            orderBy: [{ useCount: 'desc' }, { title: 'asc' }],
        }));
    });

    it('creates replies for the caller only and audits without content', async () => {
        as('AGENT', 'agent-1');
        const response = await POST(json('POST', { title: '  Greeting ', content: 'Hello there', ownerId: 'someone-else' }));
        // Unknown fields such as ownerId are rejected rather than silently trusted.
        expect(response.status).toBe(400);

        const created = await POST(json('POST', { title: '  Greeting ', content: 'Hello there' }));
        expect(created.status).toBe(201);
        expect(mockTx.savedReply.create).toHaveBeenCalledWith(expect.objectContaining({ data: { ownerId: 'agent-1', title: 'Greeting', content: 'Hello there' } }));
        expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'saved_reply.created', metadata: { contentLength: 11 } }));
        expect(JSON.stringify(mockAudit.mock.calls)).not.toContain('Hello there');
    });

    it('enforces the per-user cap under a lock', async () => {
        as('ADMIN', 'admin-cap');
        mockTx.savedReply.count.mockResolvedValue(SAVED_REPLIES_PER_USER);
        const response = await POST(json('POST', { title: 'One more', content: 'Text' }));
        expect(response.status).toBe(409);
        expect(mockTx.$executeRaw).toHaveBeenCalled();
        expect(mockTx.savedReply.create).not.toHaveBeenCalled();
    });

    it('rejects empty and oversized replies', async () => {
        as('AGENT', 'agent-size');
        expect((await POST(json('POST', { title: '', content: 'Text' }))).status).toBe(400);
        expect((await POST(json('POST', { title: 'Big', content: 'x'.repeat(10001) }))).status).toBe(400);
    });

    it('treats another user\'s reply as not found on update, delete and use', async () => {
        as('AGENT', 'agent-2');
        mockPrisma.savedReply.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.savedReply.deleteMany.mockResolvedValue({ count: 0 });
        expect((await PATCH(json('PATCH', { title: 'Mine now' }), params())).status).toBe(404);
        expect((await DELETE(new NextRequest('http://localhost', { method: 'DELETE' }), params())).status).toBe(404);
        expect((await USE(new NextRequest('http://localhost', { method: 'POST' }), params())).status).toBe(404);
        expect(mockPrisma.savedReply.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: replyId, ownerId: 'agent-2' } }));
        expect(mockPrisma.savedReply.deleteMany).toHaveBeenCalledWith({ where: { id: replyId, ownerId: 'agent-2' } });
    });

    it('rejects malformed ids without touching the database', async () => {
        as('AGENT', 'agent-3');
        expect((await DELETE(new NextRequest('http://localhost', { method: 'DELETE' }), params('not-a-uuid'))).status).toBe(404);
        expect(mockPrisma.savedReply.deleteMany).not.toHaveBeenCalled();
    });
});

describe('inserting a saved reply into a draft', () => {
    it('inserts at the caret without replacing the draft', () => {
        expect(insertAtSelection('Hello world', 'dear', 6, 6)).toEqual({ value: 'Hello dear world', caret: 10 });
    });

    it('replaces only the selected text', () => {
        expect(insertAtSelection('Hello NAME!', 'Marie', 6, 10)).toEqual({ value: 'Hello Marie!', caret: 11 });
    });

    it('appends to the end when the caret is unknown, with a separating space', () => {
        expect(insertAtSelection('Thanks.', 'Regards', null, null)).toEqual({ value: 'Thanks. Regards', caret: 15 });
        expect(insertAtSelection('', 'Regards', null, null)).toEqual({ value: 'Regards', caret: 7 });
    });
});
