import type { Role } from '@prisma/client';
import type { OIDCConfig } from 'next-auth/providers';
import { normalizeEmail } from '@/lib/email-identity';

// Generic OpenID Connect sign-in (Authentik, Keycloak, Zitadel, Okta, ...) alongside the Entra provider.
// Enabled only when OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are all set. Endpoints come from
// the issuer's discovery document; PKCE, state and nonce are always checked.

export const GENERIC_OIDC_PROVIDER_ID = 'oidc';

const ROLE_RANK: Record<Role, number> = { USER: 0, AGENT: 1, ADMIN: 2, SUPER_ADMIN: 3 };
const ROLES = new Set<string>(Object.keys(ROLE_RANK));

export interface GenericOidcProfile {
    id: string;
    name: string;
    email: string;
    image: null;
    role?: Role;
}

export function isGenericOidcConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(env.OIDC_ISSUER?.trim() && env.OIDC_CLIENT_ID?.trim() && env.OIDC_CLIENT_SECRET?.trim());
}

export function genericOidcDisplayName(env: NodeJS.ProcessEnv = process.env): string {
    return env.OIDC_DISPLAY_NAME?.trim().slice(0, 60) || 'Single sign-on';
}

/** "admins=SUPER_ADMIN,staff=AGENT" -> [["admins","SUPER_ADMIN"],["staff","AGENT"]]. Unknown roles are ignored. */
export function parseOidcRoleMap(value: string | undefined): Array<[string, Role]> {
    return (value ?? '').split(',')
        .map((entry) => entry.split('='))
        .filter((parts) => parts.length === 2)
        .map(([group, role]) => [group.trim(), role.trim().toUpperCase()] as [string, string])
        .filter(([group, role]) => group.length > 0 && ROLES.has(role)) as Array<[string, Role]>;
}

/** Highest role granted by any mapped group, or null when no mapping matches (role then stays unchanged). */
export function roleFromOidcGroups(groups: unknown, map: Array<[string, Role]>): Role | null {
    if (!Array.isArray(groups) || map.length === 0) return null;
    const names = new Set(groups.filter((group): group is string => typeof group === 'string'));
    let best: Role | null = null;
    for (const [group, role] of map) {
        if (names.has(group) && (best === null || ROLE_RANK[role] > ROLE_RANK[best])) best = role;
    }
    return best;
}

function claim(profile: Record<string, unknown>, name: string | undefined, fallback: string): unknown {
    return profile[name?.trim() || fallback];
}

export function genericOidcProfile(profile: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): GenericOidcProfile {
    const id = String(claim(profile, env.OIDC_ID_CLAIM, 'sub') ?? '');
    const email = normalizeEmail(String(claim(profile, env.OIDC_EMAIL_CLAIM, 'email') ?? ''));
    const name = String(claim(profile, env.OIDC_NAME_CLAIM, 'name') ?? profile.preferred_username ?? email.split('@')[0] ?? '').trim();
    const role = roleFromOidcGroups(claim(profile, env.OIDC_GROUPS_CLAIM, 'groups'), parseOidcRoleMap(env.OIDC_ROLE_MAP));
    return { id, name: name || email, email, image: null, ...(role ? { role } : {}) };
}

/** Sign-in is refused unless the provider asserts a verified email (set OIDC_REQUIRE_VERIFIED_EMAIL=false to relax). */
export function genericOidcEmailAccepted(profile: Record<string, unknown> | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
    if (env.OIDC_REQUIRE_VERIFIED_EMAIL?.trim().toLowerCase() === 'false') return true;
    return profile?.email_verified === true || profile?.email_verified === 'true';
}

export function genericOidcProvider(env: NodeJS.ProcessEnv = process.env): OIDCConfig<Record<string, unknown>> {
    return {
        id: GENERIC_OIDC_PROVIDER_ID,
        name: genericOidcDisplayName(env),
        type: 'oidc',
        issuer: env.OIDC_ISSUER!.trim(),
        clientId: env.OIDC_CLIENT_ID!.trim(),
        clientSecret: env.OIDC_CLIENT_SECRET!.trim(),
        checks: ['pkce', 'state', 'nonce'],
        authorization: { params: { scope: env.OIDC_SCOPES?.trim() || 'openid email profile' } },
        // Accounts are linked by normalized email only after genericOidcEmailAccepted() confirms a verified address.
        allowDangerousEmailAccountLinking: true,
        profile: (profile) => genericOidcProfile(profile, env),
    };
}
