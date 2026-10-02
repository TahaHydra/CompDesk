const mockAuth = jest.fn();
const mockAttachment = jest.fn();
const mockRead = jest.fn().mockResolvedValue(Buffer.from('private'));
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: { attachment: { findUnique: mockAttachment } } }));
jest.mock('@/lib/permissions', () => ({ canAccessTicket: jest.fn().mockResolvedValue(true) }));
jest.mock('node:fs/promises', () => ({ readFile: mockRead, unlink: jest.fn() }));
jest.mock('@/lib/attachment-storage', () => ({ resolveStoredAttachmentPath: () => '/private/file' }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/upload/[id]/route';
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
