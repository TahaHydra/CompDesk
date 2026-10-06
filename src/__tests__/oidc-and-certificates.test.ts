const mockPrisma = { appSetting: { findMany: jest.fn(), findUnique: jest.fn() }, user: { count: jest.fn() } };
const mockCreateTransport = jest.fn();
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: (...args: unknown[]) => mockCreateTransport(...args) } }));

import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createClientAssertion, createOidcProvider, createProviderFetch, oidcAccountId, readOidcConfig, type OidcRuntimeConfig } from '@/lib/oidc-provider';
import { parseCertificates, parsePrivateKey, TlsMaterialError } from '@/lib/tls-material';
import { createSmtpTransport, getSmtpConfig, hasSmtpAuthentication } from '@/lib/email';
import { encryptSettingSecret } from '@/lib/settings-secret';
import { getSelectedSsoProvider, environmentPolicy } from '@/lib/login-policy';

const ISSUER = 'https://sso.example.com/realms/compdesk';

function decodePart(part: string) { return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); }
function pem(key: crypto.KeyObject) { return key.export({ type: 'pkcs8', format: 'pem' }).toString(); }

// A real self-signed certificate is needed for thumbprint and key-match checks; Node cannot create
// one, so the suite uses the openssl binary that ships with CI runners and Git for Windows.
let certificateDir: string;
let certificatePem = '';
let certificateKeyPem = '';
beforeAll(() => {
    certificateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compdesk-oidc-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=compdesk-test',
        '-keyout', path.join(certificateDir, 'key.pem'), '-out', path.join(certificateDir, 'cert.pem')], { stdio: 'ignore' });
    certificatePem = fs.readFileSync(path.join(certificateDir, 'cert.pem'), 'utf8');
    certificateKeyPem = fs.readFileSync(path.join(certificateDir, 'key.pem'), 'utf8');
});
afterAll(() => fs.rmSync(certificateDir, { recursive: true, force: true }));

function privateKeyJwtEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return { OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'compdesk', OIDC_CLIENT_AUTH_METHOD: 'private_key_jwt', OIDC_CLIENT_PRIVATE_KEY: certificateKeyPem, ...extra } as unknown as NodeJS.ProcessEnv;
}

describe('OIDC configuration', () => {
    it('is disabled when issuer or client ID is missing', () => {
        expect(readOidcConfig({} as NodeJS.ProcessEnv)).toBeNull();
        expect(readOidcConfig({ OIDC_ISSUER: ISSUER } as unknown as NodeJS.ProcessEnv)).toBeNull();
    });

    it('defaults to client-secret authentication and requires the secret', () => {
        const env = { OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'compdesk' } as unknown as NodeJS.ProcessEnv;
        expect(() => readOidcConfig(env)).toThrow('OIDC_CLIENT_SECRET is required');
        expect(readOidcConfig({ ...env, OIDC_CLIENT_SECRET: 's3cret' })).toMatchObject({ authMethod: 'client_secret_basic', clientSecret: 's3cret' });
    });

    it('requires HTTPS issuers except on loopback development hosts', () => {
        const env = { OIDC_CLIENT_ID: 'compdesk', OIDC_CLIENT_SECRET: 's' };
        expect(() => readOidcConfig({ ...env, OIDC_ISSUER: 'http://sso.example.com' } as unknown as NodeJS.ProcessEnv)).toThrow('HTTPS');
        expect(readOidcConfig({ ...env, OIDC_ISSUER: 'http://localhost:8080/realms/dev' } as unknown as NodeJS.ProcessEnv)).not.toBeNull();
    });

    it('rejects unknown authentication methods', () => {
        expect(() => readOidcConfig({ OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'c', OIDC_CLIENT_AUTH_METHOD: 'tls_client_auth' } as unknown as NodeJS.ProcessEnv)).toThrow('OIDC_CLIENT_AUTH_METHOD');
    });

    it('rejects weak, unsupported, encrypted, and mismatched client keys', () => {
        // Intentional weak-key fixture: verifies CompDesk rejects RSA keys below 2048 bits.
        // codeql[js/insufficient-key-size]
        const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
        const edwards = crypto.generateKeyPairSync('ed25519').privateKey;
        const encrypted = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pass' }).toString();
        const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
        expect(() => readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: pem(weak) }))).toThrow('2048');
        expect(() => readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: pem(edwards) }))).toThrow('EC P-256');
        expect(() => readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: encrypted }))).toThrow(TlsMaterialError);
        expect(() => readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: pem(other), OIDC_CLIENT_CERTIFICATE: certificatePem }))).toThrow('does not match');
        expect(() => readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: '' }))).toThrow('OIDC_CLIENT_PRIVATE_KEY');
    });

    it('accepts single-line PEM values with escaped newlines and key files', () => {
        const singleLine = certificateKeyPem.replace(/\r?\n/g, '\\n');
        expect(readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: singleLine }))?.signingKey?.alg).toBe('RS256');
        const fromFile = readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: '', OIDC_CLIENT_PRIVATE_KEY_FILE: path.join(certificateDir, 'key.pem') }));
        expect(fromFile?.signingKey?.alg).toBe('RS256');
    });

    it('scopes account identities by issuer so another IdP can never match an existing account', () => {
        const config = readOidcConfig({ OIDC_ISSUER: ISSUER, OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's' } as unknown as NodeJS.ProcessEnv)!;
        const provider = createOidcProvider(config);
        const profile = provider.profile!({ iss: ISSUER, sub: 'user-1', email: ' User@Example.COM ', name: 'User' } as never, {} as never) as { id: string; email: string };
        expect(profile.id).toBe(oidcAccountId(ISSUER, 'user-1'));
        expect(profile.id).not.toBe(oidcAccountId('https://other.example.com', 'user-1'));
        expect(profile.email).toBe('user@example.com');
        expect(provider.allowDangerousEmailAccountLinking).toBe(false);
        expect(provider.checks).toEqual(expect.arrayContaining(['pkce', 'state', 'nonce']));
    });
});

describe('RFC 7523bis client assertion', () => {
    const signingConfigs: Array<[string, () => crypto.KeyObject]> = [
        ['RS256', () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey],
        ['ES256', () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey],
        ['ES384', () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey],
    ];

    it.each(signingConfigs)('signs %s assertions with the issuer as the sole audience', (alg, makeKey) => {
        const key = makeKey();
        const config = readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_PRIVATE_KEY: pem(key), OIDC_CLIENT_KEY_ID: 'key-1' }))!;
        const now = Date.UTC(2026, 9, 6, 12, 0, 0);
        const assertion = createClientAssertion({ ...config, signingKey: config.signingKey! }, now);
        const [header, payload, signature] = assertion.split('.');
        expect(decodePart(header)).toEqual({ alg, typ: 'JWT', kid: 'key-1' });
        const claims = decodePart(payload);
        expect(claims).toMatchObject({ iss: 'compdesk', sub: 'compdesk', aud: ISSUER, iat: now / 1000, exp: now / 1000 + 60 });
        expect(typeof claims.aud).toBe('string');
        expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
        const publicKey = crypto.createPublicKey(key);
        const verified = crypto.verify(alg === 'ES384' ? 'sha384' : 'sha256', Buffer.from(`${header}.${payload}`), alg === 'RS256' ? publicKey : { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
        expect(verified).toBe(true);
    });

    it('uses a fresh jti for every assertion', () => {
        const config = readOidcConfig(privateKeyJwtEnv())!;
        const ids = new Set(Array.from({ length: 5 }, () => decodePart(createClientAssertion({ ...config, signingKey: config.signingKey! }).split('.')[1]).jti));
        expect(ids.size).toBe(5);
    });

    it('adds the SHA-256 certificate thumbprint when a certificate is configured', () => {
        const config = readOidcConfig(privateKeyJwtEnv({ OIDC_CLIENT_CERTIFICATE: certificatePem }))!;
        const expected = crypto.createHash('sha256').update(new crypto.X509Certificate(certificatePem).raw).digest('base64url');
        expect(decodePart(createClientAssertion({ ...config, signingKey: config.signingKey! }).split('.')[0])['x5t#S256']).toBe(expected);
    });

    it('attaches the assertion only to the authorization-code token request', async () => {
        const config = readOidcConfig(privateKeyJwtEnv())! as OidcRuntimeConfig;
        const fetchImpl = jest.fn().mockResolvedValue(new Response('{}'));
        const hooked = createProviderFetch(config, { fetchImpl: fetchImpl as unknown as typeof fetch });
        await hooked(`${ISSUER}/userinfo`, { method: 'GET' });
        expect(fetchImpl.mock.calls[0][1]).toEqual({ method: 'GET' });
        const body = new URLSearchParams({ grant_type: 'authorization_code', code: 'abc', client_id: 'compdesk' });
        await hooked(`${ISSUER}/protocol/openid-connect/token`, { method: 'POST', body });
        expect(body.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
        expect(decodePart(body.get('client_assertion')!.split('.')[1]).aud).toBe(ISSUER);
    });

    it('refuses to build the hook without a signing key', () => {
        expect(() => createProviderFetch({ issuer: ISSUER, clientId: 'c', authMethod: 'private_key_jwt' })).toThrow('signing key');
    });
});

describe('TLS material validation', () => {
    it('parses certificate bundles and rejects garbage', () => {
        expect(parseCertificates(`${certificatePem}\n${certificatePem}`)).toHaveLength(2);
        expect(() => parseCertificates('not a certificate')).toThrow('BEGIN CERTIFICATE');
        expect(() => parseCertificates('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----')).toThrow('invalid PEM certificate');
        expect(() => parseCertificates('A'.repeat(70 * 1024))).toThrow('64 KB');
        expect(() => parsePrivateKey('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----')).toThrow('not a valid PEM private key');
    });
});

describe('SMTP certificates', () => {
    const savedEnvironment = { ...process.env };
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.APP_SETTINGS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
        delete process.env.SMTP_PASS; delete process.env.SMTP_PASSWORD;
    });
    afterAll(() => { process.env = savedEnvironment; });

    it('loads CA trust and an encrypted client key pair from settings', async () => {
        mockPrisma.appSetting.findMany.mockResolvedValue([
            { key: 'smtp_host', value: 'relay.example.com' }, { key: 'smtp_from', value: 'helpdesk@example.com' },
            { key: 'smtp_ca_certificate', value: certificatePem },
            { key: 'smtp_client_certificate', value: certificatePem },
            { key: 'smtp_client_key', value: encryptSettingSecret(certificateKeyPem) },
        ]);
        const smtp = await getSmtpConfig({} as never);
        expect(smtp.tls).toEqual({ ca: certificatePem, cert: certificatePem, key: certificateKeyPem });
        expect(hasSmtpAuthentication(smtp)).toBe(true);
    });

    it('allows certificate-only relays and keeps verification enabled', () => {
        createSmtpTransport({ host: 'relay.example.com', port: 465, secure: true, requireTLS: false, from: 'a@example.com', tls: { ca: 'CA', cert: 'CERT', key: 'KEY' } });
        expect(mockCreateTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined, tls: { rejectUnauthorized: true, ca: 'CA', cert: 'CERT', key: 'KEY' } }));
    });

    it('still refuses a relay with neither a password nor a client certificate', () => {
        expect(() => createSmtpTransport({ host: 'relay.example.com', port: 587, secure: false, requireTLS: true, from: 'a@example.com', tls: { ca: 'CA' } })).toThrow('client certificate');
    });
});

describe('SSO provider policy', () => {
    beforeEach(() => jest.clearAllMocks());

    it('reads the selected provider and falls back to Microsoft for unknown values', async () => {
        mockPrisma.appSetting.findMany.mockResolvedValue([{ key: 'sso_provider', value: 'keycloak' }]);
        await expect(getSelectedSsoProvider()).resolves.toBe('keycloak');
        mockPrisma.appSetting.findMany.mockResolvedValue([{ key: 'sso_provider', value: 'not-a-provider' }]);
        await expect(getSelectedSsoProvider()).resolves.toBe('microsoft-entra-id');
    });

    it('honours the beta.3 environment name when the new one is unset or empty', () => {
        expect(environmentPolicy('login_sso_enabled', { LOGIN_MICROSOFT_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
        expect(environmentPolicy('login_sso_enabled', { LOGIN_SSO_ENABLED: '', LOGIN_MICROSOFT_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
        expect(environmentPolicy('login_sso_enabled', { LOGIN_SSO_ENABLED: 'false', LOGIN_MICROSOFT_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    });
});
