import crypto from 'node:crypto';
import type { ApiClient } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { consumeDatabaseRateLimit } from '@/lib/database-rate-limit';
import { requestSourceIp } from '@/lib/request-ip';
import { auditLog } from '@/lib/audit';

export const apiClientScopeSchema = z.enum(['tickets:read', 'tickets:write']);
export type ApiClientScope = z.infer<typeof apiClientScopeSchema>;

const uniqueScopes = z.array(apiClientScopeSchema).min(1).max(2)
    .transform((scopes) => [...new Set(scopes)]);
const queueIds = z.array(z.string().uuid()).max(100)
    .transform((ids) => [...new Set(ids)]);

export const createApiClientSchema = z.object({
    name: z.string().trim().min(1).max(100),
    scopes: uniqueScopes,
    allowedQueueIds: queueIds.default([]),
    allowAllQueues: z.boolean().default(false),
    isActive: z.boolean().default(true),
}).strict().refine((value) => !value.allowAllQueues || value.allowedQueueIds.length === 0, {
    message: 'Allow all departments cannot be combined with selected departments',
    path: ['allowedQueueIds'],
});

export const updateApiClientSchema = z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    scopes: uniqueScopes.optional(),
    allowedQueueIds: queueIds.optional(),
    allowAllQueues: z.boolean().optional(),
    isActive: z.boolean().optional(),
    rotateKey: z.boolean().optional(),
}).strict().refine(
    (value) => Object.keys(value).some((key) => key !== 'id'),
    { message: 'At least one client change is required' }
).refine(
    (value) => !(value.allowAllQueues === true && value.allowedQueueIds && value.allowedQueueIds.length > 0),
    { message: 'Allow all departments cannot be combined with selected departments', path: ['allowedQueueIds'] }
);

function hashApiKey(apiKey: string): string {
    // CodeQL exception: API keys are 192-bit CSPRNG bearer tokens, not human passwords.
    // SHA-256 is a one-way, deterministic lookup digest so an indexed equality query can
    // authenticate without storing the bearer secret. Offline guessing remains bounded by
    // the token's 192-bit entropy; bcrypt would add cost without improving that bound.
    // codeql[js/insufficient-password-hash]
    const lookupDigest = crypto.createHash('sha256').update(apiKey).digest('hex');
    return lookupDigest;
}

function extractApiKey(req: NextRequest): string | null {
    const bearer = req.headers.get('authorization');
    if (bearer?.startsWith('Bearer ')) return bearer.slice('Bearer '.length).trim();
    return req.headers.get('x-api-key')?.trim() || null;
}

export function createApiClientSecret(): string {
    return `cdk_${crypto.randomBytes(24).toString('hex')}`;
}

export function apiClientSecretData(rawKey = createApiClientSecret()) {
    return { rawKey, keyHash: hashApiKey(rawKey) };
}

export type ApiAuthenticationResult =
    | { ok: true; client: ApiClient }
    | { ok: false; rateLimited: boolean; retryAfterSeconds?: number };

async function failedAuthentication(req: NextRequest, keyFingerprint: string): Promise<ApiAuthenticationResult> {
    const limit = await consumeDatabaseRateLimit(
        'external-api-auth-failure',
        `${requestSourceIp(req)}:${keyFingerprint}`,
        20,
        10 * 60 * 1000
    );
    return { ok: false, rateLimited: !limit.allowed, retryAfterSeconds: limit.retryAfterSeconds };
}

export async function authenticateApiRequest(
    req: NextRequest,
    requiredScope: ApiClientScope
): Promise<ApiAuthenticationResult> {
    const apiKey = extractApiKey(req);
    if (!apiKey) return failedAuthentication(req, 'missing');
    const keyHash = hashApiKey(apiKey);
    const client = await prisma.apiClient.findUnique({ where: { keyHash } });
    if (!client?.isActive || !client.scopes.includes(requiredScope)) {
        return failedAuthentication(req, keyHash.slice(0, 16));
    }

    const staleBefore = new Date(Date.now() - 5 * 60 * 1000);
    if (!client.lastUsedAt || client.lastUsedAt < staleBefore) {
        const updated = await prisma.apiClient.updateMany({
            where: { id: client.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }] },
            data: { lastUsedAt: new Date() },
        });
        if (updated.count > 0) client.lastUsedAt = new Date();
    }
    return { ok: true, client };
}

export async function auditExternalApiRequest(input: {
    req: NextRequest;
    client?: ApiClient;
    scope: ApiClientScope;
    queueId?: string | null;
    result: string;
    target?: string;
}) {
    await auditLog({
        action: 'external_api.request',
        entity: 'apiClient',
        entityId: input.client?.id,
        metadata: {
            apiClientId: input.client?.id ?? null,
            apiClientName: input.client?.name ?? null,
            scope: input.scope,
            targetDepartment: input.queueId ?? null,
            target: input.target ?? null,
            result: input.result,
        },
        ipAddress: requestSourceIp(input.req),
        userAgent: input.req.headers.get('user-agent') || undefined,
    });
}

export function apiClientCanAccessQueue(client: ApiClient, queueId: string): boolean {
    return client.allowAllQueues || client.allowedQueueIds.includes(queueId);
}

export function serializeApiClient(client: ApiClient) {
    return {
        id: client.id,
        name: client.name,
        scopes: client.scopes.filter((scope): scope is ApiClientScope => apiClientScopeSchema.safeParse(scope).success),
        allowedQueueIds: client.allowedQueueIds,
        allowAllQueues: client.allowAllQueues,
        isActive: client.isActive,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
        lastUsedAt: client.lastUsedAt?.toISOString(),
    };
}
