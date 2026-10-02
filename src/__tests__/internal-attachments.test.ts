const mockAuth = jest.fn();
const mockAttachment = jest.fn();
const mockRead = jest.fn().mockResolvedValue(Buffer.from('private'));
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: { attachment: { findUnique: mockAttachment } } }));
jest.mock('@/lib/permissions', () => ({ canAccessTicket: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/feature-flags', () => ({ getFeatureFlag: jest.fn().mockResolvedValue(true) }));
jest.mock('node:fs/promises', () => ({ readFile: mockRead, unlink: jest.fn() }));
jest.mock('@/lib/attachment-storage', () => ({ resolveStoredAttachmentPath: () => '/private/file' }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
import { NextRequest } from 'next/server';
import { GET, DELETE } from '@/app/api/upload/[id]/route';
beforeEach(() => { jest.clearAllMocks(); mockAttachment.mockResolvedValue({ id: 'a', ticketId: 't', isInternal: true, ticket: { id: 't' }, filename: 'private.txt', detectedMimetype: 'text/plain', scanStatus: 'NOT_CONFIGURED', path: 'private/t/file' }); });
test('requesters cannot download internal attachments even with ticket access', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'requester', role: 'USER' } });
    const response = await GET(new NextRequest('http://localhost/api/upload/a'), { params: Promise.resolve({ id: 'a' }) });
    expect(response.status).toBe(403); expect(mockRead).not.toHaveBeenCalled();
});
test('authorized staff can still download internal attachments', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'agent', role: 'AGENT' } });
    expect((await GET(new NextRequest('http://localhost/api/upload/a'), { params: Promise.resolve({ id: 'a' }) })).status).toBe(200);
});

const privateFileTicket = (shared = false) => ({ id: 't', requesterId: 'owner', queueId: 'q',
    formSchemaSnapshot: { templateId: 'form', templateName: 'Form', version: 1, fields: [
        { id: 'private', fieldKey: 'private', label: 'Private', type: 'FILE', visibleTo: ['ADMIN'], editableBy: ['ADMIN'], isActive: true },
        ...(shared ? [{ id: 'public', fieldKey: 'public', label: 'Public', type: 'FILE', visibleTo: ['USER', 'AGENT', 'ADMIN'], editableBy: ['ADMIN'], isActive: true }] : []),
    ] },
    submittedFormValues: { private: [{ url: '/api/upload/a', filename: 'private.txt', size: 7 }], ...(shared ? { public: [{ url: '/api/upload/a', filename: 'private.txt', size: 7 }] } : {}) },
});
test.each([false, true])('role-restricted FILE bytes cannot bypass through download or removal (shared=%s)', async (shared) => {
    mockAuth.mockResolvedValue({ user: { id: 'agent', role: 'AGENT' } });
    mockAttachment.mockResolvedValue({ id: 'a', ticketId: 't', isInternal: false, ticket: privateFileTicket(shared), filename: 'private.txt', size: 7, detectedMimetype: 'text/plain', scanStatus: 'CLEAN', path: 'private/t/file' });
    expect((await GET(new NextRequest('http://localhost/api/upload/a'), { params: Promise.resolve({ id: 'a' }) })).status).toBe(403);
    expect(mockRead).not.toHaveBeenCalled();
    expect((await DELETE(new NextRequest('http://localhost/api/upload/a', { method: 'DELETE' }), { params: Promise.resolve({ id: 'a' }) })).status).toBe(403);
});

test('the field-authorized administrator can download restricted form attachments', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } });
    mockAttachment.mockResolvedValue({ id: 'a', ticketId: 't', isInternal: false, ticket: privateFileTicket(), filename: 'private.txt', size: 7, detectedMimetype: 'text/plain', scanStatus: 'CLEAN', path: 'private/t/file' });
    expect((await GET(new NextRequest('http://localhost/api/upload/a'), { params: Promise.resolve({ id: 'a' }) })).status).toBe(200);
});

test('a field that agents can view but cannot edit allows download and rejects removal', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'agent', role: 'AGENT' } });
    const ticket = privateFileTicket();
    ticket.formSchemaSnapshot.fields[0].visibleTo = ['AGENT', 'ADMIN'];
    mockAttachment.mockResolvedValue({ id: 'a', ticketId: 't', isInternal: false, ticket, filename: 'private.txt', size: 7, detectedMimetype: 'text/plain', scanStatus: 'CLEAN', path: 'private/t/file' });
    expect((await GET(new NextRequest('http://localhost/api/upload/a'), { params: Promise.resolve({ id: 'a' }) })).status).toBe(200);
    expect((await DELETE(new NextRequest('http://localhost/api/upload/a', { method: 'DELETE' }), { params: Promise.resolve({ id: 'a' }) })).status).toBe(403);
});
