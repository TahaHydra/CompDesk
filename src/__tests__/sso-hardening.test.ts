// Regression tests for the SSO review findings: HTTPS-only IdP traffic, one authoritative lockout
// policy, safe provider switching, partial settings saves, explicit removal, and migration mode.
const store = new Map<string, string>();
const mockAuth = jest.fn();
const mockUpdateManagedEnvironment = jest.fn();
const mockReadManagedEnvironment = jest.fn();
const mockPrisma = {
    appSetting: {
        findMany: jest.fn(async ({ where }: { where?: { key?: { in?: string[]; startsWith?: string } } } = {}) => [...store]
            .filter(([key]) => !where?.key || (where.key.in ? where.key.in.includes(key) : where.key.startsWith ? key.startsWith(where.key.startsWith) : true))
            .map(([key, value]) => ({ key, value }))),
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) => store.has(where.key) ? { key: where.key, value: store.get(where.key)! } : null),
        upsert: jest.fn(async ({ where, update }: { where: { key: string }; update: { value: string } }) => { store.set(where.key, update.value); }),
        deleteMany: jest.fn(async ({ where }: { where: { key: string | { in: string[] } } }) => {
            for (const key of typeof where.key === 'string' ? [where.key] : where.key.in) store.delete(key);
        }),
    },
    user: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
    account: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), deleteMany: jest.fn(async () => ({ count: 0 })), update: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/branding', () => ({ getBrandingConfig: jest.fn(async () => ({ microsoftButtonText: 'Sign in with Microsoft' })), saveBrandingConfig: jest.fn() }));
jest.mock('@/lib/managed-env', () => ({
    ...jest.requireActual('@/lib/managed-env'),
    canEditManagedEnvironment: () => true,
    readManagedEnvironment: (...args: unknown[]) => mockReadManagedEnvironment(...args),
    updateManagedEnvironment: (...args: unknown[]) => mockUpdateManagedEnvironment(...args),
}));

import { execFileSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { createOidcFetch, OidcTransportError } from '@/lib/oidc-fetch';
import { readOidcConfig } from '@/lib/oidc-provider';
import { assertProposedAuthentication, getEffectiveLoginPolicy, resolveSsoSignInRole, resetLoginPolicyCacheForTests, storedAccountProvider } from '@/lib/login-policy';
import { activeProviderId, targetProviderId } from '@/lib/sso-presets';
import { changedValues, syncDraft } from '@/lib/settings-draft';
import { cutoverMigration, finishMigration, getMigrationProgress, startMigration } from '@/lib/sso-migration';
import { PATCH } from '@/app/api/settings/route';
import { createTrustedFetch, testOidcDiscovery } from '../../scripts/oidc-discovery.mjs';
import { AuthenticationPolicyError, evaluateAuthenticationPolicy } from '../../scripts/auth-policy.mjs';

const ACTIVE_ISSUER = 'https://keycloak.example.com/realms/compdesk';
const NEXT_ISSUER = 'https://authentik.example.com/application/o/compdesk/';
// Runtime provider slots, read lazily by getRuntimeOidcConfig() on first use.
Object.assign(process.env, {
    OIDC_ISSUER: ACTIVE_ISSUER, OIDC_CLIENT_ID: 'compdesk', OIDC_CLIENT_SECRET: 'active-secret',
    OIDC_NEXT_ISSUER: NEXT_ISSUER, OIDC_NEXT_CLIENT_ID: 'compdesk', OIDC_NEXT_CLIENT_SECRET: 'next-secret',
});
// The managed configuration file as saved; by default identical to what the running process loaded.
const SAVED_MATCHES_RUNNING = { oidc_issuer: ACTIVE_ISSUER, oidc_client_id: 'compdesk', oidc_client_secret: 'active-secret', oidc_next_issuer: NEXT_ISSUER, oidc_next_client_id: 'compdesk', oidc_next_client_secret: 'next-secret' };
const metadata = (overrides: Record<string, unknown> = {}) => ({
    issuer: ACTIVE_ISSUER,
    authorization_endpoint: `${ACTIVE_ISSUER}/protocol/openid-connect/auth`,
    token_endpoint: `${ACTIVE_ISSUER}/protocol/openid-connect/token`,
    userinfo_endpoint: `${ACTIVE_ISSUER}/protocol/openid-connect/userinfo`,
    jwks_uri: `${ACTIVE_ISSUER}/protocol/openid-connect/certs`,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'private_key_jwt'],
    ...overrides,
});
const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const patch = (body: unknown) => PATCH(new Request('http://localhost/api/settings', { method: 'PATCH', body: JSON.stringify(body) }));

beforeEach(() => {
    jest.clearAllMocks();
    store.clear();
    resetLoginPolicyCacheForTests();
    mockAuth.mockResolvedValue({ user: { id: 'admin-1', role: 'SUPER_ADMIN' } });
    mockReadManagedEnvironment.mockResolvedValue(SAVED_MATCHES_RUNNING);
    mockUpdateManagedEnvironment.mockResolvedValue(true);
    mockPrisma.user.count.mockResolvedValue(0);
});

describe('Fix 1: identity-provider traffic is HTTPS-only', () => {
    const tokenRequest = () => ({ method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: 'abc' }) });

    it('refuses a non-loopback HTTP token endpoint before any credential is attached or sent', async () => {
        const transport = jest.fn();
        const authenticate = jest.fn();
        const guarded = createOidcFetch({ fetchImpl: transport, authenticateTokenRequest: authenticate, env: { NODE_ENV: 'development' } as NodeJS.ProcessEnv });
        const request = tokenRequest();
        await expect(guarded('http://idp.example.com/token', request)).rejects.toThrow(OidcTransportError);
        await expect(guarded('http://192.168.1.10/token', tokenRequest())).rejects.toThrow('insecure HTTP');
        expect(authenticate).not.toHaveBeenCalled();
        expect(transport).not.toHaveBeenCalled();
        expect(request.body.has('client_assertion')).toBe(false);
    });

    it('allows loopback HTTP only outside production', async () => {
        const transport = jest.fn().mockResolvedValue(jsonResponse({}));
        await expect(createOidcFetch({ fetchImpl: transport, env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv })('http://localhost:8080/realms/dev/token', tokenRequest())).rejects.toThrow(OidcTransportError);
        await createOidcFetch({ fetchImpl: transport, env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv })('http://127.0.0.1:8080/realms/dev/token', tokenRequest());
        expect(transport).toHaveBeenCalledTimes(1);
        expect(() => readOidcConfig({ NODE_ENV: 'production', OIDC_ISSUER: 'http://localhost:8080/realms/dev', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's' } as unknown as NodeJS.ProcessEnv)).toThrow('HTTPS');
    });

    it.each([
        ['token_endpoint', 'http://evil.example.com/token'],
        ['userinfo_endpoint', 'http://evil.example.com/userinfo'],
        ['authorization_endpoint', 'http://evil.example.com/auth'],
        ['issuer', 'http://keycloak.example.com/realms/compdesk'],
    ])('rejects discovery metadata that downgrades %s to HTTP', async (field, value) => {
        const guarded = createOidcFetch({ fetchImpl: jest.fn().mockResolvedValue(jsonResponse(metadata({ [field]: value }))), env: { NODE_ENV: 'production' } as NodeJS.ProcessEnv });
        await expect(guarded(`${ACTIVE_ISSUER}/.well-known/openid-configuration`, { method: 'GET' })).rejects.toThrow(`insecure or missing ${field}`);
        const tested = await testOidcDiscovery({ issuer: ACTIVE_ISSUER, fetchImpl: jest.fn().mockResolvedValue(jsonResponse(metadata({ [field]: value }))), env: { NODE_ENV: 'production' } });
        expect(tested).toMatchObject({ success: false, stage: 'metadata' });
    });

    it('rejects broken discovery documents and reports issuer or method mismatches', async () => {
        const broken = createOidcFetch({ fetchImpl: jest.fn().mockResolvedValue(jsonResponse(['not', 'an', 'object'])) });
        await expect(broken(`${ACTIVE_ISSUER}/.well-known/openid-configuration`)).rejects.toThrow('not a JSON object');
        const run = (body: unknown, authMethod = 'client_secret_basic') => testOidcDiscovery({ issuer: ACTIVE_ISSUER, authMethod, fetchImpl: jest.fn().mockResolvedValue(jsonResponse(body)) });
        await expect(run(metadata({ issuer: `${ACTIVE_ISSUER}/` }))).resolves.toMatchObject({ success: false, message: expect.stringContaining('must match the configured issuer') });
        await expect(run(metadata({ token_endpoint_auth_methods_supported: ['client_secret_post'] }))).resolves.toMatchObject({ success: false, message: expect.stringContaining('client_secret_basic') });
        await expect(run(metadata())).resolves.toMatchObject({ success: true, stage: 'success' });
        await expect(testOidcDiscovery({ issuer: 'http://sso.example.com', env: { NODE_ENV: 'development' } })).resolves.toMatchObject({ success: false, stage: 'configuration' });
    });

    describe('with a CompDesk-managed private CA', () => {
        let directory: string;
        let server: https.Server;
        let origin: string;
        let caPem: string;
        beforeAll(async () => {
            directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-ca-'));
            const file = (name: string) => path.join(directory, name);
            const openssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'ignore' });
            openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=CompDesk Test Root CA', '-keyout', file('ca.key'), '-out', file('ca.pem'));
            openssl('req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost', '-keyout', file('server.key'), '-out', file('server.csr'));
            fs.writeFileSync(file('san.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
            openssl('x509', '-req', '-in', file('server.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key'), '-CAcreateserial', '-days', '2', '-extfile', file('san.ext'), '-out', file('server.pem'));
            caPem = fs.readFileSync(file('ca.pem'), 'utf8');
            server = https.createServer({ key: fs.readFileSync(file('server.key')), cert: fs.readFileSync(file('server.pem')) }, (request, response) => {
                const issuer = `https://localhost:${(server.address() as AddressInfo).port}/realm`;
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({ ...metadata(), issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, userinfo_endpoint: `${issuer}/userinfo`, jwks_uri: `${issuer}/certs`, path: request.url }));
            });
            await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
            origin = `https://localhost:${(server.address() as AddressInfo).port}`;
        });
        afterAll(async () => {
            await new Promise((resolve) => server.close(resolve));
            fs.rmSync(directory, { recursive: true, force: true });
        });

        it('trusts the configured CA for this provider only, without NODE_EXTRA_CA_CERTS', async () => {
            await expect(fetch(`${origin}/realm/.well-known/openid-configuration`)).rejects.toThrow();
            const trusted = createTrustedFetch([caPem]);
            const response = await trusted(`${origin}/realm/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toMatchObject({ issuer: `${origin}/realm` });
            await expect(testOidcDiscovery({ issuer: `${origin}/realm`, caCertificates: [caPem] })).resolves.toMatchObject({ success: true });
            await expect(testOidcDiscovery({ issuer: `${origin}/realm` })).resolves.toMatchObject({ success: false, message: expect.stringContaining('not trusted') });
        });

        it('sends POST bodies through the trusted transport', async () => {
            const response = await createOidcFetch({ caCertificates: [caPem] })(`${origin}/realm/token`, { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code' }) });
            await expect(response.json()).resolves.toMatchObject({ path: '/realm/token' });
        });
    });
});

describe('Fix 2: one authoritative lockout policy', () => {
    it('evaluates every combination the same way for all callers', () => {
        expect(evaluateAuthenticationPolicy({ localEnabled: true, ssoEnabled: false, ssoUsable: false, linkedSuperAdmins: 0 })).toMatchObject({ ok: true, localEnabled: true });
        expect(evaluateAuthenticationPolicy({ localEnabled: false, ssoEnabled: false, ssoUsable: true, linkedSuperAdmins: 1 })).toMatchObject({ ok: false, localEnabled: true, reason: 'sso_disabled' });
        expect(evaluateAuthenticationPolicy({ localEnabled: false, ssoEnabled: true, ssoUsable: false, linkedSuperAdmins: 1 })).toMatchObject({ ok: false, localEnabled: true, reason: 'sso_unavailable' });
        expect(evaluateAuthenticationPolicy({ localEnabled: false, ssoEnabled: true, ssoUsable: true, linkedSuperAdmins: 0 })).toMatchObject({ ok: false, localEnabled: true, reason: 'no_linked_super_admin' });
        expect(evaluateAuthenticationPolicy({ localEnabled: false, ssoEnabled: true, ssoUsable: true, linkedSuperAdmins: 1 })).toMatchObject({ ok: true, localEnabled: false });
    });

    it('keeps local login effective when the database disables it but the selected provider is not loaded', async () => {
        store.set('login_local_enabled', 'false'); store.set('login_sso_enabled', 'true'); store.set('sso_provider', 'microsoft-entra-id');
        await expect(getEffectiveLoginPolicy()).resolves.toMatchObject({ localEnabled: true, lockoutPrevented: true });
    });

    it('keeps local login effective when only the environment disables it during a database outage', async () => {
        const failing = mockPrisma.appSetting.findUnique.getMockImplementation()!;
        mockPrisma.appSetting.findUnique.mockRejectedValue(new Error('database unavailable'));
        const saved = { ...process.env };
        Object.assign(process.env, { LOGIN_LOCAL_ENABLED: 'false', LOGIN_SSO_ENABLED: 'true' });
        try { await expect(getEffectiveLoginPolicy()).resolves.toMatchObject({ localEnabled: true, lockoutPrevented: true }); }
        finally { process.env = saved; mockPrisma.appSetting.findUnique.mockImplementation(failing); }
    });

    it('allows SSO-only login once a Super Admin is linked to the active, loaded provider', async () => {
        store.set('login_local_enabled', 'false'); store.set('login_sso_enabled', 'true'); store.set('sso_provider', 'keycloak');
        await expect(getEffectiveLoginPolicy()).resolves.toMatchObject({ localEnabled: true, lockoutPrevented: true });
        mockPrisma.user.count.mockResolvedValue(1);
        await expect(getEffectiveLoginPolicy()).resolves.toMatchObject({ localEnabled: false, ssoAvailable: true, lockoutPrevented: false });
        const linkedFilter = (mockPrisma.user.count.mock.calls.at(-1) as unknown as [{ where: { accounts: { some: { providerAccountId: { startsWith: string } } } } }])[0];
        expect(linkedFilter.where.accounts.some.providerAccountId.startsWith).toBe(`${ACTIVE_ISSUER} `);
    });

    it('refuses to disable local login through the Settings API when it would lock administrators out', async () => {
        store.set('login_sso_enabled', 'true'); store.set('sso_provider', 'keycloak');
        const response = await patch({ login_local_enabled: 'false' });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('Super Admin') });
        expect(store.has('login_local_enabled')).toBe(false);
    });
});

describe('Fix 3: provider switching cannot lock administrators out', () => {
    it('allows a direct switch only with local login enabled and a password-capable Super Admin', async () => {
        mockPrisma.user.count.mockResolvedValue(1);
        await expect(assertProposedAuthentication({ ssoProvider: 'keycloak' })).resolves.toBeUndefined();
        mockPrisma.user.count.mockResolvedValue(0);
        await expect(assertProposedAuthentication({ ssoProvider: 'keycloak' })).rejects.toMatchObject({ reason: 'no_local_super_admin' });
    });

    it('refuses a direct switch while local login is disabled, pointing to migration mode', async () => {
        store.set('login_local_enabled', 'false'); store.set('login_sso_enabled', 'true'); store.set('sso_provider', 'keycloak');
        mockPrisma.user.count.mockResolvedValue(1);
        await expect(assertProposedAuthentication({ ssoProvider: 'microsoft-entra-id' })).rejects.toThrow(AuthenticationPolicyError);
        await expect(assertProposedAuthentication({ ssoProvider: 'okta' })).rejects.toMatchObject({ reason: 'local_disabled_switch', message: expect.stringContaining('migration') });
    });

    it('switches through the API without touching existing account bindings', async () => {
        mockPrisma.user.count.mockResolvedValue(1);
        const response = await patch({ sso_provider: 'keycloak' });
        expect(response.status).toBe(200);
        expect(store.get('sso_provider')).toBe('keycloak');
        expect(mockPrisma.account.deleteMany).not.toHaveBeenCalled();
        expect(mockPrisma.account.update).not.toHaveBeenCalled();
        expect(mockPrisma.account.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a direct switch while a migration is in progress', async () => {
        store.set('sso_provider', 'keycloak'); store.set('sso_migration_target', 'authentik'); store.set('sso_migration_phase', 'staging');
        const response = await patch({ sso_provider: 'okta' });
        expect(response.status).toBe(409);
    });
});

describe('Fix 4: saving one card never overwrites another card', () => {
    it('refreshes untouched fields from the server and keeps the user\'s unsaved edits', () => {
        const keys = ['oidc_issuer', 'oidc_client_id'];
        const dirty = new Set(['oidc_issuer']);
        const synced = syncDraft({ oidc_issuer: 'https://typed.example.com', oidc_client_id: 'old' }, dirty, { oidc_issuer: 'https://saved.example.com', oidc_client_id: 'new', smtp_host: 'mail' }, keys);
        expect(synced).toEqual({ oidc_issuer: 'https://typed.example.com', oidc_client_id: 'new' });
    });

    it('sends only the card\'s own dirty, changed fields', () => {
        const server = { smtp_host: 'mail', smtp_user: 'user', smtp_password: '' };
        expect(changedValues({ smtp_host: 'relay', smtp_user: 'user', smtp_password: '' }, new Set(['smtp_host', 'smtp_password']), server)).toEqual({ smtp_host: 'relay' });
        expect(changedValues({ smtp_user: '' }, new Set(['smtp_user']), server, new Set(['smtp_user']))).toEqual({ smtp_user: '' });
        expect(changedValues({ smtp_user: '' }, new Set(['smtp_user']), server)).toEqual({});
    });

    it('a login-button save writes only its own keys', async () => {
        const response = await patch({ login_sso_enabled: 'false', sso_button_text: 'Sign in with Okta' });
        expect(response.status).toBe(200);
        expect(mockUpdateManagedEnvironment).not.toHaveBeenCalled();
        expect(mockPrisma.appSetting.upsert.mock.calls.map(([call]) => (call as { where: { key: string } }).where.key)).toEqual(['login_sso_enabled']);
    });
});

describe('Fix 5: optional material is removed explicitly', () => {
    it('distinguishes omitted (keep), null (remove), and a value (replace)', async () => {
        const response = await patch({ oidc_client_key_id: null, oidc_client_certificate: null });
        expect(response.status).toBe(200);
        expect(mockUpdateManagedEnvironment).toHaveBeenCalledWith({ oidc_client_key_id: null, oidc_client_certificate: null });
        await patch({ oidc_client_key_id: 'key-2' });
        expect(mockUpdateManagedEnvironment).toHaveBeenLastCalledWith({ oidc_client_key_id: 'key-2' });
    });

    it('rejects ambiguous empty values and removal of required fields', async () => {
        await expect((await patch({ oidc_client_certificate: '' })).json()).resolves.toMatchObject({ error: expect.stringContaining('Send null') });
        expect((await patch({ oidc_issuer: null })).status).toBe(400);
        expect((await patch({ smtp_host: null })).status).toBe(400);
        expect((await patch({ smtp_ca_certificate: '' })).status).toBe(400);
        expect(mockUpdateManagedEnvironment).not.toHaveBeenCalled();
    });

    it('keeps the stored secret for an empty secret value', async () => {
        await patch({ oidc_client_secret: '', oidc_client_id: 'compdesk-2' });
        expect(mockUpdateManagedEnvironment).toHaveBeenCalledWith({ oidc_client_id: 'compdesk-2' });
    });

    it('removing either half of the SMTP client certificate pair removes both', async () => {
        store.set('smtp_client_certificate', 'CERT'); store.set('smtp_client_key', 'enc:v1:key'); store.set('smtp_ca_certificate', 'CA');
        expect((await patch({ smtp_client_key: null })).status).toBe(200);
        expect(store.has('smtp_client_certificate')).toBe(false);
        expect(store.has('smtp_client_key')).toBe(false);
        expect(store.get('smtp_ca_certificate')).toBe('CA');
        expect((await patch({ smtp_ca_certificate: null })).status).toBe(200);
        expect(store.has('smtp_ca_certificate')).toBe(false);
    });

    it('the managed environment writer deletes a variable for null and keeps it when omitted', async () => {
        const { updateManagedEnvironment, readManagedEnvironment } = jest.requireActual('@/lib/managed-env') as typeof import('@/lib/managed-env');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-env-'));
        try {
            fs.writeFileSync(path.join(directory, '.env'), 'OIDC_ISSUER="https://a.example.com"\nOIDC_CLIENT_KEY_ID="kid-1"\nOTHER=1\n');
            await updateManagedEnvironment({ oidc_client_key_id: null, oidc_client_certificate: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' }, directory);
            const contents = fs.readFileSync(path.join(directory, '.env'), 'utf8');
            expect(contents).not.toContain('OIDC_CLIENT_KEY_ID');
            expect(contents).toContain('OIDC_ISSUER="https://a.example.com"');
            expect(contents).toContain('OTHER=1');
            expect((await readManagedEnvironment(directory)).oidc_client_certificate).toContain('\nAAAA\n');
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});

describe('SSO migration mode', () => {
    it('maps providers to slots so a cut-over never rewrites bindings', () => {
        expect(activeProviderId({ provider: 'keycloak', oidcSlot: 'oidc', migrationTarget: null })).toBe('oidc');
        expect(targetProviderId({ provider: 'keycloak', oidcSlot: 'oidc', migrationTarget: 'authentik' })).toBe('oidc-next');
        expect(targetProviderId({ provider: 'authentik', oidcSlot: 'oidc-next', migrationTarget: 'keycloak' })).toBe('oidc');
        expect(targetProviderId({ provider: 'microsoft-entra-id', oidcSlot: 'oidc', migrationTarget: 'okta' })).toBe('oidc');
        expect(targetProviderId({ provider: 'okta', oidcSlot: 'oidc', migrationTarget: 'microsoft-entra-id' })).toBe('microsoft-entra-id');
        expect(targetProviderId({ provider: 'microsoft-entra-id', oidcSlot: 'oidc', migrationTarget: 'microsoft-entra-id' })).toBeNull();
        expect(storedAccountProvider('oidc-next')).toBe('oidc');
        expect(storedAccountProvider('microsoft-entra-id')).toBe('microsoft-entra-id');
    });

    it('accepts the target only for linking or verifying links, and only while migrating', async () => {
        store.set('sso_provider', 'keycloak'); store.set('login_sso_enabled', 'true');
        await expect(resolveSsoSignInRole('oidc-next')).resolves.toBeNull();
        await startMigration('authentik', 'admin-1');
        await expect(resolveSsoSignInRole('oidc-next')).resolves.toBe('migration');
        await expect(resolveSsoSignInRole('oidc')).resolves.toBe('active');
        await expect(startMigration('okta', 'admin-1')).rejects.toThrow('already in progress');
    });

    it('blocks cut-over until the acting administrator has linked the new provider', async () => {
        store.set('sso_provider', 'keycloak');
        await startMigration('authentik', 'admin-1');
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Admin', email: 'admin@example.com', passwordHash: 'x', accounts: [{ provider: 'oidc', providerAccountId: `${ACTIVE_ISSUER} sub-1` }] }] as never);
        await expect(cutoverMigration('admin-1')).rejects.toThrow('Link your own authentik account');
        expect(store.get('sso_provider')).toBe('keycloak');
    });

    it('cuts over by flipping settings, keeps the old provider for rollback, and never prunes by default', async () => {
        store.set('sso_provider', 'keycloak');
        await startMigration('authentik', 'admin-1');
        mockPrisma.user.count.mockResolvedValue(1);
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Admin', email: 'admin@example.com', passwordHash: 'x', accounts: [{ provider: 'oidc', providerAccountId: `${NEXT_ISSUER} sub-9` }] }] as never);
        expect((await getMigrationProgress('admin-1')).blockers).toEqual([]);
        await cutoverMigration('admin-1');
        expect(Object.fromEntries(store)).toMatchObject({ sso_provider: 'authentik', sso_oidc_slot: 'oidc-next', sso_migration_target: 'keycloak', sso_migration_phase: 'rollback' });
        await expect(resolveSsoSignInRole('oidc')).resolves.toBe('migration');
        const finished = await finishMigration('admin-1', { pruneOldBindings: false });
        expect(mockPrisma.account.deleteMany).not.toHaveBeenCalled();
        expect(finished.prunedBindings).toBe(0);
        expect(mockUpdateManagedEnvironment).toHaveBeenCalledWith(expect.objectContaining({ oidc_issuer: null, oidc_client_secret: null }));
        expect(store.has('sso_migration_target')).toBe(false);
    });

    it('prunes only the previous issuer\'s bindings when asked', async () => {
        store.set('sso_provider', 'authentik'); store.set('sso_oidc_slot', 'oidc-next'); store.set('sso_migration_target', 'keycloak'); store.set('sso_migration_phase', 'rollback');
        mockPrisma.account.deleteMany.mockResolvedValue({ count: 3 });
        await expect(finishMigration('admin-1', { pruneOldBindings: true })).resolves.toMatchObject({ prunedBindings: 3 });
        expect(mockPrisma.account.deleteMany).toHaveBeenCalledWith({ where: { provider: 'oidc', providerAccountId: { startsWith: `${ACTIVE_ISSUER} ` } } });
    });
});

describe('Changing the active issuer', () => {
    it('warns how many links will stop matching and applies the direct-switch rule', async () => {
        store.set('sso_provider', 'keycloak');
        mockPrisma.account.count.mockResolvedValue(2);
        mockPrisma.user.count.mockResolvedValue(1);
        const response = await patch({ oidc_issuer: 'https://keycloak.example.com/realms/renamed' });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({ warning: expect.stringContaining('2 account link(s)') });
        expect(mockPrisma.account.count).toHaveBeenCalledWith({ where: { provider: 'oidc', providerAccountId: { startsWith: `${ACTIVE_ISSUER} ` } } });
    });

    it('is refused without a password-capable Super Admin, and ignored for a staged slot', async () => {
        store.set('sso_provider', 'keycloak');
        mockPrisma.account.count.mockResolvedValue(2);
        mockPrisma.user.count.mockResolvedValue(0);
        expect((await patch({ oidc_issuer: 'https://keycloak.example.com/realms/renamed' })).status).toBe(409);
        expect(mockUpdateManagedEnvironment).not.toHaveBeenCalled();
        mockReadManagedEnvironment.mockResolvedValue({ oidc_issuer: ACTIVE_ISSUER, oidc_client_id: 'compdesk', oidc_client_secret: 'active-secret', oidc_next_issuer: NEXT_ISSUER, oidc_next_client_id: 'compdesk', oidc_next_client_secret: 'next-secret' });
        const staged = await patch({ oidc_next_issuer: 'https://authentik.example.com/application/o/other/' });
        expect(staged.status).toBe(200);
        await expect(staged.json()).resolves.not.toHaveProperty('warning');
    });
});

describe('Review round 2', () => {
    const ENTRA_TENANT = '11111111-1111-4111-8111-111111111111';
    const ENTRA_CLIENT = '22222222-2222-4222-8222-222222222222';
    const idToken = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
    const savedEnv = { ...process.env };
    afterEach(() => { for (const key of ['AZURE_AD_TENANT_ID', 'AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET']) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; } });
    const useEntra = () => Object.assign(process.env, { AZURE_AD_TENANT_ID: ENTRA_TENANT, AZURE_AD_CLIENT_ID: ENTRA_CLIENT, AZURE_AD_CLIENT_SECRET: 's' });

    it('counts only Entra bindings issued for the running tenant and application', async () => {
        useEntra();
        const { isCurrentEntraBinding, countLinkedSuperAdmins } = await import('@/lib/login-policy');
        expect(isCurrentEntraBinding({ id_token: idToken({ tid: ENTRA_TENANT, aud: ENTRA_CLIENT }) })).toBe(true);
        expect(isCurrentEntraBinding({ id_token: idToken({ tid: '33333333-3333-4333-8333-333333333333', aud: ENTRA_CLIENT }) })).toBe(false);
        expect(isCurrentEntraBinding({ id_token: idToken({ tid: ENTRA_TENANT, aud: 'another-app' }) })).toBe(false);
        expect(isCurrentEntraBinding({ id_token: null })).toBe(false);
        mockPrisma.account.findMany.mockResolvedValue([
            { userId: 'stale-admin', id_token: idToken({ tid: '33333333-3333-4333-8333-333333333333', aud: ENTRA_CLIENT }) },
            { userId: 'unknown-admin', id_token: null },
        ] as never);
        await expect(countLinkedSuperAdmins('microsoft-entra-id')).resolves.toBe(0);
        mockPrisma.account.findMany.mockResolvedValue([{ userId: 'admin-1', id_token: idToken({ tid: ENTRA_TENANT, aud: [ENTRA_CLIENT] }) }] as never);
        await expect(countLinkedSuperAdmins('microsoft-entra-id')).resolves.toBe(1);
    });

    it('keeps local login effective when only stale Entra bindings remain after a tenant change', async () => {
        useEntra();
        store.set('login_local_enabled', 'false'); store.set('login_sso_enabled', 'true'); store.set('sso_provider', 'microsoft-entra-id');
        mockPrisma.account.findMany.mockResolvedValue([{ userId: 'admin-1', id_token: idToken({ tid: '33333333-3333-4333-8333-333333333333', aud: ENTRA_CLIENT }) }] as never);
        await expect(getEffectiveLoginPolicy()).resolves.toMatchObject({ localEnabled: true, lockoutPrevented: true });
    });

    it('guards Entra tenant and application changes like a provider switch', async () => {
        useEntra();
        store.set('sso_provider', 'microsoft-entra-id');
        mockPrisma.account.findMany.mockResolvedValue([{ userId: 'admin-1', id_token: idToken({ tid: ENTRA_TENANT, aud: ENTRA_CLIENT }) }] as never);
        mockPrisma.user.count.mockResolvedValue(0);
        const refused = await patch({ azure_ad_tenant_id: '44444444-4444-4444-8444-444444444444' });
        expect(refused.status).toBe(409);
        expect(mockUpdateManagedEnvironment).not.toHaveBeenCalled();
        mockPrisma.user.count.mockResolvedValue(1);
        const allowed = await patch({ azure_ad_client_id: '55555555-5555-4555-8555-555555555555' });
        expect(allowed.status).toBe(200);
        await expect(allowed.json()).resolves.toMatchObject({ warning: expect.stringContaining('1 user(s)') });
        expect((await patch({ azure_ad_tenant_id: ENTRA_TENANT })).status).toBe(200);
    });

    it('blocks cut-over while the target\'s saved settings differ from the running configuration', async () => {
        store.set('sso_provider', 'keycloak');
        await startMigration('authentik', 'admin-1');
        mockPrisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Admin', email: 'admin@example.com', passwordHash: null, accounts: [{ provider: 'oidc', providerAccountId: `${NEXT_ISSUER} sub-9`, id_token: null }] }] as never);
        mockReadManagedEnvironment.mockResolvedValue({ ...SAVED_MATCHES_RUNNING, oidc_next_issuer: 'https://other.example.com/application/o/compdesk/' });
        await expect(cutoverMigration('admin-1')).rejects.toThrow('differ from the running configuration');
        expect(store.get('sso_provider')).toBe('keycloak');
        mockReadManagedEnvironment.mockResolvedValue(SAVED_MATCHES_RUNNING);
        await expect(cutoverMigration('admin-1')).resolves.toBeUndefined();
    });

    it('refuses to finish (and remove the previous credentials) while the active configuration awaits a restart', async () => {
        store.set('sso_provider', 'authentik'); store.set('sso_oidc_slot', 'oidc-next'); store.set('sso_migration_target', 'keycloak'); store.set('sso_migration_phase', 'rollback');
        mockReadManagedEnvironment.mockResolvedValue({ ...SAVED_MATCHES_RUNNING, oidc_next_issuer: 'https://other.example.com/application/o/compdesk/' });
        await expect(finishMigration('admin-1', { pruneOldBindings: false })).rejects.toThrow('Restart CompDesk');
        expect(mockUpdateManagedEnvironment).not.toHaveBeenCalled();
        expect(store.get('sso_migration_phase')).toBe('rollback');
    });
});
