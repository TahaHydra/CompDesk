import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';

export type ApiClientScope = 'tickets:read' | 'tickets:write';

export interface StoredApiClient {
    id: string;
    name: string;
    keyHash: string;
    scopes: ApiClientScope[];
    allowedQueueIds: string[];
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
}

const API_CLIENTS_SETTING_KEY = 'api_clients';

function hashApiKey(apiKey: string): string {
    return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function extractApiKey(req: NextRequest): string | null {
    const bearer = req.headers.get('authorization');
    if (bearer?.startsWith('Bearer ')) {
        return bearer.slice('Bearer '.length).trim();
    }
    return req.headers.get('x-api-key')?.trim() || null;
}

export async function loadApiClients(): Promise<StoredApiClient[]> {
    const setting = await prisma.appSetting.findUnique({
        where: { key: API_CLIENTS_SETTING_KEY },
    });
    if (!setting?.value) return [];

    try {
        const parsed = JSON.parse(setting.value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

export async function saveApiClients(clients: StoredApiClient[]): Promise<void> {
    await prisma.appSetting.upsert({
        where: { key: API_CLIENTS_SETTING_KEY },
        update: { value: JSON.stringify(clients) },
        create: { key: API_CLIENTS_SETTING_KEY, value: JSON.stringify(clients) },
    });
}

export function createApiClientSecret(): string {
    return `exd_${crypto.randomBytes(24).toString('hex')}`;
}

export async function authenticateApiRequest(
    req: NextRequest,
    requiredScope: ApiClientScope
): Promise<
    | { ok: true; source: 'client'; client: StoredApiClient }
    | { ok: true; source: 'legacy'; client: null }
    | { ok: false }
> {
    const apiKey = extractApiKey(req);
    if (!apiKey) return { ok: false };

    const legacyKey = process.env.API_KEY?.trim();
    if (legacyKey && safeEqual(apiKey, legacyKey)) {
        return { ok: true, source: 'legacy', client: null };
    }

    const keyHash = hashApiKey(apiKey);
    const clients = await loadApiClients();
    const client = clients.find(
        (candidate) =>
            candidate.isActive &&
            candidate.scopes.includes(requiredScope) &&
            safeEqual(candidate.keyHash, keyHash)
    );

    if (!client) return { ok: false };

    client.lastUsedAt = new Date().toISOString();
    client.updatedAt = new Date().toISOString();
    await saveApiClients(clients);

    return { ok: true, source: 'client', client };
}

export function serializeApiClient(client: StoredApiClient) {
    const { keyHash, ...rest } = client;
    return rest;
}

export function buildStoredApiClient(input: {
    name: string;
    scopes: ApiClientScope[];
    allowedQueueIds?: string[];
    isActive?: boolean;
}) {
    const rawKey = createApiClientSecret();
    const now = new Date().toISOString();

    const client: StoredApiClient = {
        id: crypto.randomUUID(),
        name: input.name,
        keyHash: hashApiKey(rawKey),
        scopes: input.scopes,
        allowedQueueIds: input.allowedQueueIds ?? [],
        isActive: input.isActive ?? true,
        createdAt: now,
        updatedAt: now,
    };

    return { client, rawKey };
}
