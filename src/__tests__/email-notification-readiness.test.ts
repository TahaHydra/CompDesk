// Regression tests: email notifications follow the active delivery provider's real requirements.
// Microsoft 365 / Graph must not need an SMTP From address; SMTP keeps its From/authentication rules.
const store = new Map<string, string>();
const mockAuth = jest.fn();
const mockPrisma = {
    appSetting: {
        findMany: jest.fn(async ({ where }: { where?: { key?: { in?: string[]; startsWith?: string } } } = {}) => [...store]
            .filter(([key]) => !where?.key || (where.key.in ? where.key.in.includes(key) : where.key.startsWith ? key.startsWith(where.key.startsWith) : true))
            .map(([key, value]) => ({ key, value }))),
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) => store.has(where.key) ? { key: where.key, value: store.get(where.key)! } : null),
        upsert: jest.fn(async ({ where, update }: { where: { key: string }; update: { value: string } }) => { store.set(where.key, update.value); }),
        deleteMany: jest.fn(async ({ where }: { where: { key: { in: string[] } } }) => { for (const key of where.key.in) store.delete(key); }),
    },
    user: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    account: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/branding', () => ({ getBrandingConfig: jest.fn(async () => ({ applicationName: 'CompDesk', microsoftButtonText: 'Sign in with Microsoft' })), saveBrandingConfig: jest.fn() }));
jest.mock('@/lib/managed-env', () => ({ ...jest.requireActual('@/lib/managed-env'), canEditManagedEnvironment: () => true, readManagedEnvironment: jest.fn().mockResolvedValue({}), updateManagedEnvironment: jest.fn() }));
jest.mock('@/lib/uploaded-image', () => ({ removeUploadedImage: jest.fn() }));

import { readFileSync } from 'fs';
import path from 'path';
import { getEmailDeliveryStatus } from '@/lib/email';
import { encryptSettingSecret } from '@/lib/settings-secret';
import { GET, PATCH } from '@/app/api/settings/route';

const MAIL_ENV = [
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PASSWORD', 'SMTP_FROM', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS',
    'SMTP_CA_FILE', 'SMTP_CLIENT_CERT_FILE', 'SMTP_CLIENT_KEY_FILE', 'COMPDESK_MAIL_PROVIDER',
    'COMPDESK_GRAPH_TENANT_ID', 'COMPDESK_GRAPH_CLIENT_ID', 'COMPDESK_GRAPH_SENDER', 'COMPDESK_GRAPH_CLIENT_SECRET',
];
const originalEnv = { ...process.env };
const TENANT = '550e8400-e29b-41d4-a716-446655440001';
const CLIENT = '550e8400-e29b-41d4-a716-446655440000';
const TOGGLE = 'email_on_ticket_created';

function graph(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
        mail_provider: 'graph', mail_graph_tenant_id: TENANT, mail_graph_client_id: CLIENT,
        mail_graph_sender: 'helpdesk@example.com', mail_graph_secret: encryptSettingSecret('graph-app-secret'), ...overrides,
    };
    for (const [key, value] of Object.entries(values)) if (value !== undefined) store.set(key, value);
}
function smtp(overrides: Record<string, string | undefined> = {}) {
    const values: Record<string, string | undefined> = {
        smtp_host: 'smtp.example.com', smtp_user: 'helpdesk@example.com', smtp_password: encryptSettingSecret('smtp-password'),
        smtp_from: 'CompDesk <helpdesk@example.com>', ...overrides,
    };
    for (const [key, value] of Object.entries(values)) if (value !== undefined) store.set(key, value);
}
const patch = (body: unknown) => PATCH(new Request('http://localhost/api/settings', { method: 'PATCH', body: JSON.stringify(body) }));

beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    for (const name of MAIL_ENV) delete process.env[name];
    process.env.APP_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    mockAuth.mockResolvedValue({ user: { id: 'super-admin', role: 'SUPER_ADMIN' } });
});
afterAll(() => { process.env = originalEnv; });

describe('Microsoft 365 / Graph delivery readiness', () => {
    it('is ready with a complete Graph configuration and no SMTP From address', async () => {
        graph();
        await expect(getEmailDeliveryStatus()).resolves.toEqual({ provider: 'graph', ready: true });
    });

    it('uses Graph environment overrides', async () => {
        Object.assign(process.env, { COMPDESK_MAIL_PROVIDER: 'graph', COMPDESK_GRAPH_TENANT_ID: TENANT, COMPDESK_GRAPH_CLIENT_ID: CLIENT, COMPDESK_GRAPH_SENDER: 'env-sender@example.com', COMPDESK_GRAPH_CLIENT_SECRET: 'env-secret' });
        await expect(getEmailDeliveryStatus()).resolves.toEqual({ provider: 'graph', ready: true });
    });

    it.each([
        ['missing', undefined],
        ['invalid', 'not-a-mailbox'],
    ])('reports a %s sender mailbox', async (_label, sender) => {
        graph({ mail_graph_sender: sender ?? '' });
        const status = await getEmailDeliveryStatus();
        expect(status).toMatchObject({ provider: 'graph', ready: false });
        expect(status.issue).toContain('sender mailbox');
    });

    it.each(['mail_graph_tenant_id', 'mail_graph_client_id', 'mail_graph_secret'])('reports an incomplete configuration when %s is missing', async (key) => {
        graph({ [key]: '' });
        const status = await getEmailDeliveryStatus();
        expect(status.ready).toBe(false);
        expect(status.issue).toContain('Complete the Microsoft 365 mail settings');
    });

    it('reports an unreadable stored client secret without exposing it', async () => {
        graph({ mail_graph_secret: 'enc:v1:not-a-valid-envelope' });
        const status = await getEmailDeliveryStatus();
        expect(status.ready).toBe(false);
        expect(status.issue).toContain('APP_SETTINGS_ENCRYPTION_KEY');
        expect(status.issue).not.toContain('not-a-valid-envelope');
    });

    it('ignores SMTP settings entirely', async () => {
        graph();
        smtp({ smtp_from: 'not an address', smtp_user: '', smtp_password: '' });
        await expect(getEmailDeliveryStatus()).resolves.toMatchObject({ ready: true });
    });
});

describe('SMTP delivery readiness', () => {
    it('is ready with a valid From address and username/password', async () => {
        smtp();
        await expect(getEmailDeliveryStatus()).resolves.toEqual({ provider: 'smtp', ready: true });
    });

    it('is the default provider when none is saved', async () => {
        smtp();
        expect((await getEmailDeliveryStatus()).provider).toBe('smtp');
    });

    it('accepts environment configuration', async () => {
        Object.assign(process.env, { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'env@example.com', SMTP_PASS: 'env-password', SMTP_FROM: 'env@example.com' });
        await expect(getEmailDeliveryStatus()).resolves.toMatchObject({ ready: true });
    });

    it.each([
        ['missing', ''],
        ['invalid', 'helpdesk'],
    ])('reports a %s From address with the existing message', async (_label, from) => {
        smtp({ smtp_from: from });
        await expect(getEmailDeliveryStatus()).resolves.toEqual({ provider: 'smtp', ready: false, issue: 'Configure a valid SMTP From address before enabling email notifications.' });
    });

    it.each([
        ['no username or password', { smtp_user: '', smtp_password: '' }],
        ['a username without a password', { smtp_password: '' }],
    ])('reports missing authentication (%s)', async (_label, overrides) => {
        smtp(overrides);
        const status = await getEmailDeliveryStatus();
        expect(status.ready).toBe(false);
        expect(status.issue).toContain('SMTP authentication');
    });

    it('reports an unreadable stored password', async () => {
        smtp({ smtp_password: 'enc:v1:not-a-valid-envelope' });
        const status = await getEmailDeliveryStatus();
        expect(status.ready).toBe(false);
        expect(status.issue).toContain('APP_SETTINGS_ENCRYPTION_KEY');
    });

    it('checks a From address submitted with the same request', async () => {
        smtp({ smtp_from: '' });
        await expect(getEmailDeliveryStatus({ smtpFrom: 'helpdesk@example.com' })).resolves.toMatchObject({ ready: true });
    });
});

describe('PATCH /api/settings notification toggles', () => {
    it('enables a notification with Microsoft 365 / Graph and no SMTP From address', async () => {
        graph();
        const response = await patch({ [TOGGLE]: 'true' });
        expect(response.status).toBe(200);
        expect(store.get(TOGGLE)).toBe('true');
    });

    it('refuses with the Graph-specific reason when the sender mailbox is missing', async () => {
        graph({ mail_graph_sender: '' });
        const response = await patch({ [TOGGLE]: 'true' });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain('sender mailbox');
        expect(store.has(TOGGLE)).toBe(false);
    });

    it('keeps the SMTP From requirement and message', async () => {
        smtp({ smtp_from: '' });
        const response = await patch({ [TOGGLE]: 'true' });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe('Configure a valid SMTP From address before enabling email notifications.');
    });

    it('refuses SMTP without authentication', async () => {
        smtp({ smtp_user: '', smtp_password: '' });
        const response = await patch({ email_on_new_comment: 'true' });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain('SMTP authentication');
    });

    it('enables a notification with a configured SMTP server', async () => {
        smtp();
        expect((await patch({ email_on_ticket_assigned: 'true' })).status).toBe(200);
        expect(store.get('email_on_ticket_assigned')).toBe('true');
    });

    it('accepts an SMTP From address submitted together with the toggle', async () => {
        smtp({ smtp_from: '' });
        expect((await patch({ smtp_from: 'helpdesk@example.com', [TOGGLE]: 'true' })).status).toBe(200);
        expect(store.get(TOGGLE)).toBe('true');
    });

    it('always allows turning a notification off and keeps other saved preferences', async () => {
        store.set(TOGGLE, 'true');
        store.set('email_on_new_comment', 'true');
        expect((await patch({ [TOGGLE]: 'false' })).status).toBe(200);
        expect(store.get(TOGGLE)).toBe('false');
        expect(store.get('email_on_new_comment')).toBe('true');
    });

    it('requires a Super Admin', async () => {
        graph();
        mockAuth.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' } });
        expect((await patch({ [TOGGLE]: 'true' })).status).toBe(403);
        expect(store.has(TOGGLE)).toBe(false);
    });
});

describe('GET /api/settings delivery readiness', () => {
    it('reports Graph as ready without an SMTP From address', async () => {
        graph();
        const body = await (await GET()).json();
        expect(body).toMatchObject({ email_delivery_ready: 'true', email_delivery_issue: '', smtp_from: '' });
    });

    it('reports the active provider issue', async () => {
        graph({ mail_graph_sender: '' });
        const body = await (await GET()).json();
        expect(body.email_delivery_ready).toBe('false');
        expect(body.email_delivery_issue).toContain('sender mailbox');
    });

    it('never returns provider secrets', async () => {
        graph();
        const text = await (await GET()).text();
        expect(text).not.toContain('graph-app-secret');
    });
});

describe('settings UI wiring', () => {
    const read = (...segments: string[]) => readFileSync(path.join(process.cwd(), ...segments), 'utf8');

    it('gates the toggles on server readiness instead of the SMTP From address', () => {
        const page = read('src', 'app', '(dashboard)', 'admin', 'settings', 'page.tsx');
        expect(page).toContain("settings?.email_delivery_ready === 'true'");
        expect(page).toContain('(!enabled && !deliveryReady)');
        expect(page).not.toContain('!settings?.smtp_from');
    });

    it('refreshes readiness after Microsoft 365 settings are saved', () => {
        expect(read('src', 'components', 'admin', 'graph-mail-settings.tsx')).toContain("invalidateQueries({ queryKey: ['settings'] })");
    });
});
