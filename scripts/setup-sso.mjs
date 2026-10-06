// First-run setup: authentication choice (local / SSO / both), provider configuration, the
// "Test SSO configuration" check, and lockout prevention through the shared authentication policy.
import crypto from 'node:crypto';
import { AuthenticationPolicyError, assertAuthenticationPolicy } from './auth-policy.mjs';
import { testOidcDiscovery } from './oidc-discovery.mjs';
import { isAllowedOidcUrl, OIDC_AUTH_METHODS, oidcSigningAlgorithm, SSO_PROVIDER_OPTIONS } from './oidc-policy.mjs';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const LABELS = { 'microsoft-entra-id': 'Microsoft', google: 'Google', okta: 'Okta', keycloak: 'Keycloak', auth0: 'Auth0', authentik: 'authentik', oidc: 'OpenID Connect' };

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const text = (value) => String(value ?? '').trim();
const pem = (value) => String(value ?? '').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();

export function ssoProviderLabel(provider) { return LABELS[provider] ?? 'OpenID Connect'; }
export function setupCallbackPath(provider) { return provider === 'microsoft-entra-id' ? '/api/auth/callback/microsoft-entra-id' : '/api/auth/callback/oidc'; }

/** Canonical authentication input; also accepts the beta.3 shape ({ localEnabled, microsoftEnabled }). */
export function normalizeSetupAuthentication(raw = {}) {
    const legacyMode = raw.microsoftEnabled ? (raw.localEnabled === false ? 'sso' : 'both') : 'local';
    const mode = ['local', 'both', 'sso'].includes(raw.mode) ? raw.mode : legacyMode;
    const provider = SSO_PROVIDER_OPTIONS.includes(raw.provider) ? raw.provider : 'microsoft-entra-id';
    return {
        ...raw,
        mode,
        provider,
        localEnabled: mode !== 'sso',
        ssoEnabled: mode !== 'local',
        oidcAuthMethod: OIDC_AUTH_METHODS.includes(raw.oidcAuthMethod) ? raw.oidcAuthMethod : 'client_secret_basic',
    };
}

function parseCertificates(value, label) {
    const blocks = pem(value).match(CERTIFICATE_BLOCK) ?? [];
    if (!blocks.length) throw badRequest(`${label} must contain a PEM "BEGIN CERTIFICATE" block.`);
    try { return blocks.map((block) => new crypto.X509Certificate(block)); }
    catch { throw badRequest(`${label} contains an invalid PEM certificate.`); }
}

/** Validates the provider fields for an SSO-enabled setup. Returns nothing; throws 400 errors. */
export function validateSetupSso(auth, env = process.env) {
    if (!auth.ssoEnabled) return;
    if (auth.provider === 'microsoft-entra-id') {
        if (!GUID.test(text(auth.clientId)) || !GUID.test(text(auth.tenantId)) || !text(auth.clientSecret)) {
            throw badRequest('Provide a valid Entra Client ID, Tenant ID, and Client Secret together.');
        }
        return;
    }
    if (!isAllowedOidcUrl(text(auth.oidcIssuer), env)) throw badRequest('Enter the exact HTTPS issuer URL of the identity provider.');
    if (!text(auth.oidcClientId) || /[\r\n]/.test(auth.oidcClientId)) throw badRequest('The OpenID Connect client ID is required.');
    if (text(auth.oidcCaCertificate)) parseCertificates(auth.oidcCaCertificate, 'The identity provider CA certificate');
    if (auth.oidcAuthMethod !== 'private_key_jwt') {
        if (!text(auth.oidcClientSecret)) throw badRequest('The OpenID Connect client secret is required.');
        return;
    }
    if (/-----BEGIN ENCRYPTED|Proc-Type:\s*4,ENCRYPTED/.test(pem(auth.oidcPrivateKey))) throw badRequest('The client private key is passphrase-protected. Provide an unencrypted PEM key.');
    let key;
    try { key = crypto.createPrivateKey({ key: pem(auth.oidcPrivateKey), format: 'pem' }); }
    catch { throw badRequest('Provide a valid PEM client private key for private_key_jwt.'); }
    if (!oidcSigningAlgorithm(key)) throw badRequest('The client private key must be RSA (2048 bits or more), EC P-256, or EC P-384.');
    if (text(auth.oidcCertificate) && !parseCertificates(auth.oidcCertificate, 'The client certificate')[0].checkPrivateKey(key)) {
        throw badRequest('The client private key does not match the client certificate.');
    }
}

/**
 * Lockout prevention: the first Super Admin has no linked SSO identity yet, so SSO-only would lock
 * them out. Uses the same policy as the running application.
 */
export function assertSetupLoginPolicy(auth) {
    try {
        assertAuthenticationPolicy({ localEnabled: auth.localEnabled, ssoEnabled: auth.ssoEnabled, ssoUsable: auth.ssoEnabled, linkedSuperAdmins: 0 });
    } catch (error) {
        if (!(error instanceof AuthenticationPolicyError)) throw error;
        throw badRequest(`${error.message} Choose "Local and SSO" now; after the Super Admin links ${ssoProviderLabel(auth.provider)} from Profile, local login can be disabled in Settings → Security.`);
    }
}

/** The "Test SSO configuration" check. Never sends client credentials. */
export async function testSetupSso(auth, { diagnoseEntra, applicationUrl, env = process.env }) {
    validateSetupSso({ ...auth, ssoEnabled: true }, env);
    if (auth.provider === 'microsoft-entra-id') {
        await diagnoseEntra({ ...auth, microsoftEnabled: true }, applicationUrl);
        return { success: true, stage: 'success', message: 'Microsoft Entra ID metadata was retrieved and validated for this tenant.' };
    }
    const caCertificates = text(auth.oidcCaCertificate) ? parseCertificates(auth.oidcCaCertificate, 'The identity provider CA certificate').map((certificate) => certificate.toString()) : undefined;
    return testOidcDiscovery({ issuer: text(auth.oidcIssuer), authMethod: auth.oidcAuthMethod, caCertificates, env });
}

/** Runtime-environment entries for the chosen provider (values are quoted by the caller). */
export function setupSsoEnvironment(auth) {
    if (auth.provider === 'microsoft-entra-id') {
        if (!(auth.ssoEnabled || auth.clientId || auth.tenantId || auth.clientSecret)) return {};
        return { AZURE_AD_TENANT_ID: text(auth.tenantId), AZURE_AD_CLIENT_ID: text(auth.clientId), AZURE_AD_CLIENT_SECRET: text(auth.clientSecret) };
    }
    if (!auth.ssoEnabled) return {};
    const entries = {
        OIDC_ISSUER: text(auth.oidcIssuer),
        OIDC_CLIENT_ID: text(auth.oidcClientId),
        OIDC_CLIENT_AUTH_METHOD: auth.oidcAuthMethod,
        ...(auth.oidcAuthMethod === 'private_key_jwt'
            ? { OIDC_CLIENT_PRIVATE_KEY: pem(auth.oidcPrivateKey), OIDC_CLIENT_CERTIFICATE: pem(auth.oidcCertificate), OIDC_CLIENT_KEY_ID: text(auth.oidcKeyId) }
            : { OIDC_CLIENT_SECRET: text(auth.oidcClientSecret) }),
        OIDC_CA_CERTIFICATE: pem(auth.oidcCaCertificate),
    };
    return Object.fromEntries(Object.entries(entries).filter(([, value]) => value));
}

/** Non-secret fields that may be kept in the resumable setup state. */
export function nonSecretSetupAuthentication(auth) {
    return {
        mode: auth.mode, provider: auth.provider,
        tenantId: text(auth.tenantId), clientId: text(auth.clientId),
        oidcIssuer: text(auth.oidcIssuer), oidcClientId: text(auth.oidcClientId), oidcAuthMethod: auth.oidcAuthMethod, oidcKeyId: text(auth.oidcKeyId),
    };
}
