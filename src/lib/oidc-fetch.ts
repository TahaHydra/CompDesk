import { isAllowedOidcUrl } from '@/lib/sso-presets';
import { assertSecureDiscoveryMetadata, createTrustedFetch, OidcTransportError } from '../../scripts/oidc-discovery.mjs';

export { assertSecureDiscoveryMetadata, createTrustedFetch, OidcTransportError };

export interface OidcFetchOptions {
    /** Adds client authentication to the authorization-code token request. */
    authenticateTokenRequest?: (body: URLSearchParams) => void;
    caCertificates?: string[];
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
}

/**
 * The single fetch used for all identity-provider traffic: every request URL must be HTTPS (loopback
 * HTTP only outside production), discovery metadata that downgrades endpoints is refused, and
 * credentials are attached only after the token endpoint URL has passed that check.
 */
export function createOidcFetch(options: OidcFetchOptions = {}): typeof fetch {
    const env = options.env ?? process.env;
    const transport = options.fetchImpl ?? (options.caCertificates?.length ? createTrustedFetch(options.caCertificates) : fetch);
    return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (!isAllowedOidcUrl(url, env)) throw new OidcTransportError(`Refusing to contact ${url.origin} over insecure HTTP.`);
        if (init?.body instanceof URLSearchParams && init.body.get('grant_type') === 'authorization_code') options.authenticateTokenRequest?.(init.body);
        const response = await transport(input, init);
        if (url.pathname.endsWith('/.well-known/openid-configuration') && response.ok) {
            assertSecureDiscoveryMetadata(await response.clone().json().catch(() => null), env);
        }
        return response;
    };
}
