import { isAllowedOidcUrl as isAllowedOidcUrlPolicy, OIDC_AUTH_METHODS, SSO_PROVIDER_OPTIONS } from '../../scripts/oidc-policy.mjs';

// Client-safe SSO provider catalogue. Every option except Microsoft Entra ID is a
// standards-based OpenID Connect provider served by the single generic `oidc` Auth.js provider;
// presets only supply a label, a logo and an issuer hint.
// The option and method lists live in scripts/oidc-policy.mjs so the first-run setup uses the same values.
export { OIDC_AUTH_METHODS, SSO_PROVIDER_OPTIONS };
export type SsoProviderOption = (typeof SSO_PROVIDER_OPTIONS)[number];
export type SsoAuthProviderId = 'microsoft-entra-id' | 'oidc';

export type OidcClientAuthMethod = (typeof OIDC_AUTH_METHODS)[number];

export const DEFAULT_SSO_PROVIDER: SsoProviderOption = 'microsoft-entra-id';
export const SSO_PROVIDER_SETTING_KEY = 'sso_provider';
// Provider-neutral switch; migration 20261006120000 copies the beta.3 `login_microsoft_enabled` value.
export const SSO_LOGIN_SETTING_KEY = 'login_sso_enabled';

export const SSO_PRESETS: Record<SsoProviderOption, { label: string; issuerHint: string }> = {
    'microsoft-entra-id': { label: 'Microsoft', issuerHint: '' },
    google: { label: 'Google', issuerHint: 'https://accounts.google.com' },
    okta: { label: 'Okta', issuerHint: 'https://your-org.okta.com/oauth2/default' },
    keycloak: { label: 'Keycloak', issuerHint: 'https://sso.example.com/realms/your-realm' },
    auth0: { label: 'Auth0', issuerHint: 'https://your-tenant.eu.auth0.com/' },
    authentik: { label: 'authentik', issuerHint: 'https://sso.example.com/application/o/compdesk/' },
    oidc: { label: 'OpenID Connect', issuerHint: 'https://idp.example.com' },
};

/**
 * Identity-provider URLs must be HTTPS; loopback HTTP is accepted only outside production. The rule
 * lives in scripts/ so the first-run setup enforces the identical policy.
 */
export function isAllowedOidcUrl(value: string | URL, env: { NODE_ENV?: string } = { NODE_ENV: process.env.NODE_ENV }): boolean {
    return isAllowedOidcUrlPolicy(value, env);
}

export function parseSsoProvider(value: unknown): SsoProviderOption {
    return SSO_PROVIDER_OPTIONS.includes(value as SsoProviderOption) ? value as SsoProviderOption : DEFAULT_SSO_PROVIDER;
}

export function ssoAuthProviderId(option: SsoProviderOption): SsoAuthProviderId {
    return option === 'microsoft-entra-id' ? 'microsoft-entra-id' : 'oidc';
}

/** Auth.js provider ids: the active slots plus the staged OpenID Connect migration slot. */
export type RuntimeSsoProviderId = SsoAuthProviderId | 'oidc-next';

export type OidcRuntimeSlot = 'oidc' | 'oidc-next';
export const SSO_OIDC_SLOT_KEY = 'sso_oidc_slot';

/**
 * Which configuration slots are in use. OpenID Connect has two fixed slots (`oidc`, `oidc-next`);
 * `oidcSlot` records which one the active provider uses, so a migration cut-over between two
 * OpenID Connect providers only flips settings and never rewrites credentials or account bindings.
 */
export interface SsoSlots { provider: SsoProviderOption; migrationTarget: SsoProviderOption | null; oidcSlot: OidcRuntimeSlot }

export function activeProviderId(slots: SsoSlots): RuntimeSsoProviderId {
    return ssoAuthProviderId(slots.provider) === 'oidc' ? slots.oidcSlot : 'microsoft-entra-id';
}

/** The provider a migration target signs in through, or null when there is no (supported) target. Entra → Entra is unsupported. */
export function targetProviderId(slots: SsoSlots): RuntimeSsoProviderId | null {
    if (!slots.migrationTarget) return null;
    const activeIsOidc = ssoAuthProviderId(slots.provider) === 'oidc';
    if (ssoAuthProviderId(slots.migrationTarget) === 'microsoft-entra-id') return activeIsOidc ? 'microsoft-entra-id' : null;
    return activeIsOidc ? (slots.oidcSlot === 'oidc' ? 'oidc-next' : 'oidc') : slots.oidcSlot;
}

/** Settings-key prefix of the OpenID Connect slot behind a runtime provider id. */
export function oidcSettingPrefix(providerId: RuntimeSsoProviderId): 'oidc' | 'oidc_next' | null {
    return providerId === 'oidc' ? 'oidc' : providerId === 'oidc-next' ? 'oidc_next' : null;
}

export function defaultSsoButtonText(option: SsoProviderOption): string {
    return `Sign in with ${SSO_PRESETS[option].label}`;
}

export function isDefaultSsoButtonText(text: string): boolean {
    return SSO_PROVIDER_OPTIONS.some((option) => defaultSsoButtonText(option) === text);
}
