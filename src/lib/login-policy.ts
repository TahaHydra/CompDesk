import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { getRuntimeOidcConfig, isOidcRuntimeConfigured } from '@/lib/oidc-provider';
import { activeProviderId, DEFAULT_SSO_PROVIDER, parseSsoProvider, SSO_OIDC_SLOT_KEY, SSO_PROVIDER_SETTING_KEY, targetProviderId, type OidcRuntimeSlot, type RuntimeSsoProviderId, type SsoProviderOption, type SsoSlots } from '@/lib/sso-presets';
import { assertAuthenticationPolicy, assertProviderSwitch, evaluateAuthenticationPolicy } from '../../scripts/auth-policy.mjs';

export type LoginPolicyKey = 'login_local_enabled' | 'login_sso_enabled';
export type { RuntimeSsoProviderId };
export const SSO_MIGRATION_TARGET_KEY = 'sso_migration_target';
export const SSO_MIGRATION_PHASE_KEY = 'sso_migration_phase';
export type SsoMigrationPhase = 'staging' | 'rollback';

const lastKnown = new Map<LoginPolicyKey, boolean>();
let lastFailureAuditAt = 0;
let lastLockoutAuditAt = 0;

export function environmentPolicy(key: LoginPolicyKey, env: NodeJS.ProcessEnv): boolean | undefined {
    // LOGIN_MICROSOFT_ENABLED is the beta.3 name, still honoured when LOGIN_SSO_ENABLED is unset.
    const raw = key === 'login_local_enabled' ? env.LOGIN_LOCAL_ENABLED : env.LOGIN_SSO_ENABLED?.trim() || env.LOGIN_MICROSOFT_ENABLED;
    const value = raw?.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

export function resetLoginPolicyCacheForTests() { lastKnown.clear(); lastFailureAuditAt = 0; lastLockoutAuditAt = 0; }

/**
 * Recovery policy: a validated DB value is cached in-process. On a DB read failure,
 * the cache wins, then an explicit LOGIN_* environment value. With neither available,
 * local credentials remain enabled as the documented break-glass path and SSO
 * login remains disabled. Deployments that intentionally disable local login must set
 * LOGIN_LOCAL_ENABLED=false so that decision survives a database outage at startup.
 * This is the configured value; getEffectiveLoginPolicy() applies lockout protection.
 */
export async function isLoginMethodEnabled(key: LoginPolicyKey, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    try {
        const setting = await prisma.appSetting.findUnique({ where: { key } });
        const configured = setting?.value === 'true' ? true : setting?.value === 'false' ? false : undefined;
        const resolved = configured ?? environmentPolicy(key, env) ?? (key === 'login_local_enabled');
        lastKnown.set(key, resolved);
        return resolved;
    } catch {
        const cached = lastKnown.get(key);
        const environment = environmentPolicy(key, env);
        const recovery = cached ?? environment ?? (key === 'login_local_enabled');
        const now = Date.now();
        if (now - lastFailureAuditAt > 60_000) {
            lastFailureAuditAt = now;
            void auditLog({ action: 'auth.policy_read_failed', entity: 'auth', metadata: { key, recoverySource: cached !== undefined ? 'last_known' : environment !== undefined ? 'environment' : key === 'login_local_enabled' ? 'local_break_glass' : 'secure_default', enabled: recovery } });
        }
        return recovery;
    }
}

export function isEntraRuntimeConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.AZURE_AD_CLIENT_ID && env.AZURE_AD_CLIENT_SECRET && env.AZURE_AD_TENANT_ID);
}

export function isRuntimeProviderConfigured(providerId: RuntimeSsoProviderId): boolean {
    if (providerId === 'microsoft-entra-id') return isEntraRuntimeConfigured();
    return isOidcRuntimeConfigured(providerId === 'oidc' ? 'OIDC' : 'OIDC_NEXT');
}

/** Both OpenID Connect slots store accounts as `oidc`; identities are issuer-scoped, so they cannot collide. */
export function storedAccountProvider(providerId: string): string {
    return providerId === 'oidc-next' ? 'oidc' : providerId;
}

/** Accounts that belong to a runtime provider, or null when that provider is not configured. */
export function providerAccountFilter(providerId: RuntimeSsoProviderId): Prisma.AccountWhereInput | null {
    if (providerId === 'microsoft-entra-id') return { provider: 'microsoft-entra-id' };
    const config = getRuntimeOidcConfig(providerId === 'oidc' ? 'OIDC' : 'OIDC_NEXT');
    return config ? { provider: 'oidc', providerAccountId: { startsWith: `${config.issuer} ` } } : null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Entra tenant and application of the running process: Entra subjects are pairwise per application and tenant. */
function entraNamespace(env: NodeJS.ProcessEnv = process.env) {
    return { tenant: env.AZURE_AD_TENANT_ID?.trim().toLowerCase() ?? '', client: env.AZURE_AD_CLIENT_ID?.trim().toLowerCase() ?? '' };
}

/**
 * Whether a stored Entra binding was created for the running tenant and application, read from the
 * id_token Auth.js stored when the account was linked. Unknown bindings count as unusable, which is
 * the safe direction for lockout decisions; they still sign in normally if they match.
 */
export function isCurrentEntraBinding(account: { id_token?: string | null }, env: NodeJS.ProcessEnv = process.env): boolean {
    const { tenant, client } = entraNamespace(env);
    if (!account.id_token || !client) return false;
    try {
        const claims = JSON.parse(Buffer.from(account.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { aud?: unknown; tid?: unknown };
        const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? '')];
        if (!audience.some((value) => value.toLowerCase() === client)) return false;
        return !GUID.test(tenant) || String(claims.tid ?? '').toLowerCase() === tenant;
    } catch { return false; }
}

/** Whether one stored account is a usable binding for a runtime provider. */
export function isUsableBinding(providerId: RuntimeSsoProviderId, account: { provider: string; providerAccountId: string; id_token?: string | null }): boolean {
    const filter = providerAccountFilter(providerId);
    if (!filter || account.provider !== filter.provider) return false;
    if (providerId === 'microsoft-entra-id') return isCurrentEntraBinding(account);
    const prefix = (filter.providerAccountId as { startsWith?: string } | undefined)?.startsWith;
    return !prefix || account.providerAccountId.startsWith(prefix);
}

/** Users with a usable binding to a runtime provider (Entra bindings are checked against the running tenant). */
export async function countUsersLinkedTo(providerId: RuntimeSsoProviderId, users: Prisma.UserWhereInput): Promise<number> {
    const accounts = providerAccountFilter(providerId);
    if (!accounts) return 0;
    if (providerId !== 'microsoft-entra-id') return prisma.user.count({ where: { ...users, accounts: { some: accounts } } });
    const rows = await prisma.account.findMany({ where: { ...accounts, user: users }, select: { userId: true, id_token: true } });
    return new Set(rows.filter((row) => isCurrentEntraBinding(row)).map((row) => row.userId)).size;
}

export async function countLinkedSuperAdmins(providerId: RuntimeSsoProviderId): Promise<number> {
    try { return await countUsersLinkedTo(providerId, { role: 'SUPER_ADMIN', isActive: true }); }
    catch { return 0; }
}

async function countLocalSuperAdmins(): Promise<number> {
    return prisma.user.count({ where: { role: 'SUPER_ADMIN', isActive: true, passwordHash: { not: null } } });
}


export interface SsoState extends SsoSlots { migrationPhase: SsoMigrationPhase | null }

export async function getSsoState(): Promise<SsoState> {
    try {
        const rows = await prisma.appSetting.findMany({ where: { key: { in: [SSO_PROVIDER_SETTING_KEY, SSO_OIDC_SLOT_KEY, SSO_MIGRATION_TARGET_KEY, SSO_MIGRATION_PHASE_KEY] } }, select: { key: true, value: true } });
        const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
        const slots: SsoSlots = {
            provider: parseSsoProvider(values[SSO_PROVIDER_SETTING_KEY]),
            oidcSlot: values[SSO_OIDC_SLOT_KEY] === 'oidc-next' ? 'oidc-next' : 'oidc',
            migrationTarget: values[SSO_MIGRATION_TARGET_KEY] ? parseSsoProvider(values[SSO_MIGRATION_TARGET_KEY]) : null,
        };
        const phase = values[SSO_MIGRATION_PHASE_KEY] === 'rollback' ? 'rollback' : values[SSO_MIGRATION_PHASE_KEY] === 'staging' ? 'staging' : null;
        return phase && targetProviderId(slots) ? { ...slots, migrationPhase: phase } : { ...slots, migrationTarget: null, migrationPhase: null };
    } catch {
        return { provider: DEFAULT_SSO_PROVIDER, oidcSlot: 'oidc', migrationTarget: null, migrationPhase: null };
    }
}

export async function getSelectedSsoProvider(): Promise<SsoProviderOption> {
    return (await getSsoState()).provider;
}

/** Whether the active provider for an SSO option is registered in the running process. */
export async function isSsoRuntimeConfigured(option?: SsoProviderOption): Promise<boolean> {
    const state = await getSsoState();
    return isRuntimeProviderConfigured(activeProviderId({ ...state, provider: option ?? state.provider }));
}

export interface EffectiveLoginPolicy { localEnabled: boolean; ssoEnabled: boolean; ssoAvailable: boolean; ssoProvider: SsoProviderOption; ssoProviderId: RuntimeSsoProviderId; lockoutPrevented: boolean }

/**
 * The login methods actually offered. Configuration that would lock administrators out (from the
 * database, the environment, or a provider that failed to load) never takes effect: local login
 * stays available and the event is audited.
 */
export async function getEffectiveLoginPolicy(): Promise<EffectiveLoginPolicy> {
    const [localEnabled, ssoEnabled, state] = await Promise.all([
        isLoginMethodEnabled('login_local_enabled'), isLoginMethodEnabled('login_sso_enabled'), getSsoState(),
    ]);
    const providerId = activeProviderId(state);
    const ssoUsable = isRuntimeProviderConfigured(providerId);
    const result = evaluateAuthenticationPolicy({ localEnabled, ssoEnabled, ssoUsable, linkedSuperAdmins: localEnabled ? 0 : await countLinkedSuperAdmins(providerId) });
    if (!result.ok && Date.now() - lastLockoutAuditAt > 60_000) {
        lastLockoutAuditAt = Date.now();
        void auditLog({ action: 'auth.lockout_prevented', entity: 'auth', metadata: { reason: result.reason, ssoProvider: state.provider } });
    }
    return { localEnabled: result.localEnabled, ssoEnabled, ssoAvailable: result.ssoAvailable, ssoProvider: state.provider, ssoProviderId: providerId, lockoutPrevented: !result.ok };
}

export interface ProposedAuthentication { localEnabled?: boolean; ssoEnabled?: boolean; ssoProvider?: SsoProviderOption; oidcSlot?: OidcRuntimeSlot; migrationCutover?: boolean }

/**
 * Write-path guard, shared by Settings, branding, and migration: refuses a proposed configuration
 * that could lock administrators out. A direct provider switch additionally requires local login
 * and a password-capable Super Admin; a migration cut-over has its own verified-link checks.
 */
export async function assertProposedAuthentication(proposed: ProposedAuthentication): Promise<void> {
    const [currentLocal, currentSso, state] = await Promise.all([
        isLoginMethodEnabled('login_local_enabled'), isLoginMethodEnabled('login_sso_enabled'), getSsoState(),
    ]);
    const localEnabled = proposed.localEnabled ?? currentLocal;
    const next: SsoSlots = { ...state, provider: proposed.ssoProvider ?? state.provider, oidcSlot: proposed.oidcSlot ?? state.oidcSlot };
    const providerId = activeProviderId(next);
    assertAuthenticationPolicy({
        localEnabled,
        ssoEnabled: proposed.ssoEnabled ?? currentSso,
        ssoUsable: isRuntimeProviderConfigured(providerId),
        linkedSuperAdmins: localEnabled ? 0 : await countLinkedSuperAdmins(providerId),
    });
    if (!proposed.migrationCutover && next.provider !== state.provider) {
        assertProviderSwitch({ fromProvider: state.provider, toProvider: next.provider, localEnabled, localSuperAdmins: await countLocalSuperAdmins() });
    }
}

/**
 * How an SSO provider may be used right now: `active` for normal sign-in, `migration` for a staged
 * target (linking from an authenticated session, or verifying an existing link), otherwise refused.
 */
export async function resolveSsoSignInRole(providerId: string): Promise<'active' | 'migration' | null> {
    const state = await getSsoState();
    if (activeProviderId(state) === providerId) return (await getEffectiveLoginPolicy()).ssoAvailable ? 'active' : null;
    const target = targetProviderId(state);
    if (target === providerId && isRuntimeProviderConfigured(target)) return 'migration';
    return null;
}

/**
 * Changing the active OpenID Connect issuer starts a new identity namespace (identities are
 * `issuer + subject`), so existing links stop matching. It follows the direct-switch rule and
 * returns how many links will no longer sign in; a staged or unused slot is unaffected.
 */
export async function assessActiveIssuerChange(prefix: 'oidc' | 'oidc_next', currentIssuer: string, nextIssuer: string): Promise<number> {
    if (!currentIssuer || !nextIssuer || currentIssuer === nextIssuer) return 0;
    if (activeProviderId(await getSsoState()) !== (prefix === 'oidc' ? 'oidc' : 'oidc-next')) return 0;
    const orphaned = await prisma.account.count({ where: { provider: 'oidc', providerAccountId: { startsWith: `${currentIssuer} ` } } });
    if (orphaned > 0) {
        assertProviderSwitch({ fromProvider: currentIssuer, toProvider: nextIssuer, localEnabled: await isLoginMethodEnabled('login_local_enabled'), localSuperAdmins: await countLocalSuperAdmins() });
    }
    return orphaned;
}

/**
 * Changing the Entra tenant or application ID of the active provider orphans its bindings (Entra
 * subjects are pairwise per tenant and application). Same rule and warning as an issuer change.
 */
export async function assessActiveEntraChange(next: { tenant?: string; client?: string }): Promise<number> {
    const current = entraNamespace();
    const tenantChanges = next.tenant !== undefined && next.tenant.trim() !== '' && next.tenant.trim().toLowerCase() !== current.tenant;
    const clientChanges = next.client !== undefined && next.client.trim() !== '' && next.client.trim().toLowerCase() !== current.client;
    if (!tenantChanges && !clientChanges) return 0;
    if (activeProviderId(await getSsoState()) !== 'microsoft-entra-id') return 0;
    const orphaned = await countUsersLinkedTo('microsoft-entra-id', {});
    if (orphaned > 0) {
        assertProviderSwitch({ fromProvider: 'entra', toProvider: 'entra (new tenant or application)', localEnabled: await isLoginMethodEnabled('login_local_enabled'), localSuperAdmins: await countLocalSuperAdmins() });
    }
    return orphaned;
}
