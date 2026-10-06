// The single authority for whether an authentication configuration can lock administrators out.
// Used by the Settings API, branding saves, runtime login decisions, and the first-run setup.

export class AuthenticationPolicyError extends Error {
    constructor(message, reason) {
        super(message);
        this.name = 'AuthenticationPolicyError';
        this.reason = reason;
    }
}

const MESSAGES = {
    sso_disabled: 'Local login can be disabled only while single sign-on is enabled.',
    sso_unavailable: 'Local login can be disabled only while the selected single sign-on provider is configured and active in the running application. Save the provider settings and restart CompDesk first.',
    no_linked_super_admin: 'Local login can be disabled only after at least one active Super Admin has linked the selected single sign-on provider (Profile → Link account).',
    local_disabled_switch: 'The single sign-on provider can be switched only while local login stays enabled. Re-enable local login, or use SSO migration mode so users can link the new provider before cut-over.',
    no_local_super_admin: 'The single sign-on provider can be switched only while at least one active Super Admin can sign in with a local password. Set a password for a Super Admin, or use SSO migration mode.',
};

/**
 * @param {{ localEnabled: boolean, ssoEnabled: boolean, ssoUsable: boolean, linkedSuperAdmins: number }} input
 *   ssoUsable: the selected provider is valid and registered in the running process.
 *   linkedSuperAdmins: active Super Admins bound to the selected provider.
 */
export function evaluateAuthenticationPolicy({ localEnabled, ssoEnabled, ssoUsable, linkedSuperAdmins }) {
    const ssoAvailable = Boolean(ssoEnabled && ssoUsable);
    if (localEnabled) return { ok: true, localEnabled: true, ssoAvailable, reason: null };
    const reason = !ssoEnabled ? 'sso_disabled' : !ssoUsable ? 'sso_unavailable' : linkedSuperAdmins < 1 ? 'no_linked_super_admin' : null;
    // A configuration that would lock everyone out is never effective: local login stays available.
    return reason ? { ok: false, localEnabled: true, ssoAvailable, reason } : { ok: true, localEnabled: false, ssoAvailable, reason: null };
}

export function assertAuthenticationPolicy(input) {
    const result = evaluateAuthenticationPolicy(input);
    if (!result.ok) throw new AuthenticationPolicyError(MESSAGES[result.reason], result.reason);
    return result;
}

/**
 * Conservative rule until an SSO migration cut-over is used: switching the active provider directly
 * is allowed only while local login stays enabled and an active Super Admin can use a password.
 * @param {{ fromProvider: string, toProvider: string, localEnabled: boolean, localSuperAdmins: number }} input
 */
export function assertProviderSwitch({ fromProvider, toProvider, localEnabled, localSuperAdmins }) {
    if (fromProvider === toProvider) return;
    if (!localEnabled) throw new AuthenticationPolicyError(MESSAGES.local_disabled_switch, 'local_disabled_switch');
    if (localSuperAdmins < 1) throw new AuthenticationPolicyError(MESSAGES.no_local_super_admin, 'no_local_super_admin');
}
