import crypto from 'crypto';
import type { ApiClient } from '@prisma/client';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

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
    isActive: z.boolean().default(true),
}).strict();

export const updateApiClientSchema = z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    scopes: uniqueScopes.optional(),
    allowedQueueIds: queueIds.optional(),
    isActive: z.boolean().optional(),
    rotateKey: z.boolean().optional(),
}).strict().refine(
    (value) => Object.keys(value).some((key) => key !== 'id'),
    { message: 'At least one client change is required' }
);

function hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function extractApiKey(req: NextRequest): string | null {
    const bearer = req.headers.get('authorization');
    if (bearer?.startsWith('Bearer ')) return bearer.slice('Bearer '.length).trim();
    return req.headers.get('x-api-key')?.trim() || null;
}

export function createApiClientSecret(): string {
    return `exd_${crypto.randomBytes(24).toString('hex')}`;
}

export function apiClientSecretData(rawKey = createApiClientSecret()) {
    return { rawKey, keyHash: hashApiKey(rawKey) };
}

export async function authenticateApiRequest(
    req: NextRequest,
    requiredScope: ApiClientScope
): Promise<{ ok: true; client: ApiClient } | { ok: false }> {
    const apiKey = extractApiKey(req);
    if (!apiKey) return { ok: false };

    const client = await prisma.apiClient.findUnique({
        where: { keyHash: hashApiKey(apiKey) },
    });
    if (!client?.isActive || !client.scopes.includes(requiredScope)) return { ok: false };

    const authenticatedAt = new Date();
    await prisma.apiClient.update({
        where: { id: client.id },
        data: { lastUsedAt: authenticatedAt },
    });
    return { ok: true, client: { ...client, lastUsedAt: authenticatedAt } };
}

export function serializeApiClient(client: ApiClient) {
    return {
        id: client.id,
        name: client.name,
        scopes: client.scopes.filter((scope): scope is ApiClientScope => apiClientScopeSchema.safeParse(scope).success),
        allowedQueueIds: client.allowedQueueIds,
        isActive: client.isActive,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
        lastUsedAt: client.lastUsedAt?.toISOString(),
    };
}
