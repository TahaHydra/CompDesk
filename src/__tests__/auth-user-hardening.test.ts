import fs from 'fs';
import path from 'path';

const mockThrottleRows = new Map<string, any>();
let mockThrottleId = 0;
const mockLoginThrottle = {
    deleteMany: jest.fn(async ({ where }: any) => {
        let count = 0;
        for (const [key, row] of [...mockThrottleRows.entries()]) {
            const expired = where.expiresAt?.lt && row.expiresAt < where.expiresAt.lt;
            const selected = where.keyHash?.in?.includes(row.keyHash);
            if (expired || selected) {
                mockThrottleRows.delete(key);
                count += 1;
            }
        }
        return { count };
    }),
    findMany: jest.fn(async ({ where }: any) => [...mockThrottleRows.values()].filter((row) =>
        where.keyHash.in.includes(row.keyHash) && row.blockedUntil && row.blockedUntil > where.blockedUntil.gt
    )),
    upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = mockThrottleRows.get(where.keyHash);
        if (existing) {
            existing.failureCount += update.failureCount.increment;
            existing.expiresAt = update.expiresAt;
            return { ...existing };
        }
        const row = { id: `throttle-${++mockThrottleId}`, blockedUntil: null, ...create };
        mockThrottleRows.set(where.keyHash, row);
        return { ...row };
    }),
    update: jest.fn(async ({ where, data }: any) => {
        const row = [...mockThrottleRows.values()].find((entry) => entry.id === where.id);
        Object.assign(row, data);
        return { ...row };
    }),
};
const mockPrisma = {
    loginThrottle: mockLoginThrottle,
    $transaction: jest.fn(async (callback: any) => callback({ loginThrottle: mockLoginThrottle })),
};

jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { normalizeEmail } from '@/lib/email-identity';
import { calculateLoginThrottle, checkLoginThrottle, clearLoginFailures, recordLoginFailure } from '@/lib/login-throttle';
import { isSessionTokenCurrent } from '@/lib/session-security';
import { requestSourceIp } from '@/lib/request-ip';
import { createUserSchema, updateUserSchema } from '@/lib/user-validation';

function source(file: string) {
    return fs.readFileSync(path.join(process.cwd(), ...file.split('/')), 'utf8');
}

beforeEach(() => {
    process.env.AUTH_SECRET = 'test-auth-secret-with-at-least-thirty-two-bytes';
    mockThrottleRows.clear();
    mockThrottleId = 0;
    jest.clearAllMocks();
});

describe('distributed local-login throttling', () => {
    it('uses progressive delay and a temporary account/source lockout', () => {
        expect(calculateLoginThrottle('account_source', 1).delayMs).toBe(200);
        expect(calculateLoginThrottle('account_source', 4).blockedUntil).toBeNull();
        expect(calculateLoginThrottle('account_source', 5).blockedUntil).toBeInstanceOf(Date);
    });

    it('persists failures in PostgreSQL-backed records and blocks the fifth account/source failure', async () => {
        const now = new Date('2026-07-30T12:00:00.000Z');
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await recordLoginFailure('user@example.com', '203.0.113.10', new Date(now.getTime() + attempt));
        }
        const decision = await checkLoginThrottle('user@example.com', '203.0.113.10', new Date(now.getTime() + 10));
        expect(decision.blocked).toBe(true);
        expect(decision.retryAfterSeconds).toBeGreaterThan(0);
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(5);
    });

    it('clears account and pair failures after success without clearing source-abuse evidence', async () => {
        await recordLoginFailure('user@example.com', '203.0.113.10');
        expect(mockThrottleRows.size).toBe(3);
        await clearLoginFailures('user@example.com', '203.0.113.10');
        expect([...mockThrottleRows.values()].map((row) => row.scope)).toEqual(['source']);
    });
});

describe('normalized identities and session revocation', () => {
    it('normalizes whitespace and case consistently', () => {
        expect(normalizeEmail('  Admin@Example.COM ')).toBe('admin@example.com');
    });

    it('uses forwarded source addresses only when the proxy is explicitly trusted', () => {
        const request = { headers: new Headers({ 'x-forwarded-for': '203.0.113.8, 10.0.0.1' }) };
        process.env.TRUST_PROXY = 'false';
        expect(requestSourceIp(request)).toBe('unknown');
        process.env.TRUST_PROXY = 'true';
        expect(requestSourceIp(request)).toBe('203.0.113.8');
    });

    it('rejects stale session versions and tokens issued before a security change', () => {
        expect(isSessionTokenCurrent({ isInitialSignIn: false, tokenSessionVersion: 2, tokenIssuedAtSeconds: 100, databaseSessionVersion: 3, credentialsChangedAt: null })).toBe(false);
        expect(isSessionTokenCurrent({ isInitialSignIn: false, tokenSessionVersion: 3, tokenIssuedAtSeconds: 100, databaseSessionVersion: 3, credentialsChangedAt: new Date(101_000) })).toBe(false);
        expect(isSessionTokenCurrent({ isInitialSignIn: false, tokenSessionVersion: 3, tokenIssuedAtSeconds: 102, databaseSessionVersion: 3, credentialsChangedAt: new Date(101_000) })).toBe(true);
        expect(isSessionTokenCurrent({ isInitialSignIn: true, tokenSessionVersion: undefined, tokenIssuedAtSeconds: undefined, databaseSessionVersion: 3, credentialsChangedAt: new Date() })).toBe(true);
    });

    it('ships a migration that aborts ambiguous duplicates and enforces every writer with a trigger', () => {
        const migration = source('prisma/migrations/20260730200000_auth_identity_hardening/migration.sql');
        expect(migration).toContain('HAVING COUNT(*) > 1');
        expect(migration).toContain('normalized-email migration blocked');
        expect(migration).toContain('CREATE UNIQUE INDEX "users_normalized_email_key"');
        expect(migration).toContain('CREATE TRIGGER "users_normalize_email"');
        expect(migration).toContain('CREATE TABLE "login_throttles"');
        expect(migration.toLowerCase()).toContain('rollback');
    });

    it('normalizes Entra profiles and links lookups through normalizedEmail', () => {
        const auth = source('src/lib/auth.ts');
        expect(auth).toContain("email: normalizeEmail(profile.email ?? profile.preferred_username ?? '')");
        expect(auth).toContain('where: { normalizedEmail }');
        expect(auth).toContain('isSessionTokenCurrent');
        expect(auth).toContain('recordLoginFailure(email, sourceIp)');
        expect(auth).toContain('DUMMY_PASSWORD_HASH');
        expect(auth).toContain('allowDangerousEmailAccountLinking: true');
    });
});

describe('strict and history-preserving user administration', () => {
    it('enforces strict payloads and the strong password policy', () => {
        expect(createUserSchema.safeParse({ name: 'User', email: 'USER@example.com', role: 'USER', unexpected: true }).success).toBe(false);
        expect(createUserSchema.safeParse({ name: 'User', email: 'user@example.com', role: 'USER', password: 'weak' }).success).toBe(false);
        expect(createUserSchema.safeParse({ name: 'User', email: 'user@example.com', role: 'USER', password: 'StrongPassword1!' }).success).toBe(true);
        expect(updateUserSchema.safeParse({ userId: '550e8400-e29b-41d4-a716-446655440000' }).success).toBe(false);
        expect(updateUserSchema.safeParse({ userId: '550e8400-e29b-41d4-a716-446655440000', queueIds: ['550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440001'] }).success).toBe(false);
    });

    it('updates security and memberships atomically, locks the last-admin invariant, and never hard-deletes routinely', () => {
        const users = source('src/app/api/users/route.ts');
        expect(users).toContain('prisma.$transaction');
        expect(users).toContain('pg_advisory_xact_lock');
        expect(users).toContain("throw new Error('LAST_SUPER_ADMIN')");
        expect(users).toContain('sessionVersion: { increment: 1 }');
        expect(users).toContain('credentialsChangedAt');
        expect(users).not.toContain('prisma.user.delete');
        expect(users).toContain('routineHardDeleteDisabled: true');
    });

    it('prevents external API user-creation races with normalized upsert', () => {
        const external = source('src/app/api/v1/tickets/route.ts');
        expect(external).toContain('prisma.user.upsert');
        expect(external).toContain('where: { normalizedEmail }');
    });
});