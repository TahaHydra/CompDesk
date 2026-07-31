import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';

export type LoginPolicyKey = 'login_local_enabled' | 'login_microsoft_enabled';
const lastKnown = new Map<LoginPolicyKey, boolean>();
let lastFailureAuditAt = 0;

function environmentPolicy(key: LoginPolicyKey, env: NodeJS.ProcessEnv): boolean | undefined {
    const name = key === 'login_local_enabled' ? 'LOGIN_LOCAL_ENABLED' : 'LOGIN_MICROSOFT_ENABLED';
    const value = env[name]?.trim().toLowerCase();
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

export function resetLoginPolicyCacheForTests() { lastKnown.clear(); lastFailureAuditAt = 0; }

/**
 * Recovery policy: a validated DB value is cached in-process. On a DB read failure,
 * the cache wins, then an explicit LOGIN_* environment value. With neither available,
 * local credentials remain enabled as the documented break-glass path and Microsoft
 * login remains disabled. Deployments that intentionally disable local login must set
 * LOGIN_LOCAL_ENABLED=false so that decision survives a database outage at startup.
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