import { createHmac, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';

function rateLimitKey(scope: string, subject: string): string {
    const secret = process.env.AUTH_SECRET || 'compdesk-development-rate-limit-key';
    return createHmac('sha256', secret).update(`${scope}:${subject}`).digest('hex');
}

export async function consumeDatabaseRateLimit(
    scope: string,
    subject: string,
    limit: number,
    windowMs: number,
    now = new Date()
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const keyHash = rateLimitKey(scope, subject);
    const expiresAt = new Date(now.getTime() + windowMs);
    const rows = await prisma.$queryRaw<Array<{ failure_count: number; expires_at: Date }>>`
        INSERT INTO "login_throttles" (
            "id", "key_hash", "scope", "failure_count", "blocked_until", "expires_at", "created_at", "updated_at"
        ) VALUES (
            ${randomUUID()}, ${keyHash}, ${`rate:${scope}`}, 1, NULL, ${expiresAt}, ${now}, ${now}
        )
        ON CONFLICT ("key_hash") DO UPDATE SET
            "scope" = EXCLUDED."scope",
            "failure_count" = CASE
                WHEN "login_throttles"."expires_at" <= ${now} THEN 1
                ELSE "login_throttles"."failure_count" + 1
            END,
            "blocked_until" = NULL,
            "expires_at" = CASE
                WHEN "login_throttles"."expires_at" <= ${now} THEN ${expiresAt}
                ELSE "login_throttles"."expires_at"
            END,
            "updated_at" = ${now}
        RETURNING "failure_count", "expires_at"
    `;
    const row = rows[0];
    const count = row?.failure_count ?? limit + 1;
    return {
        allowed: count <= limit,
        retryAfterSeconds: Math.max(1, Math.ceil(((row?.expires_at ?? expiresAt).getTime() - now.getTime()) / 1000)),
    };
}
