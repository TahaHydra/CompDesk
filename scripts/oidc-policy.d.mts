export const SSO_PROVIDER_OPTIONS: readonly ['microsoft-entra-id', 'google', 'okta', 'keycloak', 'auth0', 'authentik', 'oidc'];
export const OIDC_AUTH_METHODS: readonly ['client_secret_basic', 'client_secret_post', 'private_key_jwt'];
export function isAllowedOidcUrl(value: string | URL, env: { NODE_ENV?: string }): boolean;
export function oidcSigningAlgorithm(key: { asymmetricKeyType?: string; asymmetricKeyDetails?: { modulusLength?: number; namedCurve?: string } }): 'RS256' | 'ES256' | 'ES384' | null;
