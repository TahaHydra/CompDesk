const mockAuth = jest.fn();
const mockAuditLog = jest.fn();
const mockCreateTransport = jest.fn();
const mockTransport = { verify: jest.fn(), sendMail: jest.fn() };
const mockPrisma = {
    appSetting: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), upsert: jest.fn(), deleteMany: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
};

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/audit', () => ({ auditLog: mockAuditLog }));
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/branding', () => ({ getBrandingConfig: jest.fn().mockResolvedValue({ applicationName: 'CompDesk' }) }));
jest.mock('@/lib/managed-env', () => ({ readManagedEnvironment: jest.fn().mockResolvedValue({}), updateManagedEnvironment: jest.fn(), ManagedEnvironmentError: class ManagedEnvironmentError extends Error {} }));
jest.mock('@/lib/uploaded-image', () => ({ removeUploadedImage: jest.fn() }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: (...args: unknown[]) => mockCreateTransport(...args) } }));

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { diagnoseEntraRuntime } from '@/lib/entra-diagnostic';

import { createSmtpTransport, getSmtpConfig } from '@/lib/email';
import { decryptSettingSecret, encryptSettingSecret } from '@/lib/settings-secret';
import { isLoginMethodEnabled, resetLoginPolicyCacheForTests } from '@/lib/login-policy';
import { parseTicketContent } from '@/lib/ticket-content';
import { POST as verifySmtp } from '@/app/api/settings/verify-smtp/route';
import { POST as sendSmtpTest } from '@/app/api/settings/test-email/route';
import { GET as getSettings } from '@/app/api/settings/route';

const validEnv = {
    NODE_ENV: 'test',
    AZURE_AD_CLIENT_ID: '550e8400-e29b-41d4-a716-446655440000',
    AZURE_AD_CLIENT_SECRET: 'do-not-return-this-secret',
    AZURE_AD_TENANT_ID: '550e8400-e29b-41d4-a716-446655440001',
    AUTH_URL: 'https://support.example.com',
    AUTH_SECRET: 'another-secret-that-must-not-return',
} as NodeJS.ProcessEnv;
const metadata = {
    issuer: 'https://login.microsoftonline.com/tenant/v2.0',
    authorization_endpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
    token_endpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
    jwks_uri: 'https://login.microsoftonline.com/tenant/discovery/v2.0/keys',
};
function source(relative: string) { return fs.readFileSync(path.join(process.cwd(), ...relative.split('/')), 'utf8'); }
function nestedError(code: string) { return new Error('fetch failed', { cause: { code, message: code } }); }

describe('Phase 3 Entra diagnostics', () => {
    it('fetches exact tenant metadata, validates HTTPS endpoints, and constructs the exact callback', async () => {
        const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify(metadata), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        const result = await diagnoseEntraRuntime({ env: validEnv, fetchImpl, correlationId: 'correlation-1' });
        expect(result.success).toBe(true);
        expect(fetchImpl).toHaveBeenCalledWith('https://login.microsoftonline.com/550e8400-e29b-41d4-a716-446655440001/v2.0/.well-known/openid-configuration', expect.objectContaining({ redirect: 'error' }));
        expect(result.expectedCallbackUri).toBe('https://support.example.com/api/auth/callback/microsoft-entra-id');
        expect(result.metadata).toEqual({ issuer: true, authorizationEndpoint: true, tokenEndpoint: true, jwksUri: true });
    });

    it.each([
        ['ENOTFOUND', 'dns_resolution'],
        ['ECONNREFUSED', 'tcp_connectivity'],
        ['CERT_HAS_EXPIRED', 'tls_certificate'],
        ['ETIMEDOUT', 'timeout'],
    ])('categorizes nested %s failures as %s', async (code, stage) => {
        const result = await diagnoseEntraRuntime({ env: validEnv, fetchImpl: jest.fn().mockRejectedValue(nestedError(code)), correlationId: code });
        expect(result).toMatchObject({ success: false, stage });
        expect(result.message).not.toContain('do-not-return');
    });

    it('categorizes a bounded abort as timeout', async () => {
        const fetchImpl = jest.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })) as unknown as typeof fetch;
        const result = await diagnoseEntraRuntime({ env: validEnv, fetchImpl, timeoutMs: 5 });
        expect(result.stage).toBe('timeout');
    });

    it('reports malformed metadata and redacts all configured secrets and identifiers', async () => {
        const result = await diagnoseEntraRuntime({ env: validEnv, fetchImpl: jest.fn().mockResolvedValue(new Response('not-json', { status: 200 })) });
        expect(result.stage).toBe('malformed_metadata');
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(validEnv.AZURE_AD_CLIENT_SECRET!);
        expect(serialized).not.toContain(validEnv.AUTH_SECRET!);
        expect(serialized).not.toContain(validEnv.AZURE_AD_CLIENT_ID!);
        expect(serialized).not.toContain(validEnv.AZURE_AD_TENANT_ID!);
    });
});

describe('Phase 3 login policy recovery', () => {
    beforeEach(() => { jest.clearAllMocks(); resetLoginPolicyCacheForTests(); });
    it('retains a validated disabled value when a later DB read fails', async () => {
        mockPrisma.appSetting.findUnique.mockResolvedValueOnce({ value: 'false' }).mockRejectedValueOnce(new Error('db unavailable'));
        await expect(isLoginMethodEnabled('login_local_enabled', { NODE_ENV: 'test' })).resolves.toBe(false);
        await expect(isLoginMethodEnabled('login_local_enabled', { NODE_ENV: 'test' })).resolves.toBe(false);
        expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.policy_read_failed' }));
    });
    it('uses explicit environment recovery and otherwise keeps Microsoft disabled', async () => {
        mockPrisma.appSetting.findUnique.mockRejectedValue(new Error('db unavailable'));
        await expect(isLoginMethodEnabled('login_local_enabled', { NODE_ENV: 'test', LOGIN_LOCAL_ENABLED: 'false' })).resolves.toBe(false);
        resetLoginPolicyCacheForTests();
        await expect(isLoginMethodEnabled('login_microsoft_enabled', { NODE_ENV: 'test' })).resolves.toBe(false);
    });
});

describe('Phase 3 SMTP diagnostics and secret protection', () => {
    const savedEnvironment = { ...process.env };
    beforeEach(() => {
        jest.clearAllMocks();
        mockCreateTransport.mockReturnValue(mockTransport);
        mockAuth.mockResolvedValue({ user: { id: 'super-1', email: 'admin@example.com', role: 'SUPER_ADMIN' } });
        mockPrisma.appSetting.findMany.mockResolvedValue([
            { key: 'smtp_host', value: 'smtp.example.com' }, { key: 'smtp_port', value: '587' },
            { key: 'smtp_secure', value: 'false' }, { key: 'smtp_require_tls', value: 'true' },
            { key: 'smtp_user', value: 'admin@example.com' }, { key: 'smtp_from', value: 'CompDesk <admin@example.com>' },
        ]);
        process.env.SMTP_PASS = 'environment-password';
    });
    afterAll(() => { process.env = savedEnvironment; });

    it('ignores the documented environment placeholder so the saved password is effective', async () => {
        process.env.SMTP_PASS = 'your-smtp-password';
        mockPrisma.appSetting.findMany.mockResolvedValue([
            { key: 'smtp_host', value: 'smtp.example.com' }, { key: 'smtp_port', value: '465' },
            { key: 'smtp_secure', value: 'true' }, { key: 'smtp_require_tls', value: 'false' },
            { key: 'smtp_user', value: 'admin@example.com' }, { key: 'smtp_from', value: 'admin@example.com' },
            { key: 'smtp_password', value: 'saved-real-password' },
        ]);
        const smtp = await getSmtpConfig({} as any);
        expect(smtp.pass).toBe('saved-real-password');
    });

    it('passes requireTLS and certificate verification to Nodemailer', () => {
        createSmtpTransport({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, user: 'u', pass: 'p', from: 'u@example.com' });
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, tls: { rejectUnauthorized: true } }));
    });

    it('reports verify success while clearly not claiming From acceptance', async () => {
        mockTransport.verify.mockResolvedValue(true);
        const response = await verifySmtp(); const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload).toMatchObject({ success: true, fromAccepted: null, requireTLS: true });
        expect(payload.message).toContain('only tested by sending a real message');
    });

    it('reports the SMTP relay result without claiming final delivery or sender acceptance', async () => {
        mockTransport.sendMail.mockResolvedValue({
            accepted: ['admin@example.com'],
            rejected: [],
            response: '250 2.0.0 queued as ABC123',
            messageId: '<message-1@example.com>',
        });
        const response = await sendSmtpTest();
        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
            success: true,
            relayAccepted: true,
            acceptedRecipients: ['admin@example.com'],
            rejectedRecipients: [],
            responseStatus: '250',
            messageId: '<message-1@example.com>',
        });
        expect(payload).not.toHaveProperty('fromAccepted');
        expect(payload.message).toContain('accepted the message for relay');
        expect(payload.message).toContain('does not prove final delivery');
    });

    it('fails a resolved send when the SMTP server rejects the recipient', async () => {
        mockTransport.sendMail.mockResolvedValue({
            accepted: [],
            rejected: ['admin@example.com'],
            response: '550 5.1.1 mailbox unavailable',
            messageId: '<message-2@example.com>',
        });
        const response = await sendSmtpTest();
        const payload = await response.json();
        expect(response.status).toBe(502);
        expect(payload).toMatchObject({
            success: false,
            relayAccepted: false,
            acceptedRecipients: [],
            rejectedRecipients: ['admin@example.com'],
            responseStatus: '550',
        });
    });
    it.each([
        ['ENOTFOUND', 'dns'], ['ECONNREFUSED', 'tcp_connectivity'], ['ETIMEDOUT', 'timeout'], ['CERT_HAS_EXPIRED', 'tls_certificate'], ['EAUTH', 'authentication'],
    ])('returns categorized verify failure for %s', async (code, category) => {
        mockTransport.verify.mockRejectedValue(nestedError(code));
        const response = await verifySmtp(); const payload = await response.json();
        expect(response.status).toBe(502);
        expect(payload.category).toBe(category);
        expect(JSON.stringify(payload)).not.toContain('environment-password');
    });

    it('encrypts with random AES-GCM nonces, decrypts, and rejects tampering', () => {
        const env = { NODE_ENV: 'test', APP_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') } as NodeJS.ProcessEnv;
        const first = encryptSettingSecret('smtp-password', env); const second = encryptSettingSecret('smtp-password', env);
        expect(first).toMatch(/^enc:v1:/); expect(second).not.toBe(first);
        expect(decryptSettingSecret(first, env)).toBe('smtp-password');
        const tampered = `${first.slice(0, -2)}AA`;
        expect(() => decryptSettingSecret(tampered, env)).toThrow(/authenticated/);
    });

    it('decrypts with the previous key during rotation and fails closed without a key', () => {
        const currentKey = Buffer.alloc(32, 9).toString('base64');
        const previousKey = Buffer.alloc(32, 10).toString('base64');
        const envelope = encryptSettingSecret('rotating-password', { NODE_ENV: 'test', APP_SETTINGS_ENCRYPTION_KEY: previousKey } as NodeJS.ProcessEnv);
        expect(decryptSettingSecret(envelope, {
            NODE_ENV: 'test',
            APP_SETTINGS_ENCRYPTION_KEY: currentKey,
            APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS: previousKey,
        } as NodeJS.ProcessEnv)).toBe('rotating-password');
        expect(() => decryptSettingSecret(envelope, { NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toThrow('No application settings encryption key');
    });
    it('never returns the encrypted or decrypted SMTP password through settings GET', async () => {
        const keyEnv = { NODE_ENV: 'test', APP_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64') } as NodeJS.ProcessEnv;
        const envelope = encryptSettingSecret('database-password', keyEnv);
        mockPrisma.appSetting.findMany.mockResolvedValue([{ key: 'smtp_password', value: envelope }]);
        const response = await getSettings(); const payload = await response.json(); const serialized = JSON.stringify(payload);
        expect(payload.smtp_password).toBe('');
        expect(serialized).not.toContain(envelope);
        expect(serialized).not.toContain('database-password');
    });
});

describe('Phase 3 ticket-content and presence safety', () => {
    it('renders only authenticated same-origin attachments inline', () => {
        const internal = parseTicketContent('![safe](/api/upload/550e8400-e29b-41d4-a716-446655440000)');
        const external = parseTicketContent('![tracker](https://tracker.example/pixel.gif)');
        const unsafe = parseTicketContent('![bad](javascript:alert(1))');
        expect(internal[0].kind).toBe('inline-image');
        expect(external[0].kind).toBe('external-image-link');
        expect(unsafe[0].kind).toBe('blocked-image');
    });
    it('uses corrected non-exclusive presence wording and not authorization', () => {
        const api = source('src/app/api/tickets/[id]/route.ts');
        const page = source('src/app/(dashboard)/tickets/[id]/page.tsx');
        expect(api).toContain('exclusive: false');
        expect(api).toContain('Never used for authorization');
        expect(page).toContain('non-exclusive presence');
        expect(page).not.toContain('Being viewed by');
    });
});
describe('Phase 3 settings-key startup wiring', () => {
    it('loads .env in the standalone server process and passes keys into Docker', () => {
        const packageJson = JSON.parse(source('package.json'));
        expect(packageJson.scripts.start).toContain('scripts/launch.mjs');
        expect(source('scripts/launch.mjs')).toContain("import('./setup-bootstrap.mjs')");
        expect(source('scripts/launch.mjs')).toContain('start-standalone.mjs');
        expect(source('scripts/start-standalone.mjs')).toContain('loadEnvConfig(root)');
        const compose = source('docker-compose.yml');
        expect(compose).toContain('APP_SETTINGS_ENCRYPTION_KEY: ${APP_SETTINGS_ENCRYPTION_KEY:?APP_SETTINGS_ENCRYPTION_KEY is required}');
        expect(compose).toContain('APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS: ${APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS:-}');
    });

    it('generates a settings key once without printing or overwriting it', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-settings-key-'));
        const envPath = path.join(directory, '.env');
        const scriptPath = path.join(process.cwd(), 'scripts', 'generate-settings-key.mjs');
        try {
            const firstOutput = execFileSync(process.execPath, [scriptPath, envPath], { encoding: 'utf8' });
            const firstContent = fs.readFileSync(envPath, 'utf8');
            const key = firstContent.match(/^APP_SETTINGS_ENCRYPTION_KEY="([^"]+)"$/m)?.[1];
            expect(key).toBeDefined();
            expect(Buffer.from(key!, 'base64')).toHaveLength(32);
            expect(firstOutput).not.toContain(key!);

            const secondOutput = execFileSync(process.execPath, [scriptPath, envPath], { encoding: 'utf8' });
            expect(fs.readFileSync(envPath, 'utf8')).toBe(firstContent);
            expect(secondOutput).toContain('no changes made');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
});
