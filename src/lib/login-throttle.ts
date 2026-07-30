import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export type LoginThrottleScope = 'account' | 'source' | 'account_source';

const SCOPE_LIMITS: Record<LoginThrottleScope, number> = {
    account: 8,
    source: 20,
    account_source: 5,
};
const BASE_LOCKOUT_MS = 15 * 60_000;
const MAX_LOCKOUT_MS = 24 * 60 * 60_000;
const RECORD_TTL_MS = 24 * 60 * 60_000;

export interface LoginThrottleDecision {
    blocked: boolean;
    retryAfterSeconds: number;
    delayMs: number;
}

function throttleSecret(): string {
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error('AUTH_SECRET is required for distributed login throttling');
    return secret;
}

function keyHash(scope: LoginThrottleScope, value: string): string {
    return crypto.createHmac('sha256', throttleSecret()).update(`${scope}:${value}`).digest('hex');
}

function descriptors(normalizedEmail: string, sourceIp: string) {
    const source = sourceIp.trim().slice(0, 128) || 'unknown';
    const entries = source === 'unknown'
        ? [{ scope: 'account' as const, value: normalizedEmail }]
        : [
            { scope: 'account' as const, value: normalizedEmail },
            { scope: 'source' as const, value: source },
            { scope: 'account_source' as const, value: `${normalizedEmail}:${source}` },
        ];
    return entries.map((entry) => ({ ...entry, keyHash: keyHash(entry.scope, entry.value) }));
}

export function calculateLoginThrottle(
    scope: LoginThrottleScope,
    failureCount: number,
    now: Date = new Date()
): { delayMs: number; blockedUntil: Date | null } {
    const limit = SCOPE_LIMITS[scope];
    const delayMs = Math.min(2_000, Math.max(0, failureCount) * 200);
    if (failureCount < limit) return { delayMs, blockedUntil: null };
    const lockoutMultiplier = 2 ** Math.min(6, Math.floor((failureCount - limit) / limit));
    return {
        delayMs,
        blockedUntil: new Date(now.getTime() + Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * lockoutMultiplier)),
    };
}

export async function checkLoginThrottle(
    normalizedEmail: string,
    sourceIp: string,
    now: Date = new Date()
): Promise<LoginThrottleDecision> {
    const keys = descriptors(normalizedEmail, sourceIp).map((entry) => entry.keyHash);
    await prisma.loginThrottle.deleteMany({ where: { expiresAt: { lt: now } } });
    const records = await prisma.loginThrottle.findMany({
        where: { keyHash: { in: keys }, blockedUntil: { gt: now } },
        select: { blockedUntil: true, failureCount: true },
    });
    const blockedUntil = records.reduce<Date | null>((latest, record) => {
        if (!record.blockedUntil) return latest;
        return !latest || record.blockedUntil > latest ? record.blockedUntil : latest;
    }, null);
    return {
        blocked: Boolean(blockedUntil),
        retryAfterSeconds: blockedUntil ? Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000)) : 0,
        delayMs: records.reduce((maximum, record) => Math.max(maximum, Math.min(2_000, record.failureCount * 200)), 0),
    };
}

export async function recordLoginFailure(
    normalizedEmail: string,
    sourceIp: string,
    now: Date = new Date()
): Promise<LoginThrottleDecision> {
    const outcomes = await prisma.$transaction(async (tx) => {
        const results: Array<{ delayMs: number; blockedUntil: Date | null }> = [];
        for (const descriptor of descriptors(normalizedEmail, sourceIp)) {
            const row = await tx.loginThrottle.upsert({
                where: { keyHash: descriptor.keyHash },
                create: {
                    keyHash: descriptor.keyHash,
                    scope: descriptor.scope,
                    failureCount: 1,
                    expiresAt: new Date(now.getTime() + RECORD_TTL_MS),
                },
                update: {
                    failureCount: { increment: 1 },
                    expiresAt: new Date(now.getTime() + RECORD_TTL_MS),
                },
                select: { id: true, failureCount: true, blockedUntil: true },
            });
            const calculated = calculateLoginThrottle(descriptor.scope, row.failureCount, now);
            const blockedUntil = row.blockedUntil && (!calculated.blockedUntil || row.blockedUntil > calculated.blockedUntil)
                ? row.blockedUntil
                : calculated.blockedUntil;
            if (blockedUntil && (!row.blockedUntil || blockedUntil > row.blockedUntil)) {
                await tx.loginThrottle.update({
                    where: { id: row.id },
                    data: { blockedUntil, expiresAt: new Date(blockedUntil.getTime() + RECORD_TTL_MS) },
                });
            }
            results.push({ delayMs: calculated.delayMs, blockedUntil });
        }
        return results;
    });
    const blockedUntil = outcomes.reduce<Date | null>((latest, outcome) => {
        if (!outcome.blockedUntil) return latest;
        return !latest || outcome.blockedUntil > latest ? outcome.blockedUntil : latest;
    }, null);
    return {
        blocked: Boolean(blockedUntil),
        retryAfterSeconds: blockedUntil ? Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000)) : 0,
        delayMs: outcomes.reduce((maximum, outcome) => Math.max(maximum, outcome.delayMs), 0),
    };
}

export async function clearLoginFailures(normalizedEmail: string, sourceIp: string): Promise<void> {
    const clearable = descriptors(normalizedEmail, sourceIp)
        .filter((entry) => entry.scope !== 'source')
        .map((entry) => entry.keyHash);
    await prisma.loginThrottle.deleteMany({ where: { keyHash: { in: clearable } } });
}

export async function applyLoginFailureDelay(delayMs: number): Promise<void> {
    if (delayMs <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, 2_000)));
}