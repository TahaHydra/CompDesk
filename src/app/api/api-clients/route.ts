import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { buildStoredApiClient, loadApiClients, saveApiClients, serializeApiClient, type ApiClientScope } from '@/lib/api-clients';

const VALID_SCOPES: ApiClientScope[] = ['tickets:read', 'tickets:write'];

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const clients = await loadApiClients();
        return NextResponse.json(clients.map(serializeApiClient));
    } catch (error) {
        logger.error('Failed to load API clients', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { name, scopes, allowedQueueIds, isActive } = await req.json();
        if (!name || !Array.isArray(scopes) || scopes.length === 0) {
            return NextResponse.json({ error: 'name and scopes are required' }, { status: 400 });
        }

        const normalizedScopes = scopes.filter((scope: ApiClientScope) => VALID_SCOPES.includes(scope));
        if (normalizedScopes.length === 0) {
            return NextResponse.json({ error: 'At least one valid scope is required' }, { status: 400 });
        }

        const clients = await loadApiClients();
        const { client, rawKey } = buildStoredApiClient({
            name: String(name).trim(),
            scopes: normalizedScopes,
            allowedQueueIds: Array.isArray(allowedQueueIds) ? allowedQueueIds : [],
            isActive: Boolean(isActive ?? true),
        });
        clients.push(client);
        await saveApiClients(clients);

        auditLog({
            userId: session.user.id,
            action: 'api_client.created',
            entity: 'apiClient',
            entityId: client.id,
            metadata: { name: client.name, scopes: client.scopes, allowedQueueIds: client.allowedQueueIds },
        });

        return NextResponse.json({
            client: serializeApiClient(client),
            apiKey: rawKey,
        }, { status: 201 });
    } catch (error) {
        logger.error('Failed to create API client', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { id, name, scopes, allowedQueueIds, isActive, rotateKey } = await req.json();
        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const clients = await loadApiClients();
        const client = clients.find((candidate) => candidate.id === id);
        if (!client) {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }

        let rotatedKey: string | undefined;
        if (name !== undefined) client.name = String(name).trim();
        if (Array.isArray(scopes)) {
            client.scopes = scopes.filter((scope: ApiClientScope) => VALID_SCOPES.includes(scope));
        }
        if (Array.isArray(allowedQueueIds)) client.allowedQueueIds = allowedQueueIds;
        if (isActive !== undefined) client.isActive = Boolean(isActive);
        if (rotateKey) {
            const replacement = buildStoredApiClient({
                name: client.name,
                scopes: client.scopes,
                allowedQueueIds: client.allowedQueueIds,
                isActive: client.isActive,
            });
            client.keyHash = replacement.client.keyHash;
            rotatedKey = replacement.rawKey;
        }
        client.updatedAt = new Date().toISOString();

        await saveApiClients(clients);

        auditLog({
            userId: session.user.id,
            action: rotateKey ? 'api_client.rotated' : 'api_client.updated',
            entity: 'apiClient',
            entityId: client.id,
            metadata: { name: client.name, scopes: client.scopes, allowedQueueIds: client.allowedQueueIds, isActive: client.isActive },
        });

        return NextResponse.json({
            client: serializeApiClient(client),
            ...(rotatedKey ? { apiKey: rotatedKey } : {}),
        });
    } catch (error) {
        logger.error('Failed to update API client', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const id = new URL(req.url).searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'id is required' }, { status: 400 });
        }

        const clients = await loadApiClients();
        const nextClients = clients.filter((client) => client.id !== id);
        if (nextClients.length === clients.length) {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }

        await saveApiClients(nextClients);
        auditLog({
            userId: session.user.id,
            action: 'api_client.deleted',
            entity: 'apiClient',
            entityId: id,
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete API client', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
