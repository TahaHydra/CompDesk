// Single source for single sign-on rules shared by the application (server and browser) and the
// first-run setup: provider options, client authentication methods, the HTTPS rule for identity
// provider URLs, and the accepted client-assertion key types. No Node.js imports: browser-safe.

/** Every option except Microsoft Entra ID is served by the generic OpenID Connect provider. */
export const SSO_PROVIDER_OPTIONS = ['microsoft-entra-id', 'google', 'okta', 'keycloak', 'auth0', 'authentik', 'oidc'];
export const OIDC_AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'private_key_jwt'];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Identity-provider URLs must be HTTPS. Plain HTTP is accepted only for loopback hosts outside
 * production, for local automated testing; credentials never travel to LAN or public HTTP hosts.
 * @param {string | URL} value @param {{ NODE_ENV?: string }} env
 */
export function isAllowedOidcUrl(value, env) {
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && env.NODE_ENV !== 'production' && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * JWS algorithm for a private_key_jwt client key: RSA (2048 bits or more), EC P-256, or EC P-384.
 * @param {{ asymmetricKeyType?: string, asymmetricKeyDetails?: { modulusLength?: number, namedCurve?: string } }} key a Node.js KeyObject
 * @returns {'RS256' | 'ES256' | 'ES384' | null}
 */
export function oidcSigningAlgorithm(key) {
    const details = key.asymmetricKeyDetails;
    if (key.asymmetricKeyType === 'rsa' && (details?.modulusLength ?? 0) >= 2048) return 'RS256';
    if (key.asymmetricKeyType === 'ec' && details?.namedCurve === 'prime256v1') return 'ES256';
    if (key.asymmetricKeyType === 'ec' && details?.namedCurve === 'secp384r1') return 'ES384';
    return null;
}
