import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { renderEnvironment } from './setup-core.mjs';
import { assertSetupLoginPolicy, nonSecretSetupAuthentication, normalizeSetupAuthentication, setupCallbackPath, setupSsoEnvironment, validateSetupSso } from './setup-sso.mjs';

const ENTRA = { tenantId: '11111111-1111-4111-8111-111111111111', clientId: '22222222-2222-4222-8222-222222222222', clientSecret: 'secret' };
const OIDC = { provider: 'keycloak', oidcIssuer: 'https://sso.example.com/realms/compdesk', oidcClientId: 'compdesk', oidcClientSecret: 'secret' };
const pem = (key) => key.export({ type: 'pkcs8', format: 'pem' }).toString();

test('maps the beta.3 checkbox shape onto authentication modes', () => {
    assert.equal(normalizeSetupAuthentication({ localEnabled: true, microsoftEnabled: false }).mode, 'local');
    assert.equal(normalizeSetupAuthentication({ localEnabled: true, microsoftEnabled: true }).mode, 'both');
    assert.equal(normalizeSetupAuthentication({ localEnabled: false, microsoftEnabled: true }).mode, 'sso');
    const both = normalizeSetupAuthentication({ mode: 'both', provider: 'not-a-provider' });
    assert.deepEqual([both.localEnabled, both.ssoEnabled, both.provider, both.oidcAuthMethod], [true, true, 'microsoft-entra-id', 'client_secret_basic']);
});

test('refuses SSO-only for a first Super Admin who has no linked identity yet', () => {
    assert.throws(() => assertSetupLoginPolicy(normalizeSetupAuthentication({ mode: 'sso', ...OIDC })), (error) => error.statusCode === 400 && /Local and SSO/.test(error.message));
    assert.doesNotThrow(() => assertSetupLoginPolicy(normalizeSetupAuthentication({ mode: 'both', ...OIDC })));
    assert.doesNotThrow(() => assertSetupLoginPolicy(normalizeSetupAuthentication({ mode: 'local' })));
});

test('validates provider-specific fields', () => {
    assert.doesNotThrow(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...ENTRA })));
    assert.throws(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...ENTRA, clientId: 'nope' })), /Entra/);
    assert.doesNotThrow(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...OIDC })));
    assert.throws(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...OIDC, oidcIssuer: 'http://sso.example.com' }), { NODE_ENV: 'production' }), /HTTPS/);
    assert.throws(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...OIDC, oidcIssuer: 'http://localhost:8080/realms/dev' }), { NODE_ENV: 'production' }), /HTTPS/);
    assert.doesNotThrow(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...OIDC, oidcIssuer: 'http://localhost:8080/realms/dev' }), { NODE_ENV: 'development' }));
    assert.throws(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...OIDC, oidcClientSecret: '' })), /client secret/);
    assert.throws(() => validateSetupSso(normalizeSetupAuthentication({ mode: 'both', ...OIDC, oidcCaCertificate: 'garbage' })), /CA certificate/);
});

test('validates private_key_jwt keys with the same policy as the application', () => {
    const base = { mode: 'both', ...OIDC, oidcClientSecret: '', oidcAuthMethod: 'private_key_jwt' };
    assert.doesNotThrow(() => validateSetupSso(normalizeSetupAuthentication({ ...base, oidcPrivateKey: pem(crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey) })));
    assert.throws(() => validateSetupSso(normalizeSetupAuthentication({ ...base, oidcPrivateKey: pem(crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey) })), /2048/);
    assert.throws(() => validateSetupSso(normalizeSetupAuthentication({ ...base, oidcPrivateKey: 'not a key' })), /valid PEM/);
});

test('writes the chosen provider to the runtime environment, with PEM values on one line', () => {
    const key = pem(crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey);
    const auth = normalizeSetupAuthentication({ mode: 'both', ...OIDC, oidcAuthMethod: 'private_key_jwt', oidcClientSecret: 'unused', oidcPrivateKey: key, oidcKeyId: 'kid-1' });
    const environment = setupSsoEnvironment(auth);
    assert.deepEqual(Object.keys(environment).sort(), ['OIDC_CLIENT_AUTH_METHOD', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_KEY_ID', 'OIDC_CLIENT_PRIVATE_KEY', 'OIDC_ISSUER']);
    const rendered = renderEnvironment({ ssoEnabled: true, ssoEnvironment: environment });
    assert.match(rendered, /^LOGIN_SSO_ENABLED=true$/m);
    const line = rendered.split('\n').find((row) => row.startsWith('OIDC_CLIENT_PRIVATE_KEY='));
    assert.equal(JSON.parse(line.slice('OIDC_CLIENT_PRIVATE_KEY='.length)), key.trim());
    assert.deepEqual(setupSsoEnvironment(normalizeSetupAuthentication({ mode: 'local', ...OIDC })), {});
    assert.deepEqual(Object.keys(setupSsoEnvironment(normalizeSetupAuthentication({ mode: 'both', ...ENTRA }))), ['AZURE_AD_TENANT_ID', 'AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET']);
});

test('keeps secrets out of the resumable setup state and reports the callback path', () => {
    const state = JSON.stringify(nonSecretSetupAuthentication(normalizeSetupAuthentication({ mode: 'both', ...OIDC, ...ENTRA, oidcClientSecret: 'OIDC-SECRET-VALUE', clientSecret: 'ENTRA-SECRET-VALUE', oidcPrivateKey: 'PRIVATE-KEY-VALUE' })));
    for (const secret of ['OIDC-SECRET-VALUE', 'ENTRA-SECRET-VALUE', 'PRIVATE-KEY-VALUE']) assert.equal(state.includes(secret), false);
    assert.equal(setupCallbackPath('keycloak'), '/api/auth/callback/oidc');
    assert.equal(setupCallbackPath('microsoft-entra-id'), '/api/auth/callback/microsoft-entra-id');
});
