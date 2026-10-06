// OpenID Connect transport rules and the "Test SSO configuration" check, shared by the application
// and the first-run setup so both enforce exactly the same behaviour.
import https from 'node:https';
import tls from 'node:tls';
import { isAllowedOidcUrl } from './oidc-policy.mjs';

export class OidcTransportError extends Error {
    constructor(message) { super(message); this.name = 'OidcTransportError'; }
}

const DISCOVERY_ENDPOINTS = ['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'jwks_uri', 'end_session_endpoint'];
const REQUIRED = new Set(['issuer', 'authorization_endpoint', 'token_endpoint']);
const MAX_RESPONSE_BYTES = 1024 * 1024;

export function discoveryUrl(issuer) {
    return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
}

/** Rejects discovery documents whose issuer or endpoints are not HTTPS (or loopback HTTP outside production). */
export function assertSecureDiscoveryMetadata(metadata, env = process.env) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new OidcTransportError('The OpenID Connect discovery document is not a JSON object.');
    for (const key of ['issuer', ...DISCOVERY_ENDPOINTS]) {
        const value = metadata[key];
        if (value === undefined && !REQUIRED.has(key)) continue;
        if (typeof value !== 'string' || !isAllowedOidcUrl(value, env)) {
            throw new OidcTransportError(`The OpenID Connect discovery document has an insecure or missing ${key}; HTTPS is required.`);
        }
    }
}

/**
 * fetch() over https.request with additional trusted roots. Node's built-in fetch cannot take a CA
 * per call and NODE_EXTRA_CA_CERTS applies only at process start, so a CompDesk-managed private CA
 * is applied here, scoped to identity-provider traffic. The system roots stay trusted.
 */
export function createTrustedFetch(caCertificates) {
    const agent = new https.Agent({ ca: [...tls.rootCertificates, ...caCertificates], keepAlive: true });
    return async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.protocol !== 'https:') return fetch(request);
        const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
        const headers = Object.fromEntries(request.headers);
        if (body) headers['content-length'] = String(body.length);
        return new Promise((resolve, reject) => {
            const outgoing = https.request(url, { method: request.method, headers, agent, signal: init?.signal ?? undefined }, (incoming) => {
                const chunks = [];
                let size = 0;
                incoming.on('data', (chunk) => {
                    size += chunk.length;
                    if (size > MAX_RESPONSE_BYTES) { incoming.destroy(); reject(new OidcTransportError('The identity provider response is too large.')); return; }
                    chunks.push(chunk);
                });
                incoming.on('error', reject);
                incoming.on('end', () => {
                    const responseHeaders = new Headers();
                    for (const [name, value] of Object.entries(incoming.headers)) {
                        for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(name, item);
                    }
                    const status = incoming.statusCode ?? 502;
                    resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, statusText: incoming.statusMessage, headers: responseHeaders }));
                });
            });
            outgoing.on('error', reject);
            outgoing.end(body);
        });
    };
}

function failureMessage(error) {
    if (error instanceof OidcTransportError) return { stage: 'metadata', message: error.message };
    const code = String(error?.cause?.code ?? error?.code ?? '');
    const name = String(error?.name ?? '');
    if (name === 'TimeoutError' || name === 'AbortError' || code === 'ETIMEDOUT') return { stage: 'discovery', message: 'The identity provider did not respond in time.' };
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { stage: 'discovery', message: 'The issuer host name could not be resolved.' };
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_TLS/.test(code)) return { stage: 'discovery', message: 'The identity provider TLS certificate is not trusted. Add its CA certificate under Advanced, or check the issuer host name.' };
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return { stage: 'discovery', message: 'The identity provider could not be reached. Check the URL, port, and outbound network policy.' };
    return { stage: 'discovery', message: 'The OpenID Connect discovery document could not be retrieved.' };
}

/**
 * Checks what CompDesk needs from an issuer before it is saved or used: secure discovery, an exact
 * issuer match, the endpoints Auth.js uses, and support for the chosen client authentication.
 * Credentials are never sent. Values are not echoed back except public endpoint URLs.
 */
export async function testOidcDiscovery({ issuer, authMethod = 'client_secret_basic', caCertificates, fetchImpl, env = process.env, timeoutMs = 10_000 }) {
    if (!isAllowedOidcUrl(issuer, env)) return { success: false, stage: 'configuration', message: 'The issuer must use HTTPS. Plain HTTP is accepted only for loopback test hosts outside production.' };
    const transport = fetchImpl ?? (caCertificates?.length ? createTrustedFetch(caCertificates) : fetch);
    let metadata;
    try {
        const response = await transport(discoveryUrl(issuer), { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) return { success: false, stage: 'discovery', message: `The discovery document returned HTTP ${response.status}.` };
        metadata = await response.json().catch(() => null);
        assertSecureDiscoveryMetadata(metadata, env);
    } catch (error) {
        return { success: false, ...failureMessage(error) };
    }
    if (metadata.issuer !== issuer) {
        return { success: false, stage: 'metadata', message: `The provider reports issuer "${metadata.issuer}", which must match the configured issuer exactly (including any trailing slash).` };
    }
    if (typeof metadata.userinfo_endpoint !== 'string') return { success: false, stage: 'metadata', message: 'The provider does not publish a userinfo endpoint, which CompDesk requires.' };
    const supported = Array.isArray(metadata.token_endpoint_auth_methods_supported) ? metadata.token_endpoint_auth_methods_supported : ['client_secret_basic'];
    if (!supported.includes(authMethod)) {
        return { success: false, stage: 'metadata', message: `The provider does not advertise ${authMethod} client authentication (supported: ${supported.join(', ') || 'none'}).` };
    }
    return {
        success: true,
        stage: 'success',
        message: 'Discovery succeeded: the issuer matches, every endpoint meets the transport policy (HTTPS; loopback HTTP only outside production), and the client authentication method is supported. Complete a test sign-in to confirm the client credentials.',
        endpoints: { authorization: metadata.authorization_endpoint, token: metadata.token_endpoint, userinfo: metadata.userinfo_endpoint },
    };
}
