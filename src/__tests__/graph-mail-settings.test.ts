const mockAuth = jest.fn();
const mockGet = jest.fn();
const mockSend = jest.fn();
const mockUpsert = jest.fn();
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/prisma', () => ({ prisma: { appSetting: { upsert: mockUpsert }, $transaction: jest.fn() } }));
jest.mock('@/lib/graph-mail', () => ({ getMailSettings: mockGet, mailProvider: (values: any) => values.mail_provider || 'smtp', graphMailConfig: jest.fn(), sendGraphMail: mockSend }));
jest.mock('@/lib/settings-secret', () => ({ encryptSettingSecret: (value: string) => `encrypted:${value}` }));
jest.mock('@/lib/database-rate-limit', () => ({ consumeDatabaseRateLimit: jest.fn().mockResolvedValue({ allowed: true }) }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
import { NextRequest } from 'next/server';
import { GET, PATCH, POST } from '@/app/api/settings/mail/route';
beforeEach(() => { jest.clearAllMocks(); mockAuth.mockResolvedValue({ user: { id: 'admin', role: 'SUPER_ADMIN' } }); mockGet.mockResolvedValue({ mail_provider: 'graph', mail_graph_secret: 'encrypted:synthetic' }); });
test.each(['USER', 'AGENT', 'ADMIN'])('mail configuration and explicit test require SUPER_ADMIN (%s)', async (role) => {
    mockAuth.mockResolvedValue({ user: { id: 'u', role } });
    expect((await GET()).status).toBe(403);
    expect((await PATCH(new NextRequest('http://localhost'))).status).toBe(403);
    expect((await POST(new NextRequest('http://localhost'))).status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled(); expect(mockSend).not.toHaveBeenCalled();
});
test('GET reports only whether a secret is configured', async () => {
    const response = await GET();
    expect(await response.json()).toMatchObject({ secretConfigured: true });
    expect(JSON.stringify(await (await GET()).json())).not.toContain('synthetic');
});
test('replacement secrets are encrypted and never returned', async () => {
    const response = await PATCH(new NextRequest('http://localhost', { method: 'PATCH', body: JSON.stringify({ provider: 'graph', tenantId: '', clientId: '', sender: '', secret: 'replacement' }) }));
    expect(response.status).toBe(200);
    expect(mockUpsert.mock.calls.find(([arg]) => arg.where.key === 'mail_graph_secret')[0].create.value).toBe('encrypted:replacement');
    expect(await response.json()).toEqual({ success: true });
});
