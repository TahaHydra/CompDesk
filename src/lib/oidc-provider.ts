import crypto from 'crypto';
import type { OIDCConfig } from 'next-auth/providers';
import logger from '@/lib/logger';
import { normalizeEmail } from '@/lib/email-identity';
import { createOidcFetch } from '@/lib/oidc-fetch';
import { parseCertificates, parsePrivateKey, readPemSource, assertKeyMatchesCertificate } from '@/lib/tls-material';
import { isAllowedOidcUrl, OIDC_AUTH_METHODS, type OidcClientAuthMethod } from '@/lib/sso-presets';
import { oidcSigningAlgorithm } from '../../scripts/oidc-policy.mjs';

type SigningAlgorithm = 'RS256' | 'ES256' | 'ES384';

export class OidcConfigError extends Error {}

/** Environment prefix of an OIDC configuration slot: the active provider, or a staged migration target. */
export type OidcSlot = 'OIDC' | 'OIDC_NEXT';
export const OIDC_SLOT_PROVIDER_ID: Record<OidcSlot, 'oidc' | 'oidc-next'> = { OIDC: 'oidc', OIDC_NEXT: 'oidc-next' };

export interface OidcSigningKey { key: crypto.KeyObject; alg: SigningAlgorithm; kid?: string; x5tS256?: string }
export interface OidcRuntimeConfig {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    authMethod: OidcClientAuthMethod;
    signingKey?: OidcSigningKey;
    caCertificates?: string[];
}

function signingAlgorithm(key: crypto.KeyObject): SigningAlgorithm {
    const algorithm = oidcSigningAlgorithm(key);
    if (!algorithm) throw new OidcConfigError('The OIDC client key must be RSA (2048 bits or more), EC P-256, or EC P-384.');
    return algorithm;
}

/** Returns null when the slot is not configured; throws OidcConfigError when it is configured incorrectly. */
export function readOidcConfig(env: NodeJS.ProcessEnv = process.env, slot: OidcSlot = 'OIDC'): OidcRuntimeConfig | null {
    const value = (name: string) => env[`${slot}_${name}`];
    const issuer = value('ISSUER')?.trim();
    const clientId = value('CLIENT_ID')?.trim();
    if (!issuer || !clientId) return null;
    try { new URL(issuer); } catch { throw new OidcConfigError(`${slot}_ISSUER must be an absolute URL.`); }
    if (!isAllowedOidcUrl(issuer, env)) throw new OidcConfigError(`${slot}_ISSUER must use HTTPS. Plain HTTP is accepted only for loopback test hosts outside production.`);
    const authMethod = (value('CLIENT_AUTH_METHOD')?.trim() || 'client_secret_basic') as OidcClientAuthMethod;
    if (!OIDC_AUTH_METHODS.includes(authMethod)) throw new OidcConfigError(`${slot}_CLIENT_AUTH_METHOD must be one of ${OIDC_AUTH_METHODS.join(', ')}.`);
    const caPem = readPemSource(value('CA_CERTIFICATE'), value('CA_FILE'));
    const caCertificates = caPem ? parseCertificates(caPem, 'OIDC CA certificate').map((certificate) => certificate.toString()) : undefined;

    if (authMethod !== 'private_key_jwt') {
        const clientSecret = value('CLIENT_SECRET');
        if (!clientSecret?.trim()) throw new OidcConfigError(`${slot}_CLIENT_SECRET is required for client-secret authentication.`);
        return { issuer, clientId, clientSecret, authMethod, caCertificates };
    }

    const keyPem = readPemSource(value('CLIENT_PRIVATE_KEY'), value('CLIENT_PRIVATE_KEY_FILE'));
    if (!keyPem) throw new OidcConfigError(`${slot}_CLIENT_PRIVATE_KEY or ${slot}_CLIENT_PRIVATE_KEY_FILE is required for private_key_jwt.`);
    const key = parsePrivateKey(keyPem, 'OIDC client private key');
    const certificatePem = readPemSource(value('CLIENT_CERTIFICATE'), value('CLIENT_CERTIFICATE_FILE'));
    let x5tS256: string | undefined;
    if (certificatePem) {
        const [certificate] = parseCertificates(certificatePem, 'OIDC client certificate');
        assertKeyMatchesCertificate(certificate, key);
        x5tS256 = crypto.createHash('sha256').update(certificate.raw).digest('base64url');
    }
    return { issuer, clientId, authMethod, caCertificates, signingKey: { key, alg: signingAlgorithm(key), kid: value('CLIENT_KEY_ID')?.trim() || undefined, x5tS256 } };
}

const processConfigs = new Map<OidcSlot, OidcRuntimeConfig | null>();
/** Configuration of the running process, validated once; invalid configuration disables the provider. */
export function getRuntimeOidcConfig(slot: OidcSlot = 'OIDC'): OidcRuntimeConfig | null {
    if (!processConfigs.has(slot)) {
        try { processConfigs.set(slot, readOidcConfig(process.env, slot)); }
        catch (error) {
            logger.error('OpenID Connect sign-in is disabled because its configuration is invalid', { slot, error: error instanceof Error ? error.message : 'unknown' });
            processConfigs.set(slot, null);
        }
    }
    return processConfigs.get(slot) ?? null;
}

export function isOidcRuntimeConfigured(slot: OidcSlot = 'OIDC'): boolean {
    return getRuntimeOidcConfig(slot) !== null;
}

function base64UrlJson(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * RFC 7523 client assertion following draft-ietf-oauth-rfc7523bis: the issuer identifier is the
 * sole audience. `typ` stays `JWT` because explicit typing is only RECOMMENDED and older servers
 * may reject unknown values.
 */
export function createClientAssertion(config: Pick<OidcRuntimeConfig, 'issuer' | 'clientId'> & { signingKey: OidcSigningKey }, now = Date.now()): string {
    const { key, alg, kid, x5tS256 } = config.signingKey;
    const issuedAt = Math.floor(now / 1000);
    const input = `${base64UrlJson({ alg, typ: 'JWT', ...(kid ? { kid } : {}), ...(x5tS256 ? { 'x5t#S256': x5tS256 } : {}) })}.${base64UrlJson({
        iss: config.clientId,
        sub: config.clientId,
        aud: config.issuer,
        jti: crypto.randomUUID(),
        iat: issuedAt,
        exp: issuedAt + 60,
    })}`;
    const signature = crypto.sign(alg === 'ES384' ? 'sha384' : 'sha256', Buffer.from(input), alg === 'RS256' ? key : { key, dsaEncoding: 'ieee-p1363' });
    return `${input}.${signature.toString('base64url')}`;
}

/** The provider's fetch: HTTPS enforcement, managed CA trust, and private_key_jwt client assertions. */
export function createProviderFetch(config: OidcRuntimeConfig, options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {}): typeof fetch {
    const { signingKey } = config;
    if (config.authMethod === 'private_key_jwt' && !signingKey) throw new OidcConfigError('A client signing key is required for private_key_jwt.');
    return createOidcFetch({
        ...options,
        caCertificates: config.caCertificates,
        authenticateTokenRequest: signingKey ? (body) => {
            body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
            body.set('client_assertion', createClientAssertion({ ...config, signingKey }));
        } : undefined,
    });
}

export function oidcAccountId(issuer: string, subject: string): string {
    return `${issuer} ${subject}`;
}

/** Auth.js provider options; auth.ts attaches createProviderFetch() as the customFetch hook. */
export function createOidcProvider(config: OidcRuntimeConfig, slot: OidcSlot = 'OIDC'): OIDCConfig<Record<string, unknown>> {
    return {
        id: OIDC_SLOT_PROVIDER_ID[slot],
        name: 'OpenID Connect',
        type: 'oidc',
        issuer: config.issuer,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        // For private_key_jwt Auth.js sends no credentials ('none'); CompDesk attaches its own
        // issuer-audience assertion through the supported customFetch hook instead.
        client: { token_endpoint_auth_method: config.authMethod === 'private_key_jwt' ? 'none' : config.authMethod },
        checks: ['pkce', 'state', 'nonce'],
        authorization: { params: { scope: 'openid profile email' } },
        // Email claims are not proof of local-account ownership; existing accounts link only from
        // an authenticated session.
        allowDangerousEmailAccountLinking: false,
        profile(profile) {
            const email = typeof profile.email === 'string' ? profile.email : '';
            const name = [profile.name, profile.preferred_username, email].find((value) => typeof value === 'string' && value.trim());
            // Auth.js stores this id as providerAccountId. `sub` is only unique per issuer, so the
            // identity is issuer-scoped: switching IdPs can never resolve to another IdP's account.
            return { id: oidcAccountId(String(profile.iss ?? config.issuer), String(profile.sub)), name: String(name ?? ''), email: normalizeEmail(email), image: null };
        },
    };
}
