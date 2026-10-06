export type AuthenticationPolicyReason = 'sso_disabled' | 'sso_unavailable' | 'no_linked_super_admin' | 'local_disabled_switch' | 'no_local_super_admin';
export class AuthenticationPolicyError extends Error { readonly reason: AuthenticationPolicyReason; }
export interface AuthenticationPolicyInput { localEnabled: boolean; ssoEnabled: boolean; ssoUsable: boolean; linkedSuperAdmins: number }
export interface AuthenticationPolicyResult { ok: boolean; localEnabled: boolean; ssoAvailable: boolean; reason: AuthenticationPolicyReason | null }
export function evaluateAuthenticationPolicy(input: AuthenticationPolicyInput): AuthenticationPolicyResult;
export function assertAuthenticationPolicy(input: AuthenticationPolicyInput): AuthenticationPolicyResult;
export function assertProviderSwitch(input: { fromProvider: string; toProvider: string; localEnabled: boolean; localSuperAdmins: number }): void;
