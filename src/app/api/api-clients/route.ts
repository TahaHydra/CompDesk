import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
    apiClientSecretData,
    createApiClientSchema,
    serializeApiClient,
    updateApiClientSchema,
} from '@/lib/api-clients';

async function validateQueueIds(ids: string[]): Promise<boolean> {
    if (ids.length === 0) return true;
    return await prisma.queue.count({ where: { id: { in: ids } } }) === ids.length;
}

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const clients = await prisma.apiClient.findMany({ orderBy: { createdAt: 'asc' } });
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
        const parsed = createApiClientSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'API client validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        if (!(await validateQueueIds(parsed.data.allowedQueueIds))) {
            return NextResponse.json({ error: 'One or more allowed departments do not exist' }, { status: 400 });
        }

        const { rawKey, keyHash } = apiClientSecretData();
        const client = await prisma.apiClient.create({ data: { ...parsed.data, keyHash } });
        await auditLog({
            userId: session.user.id,
            action: 'api_client.created',
            entity: 'apiClient',
            entityId: client.id,
            metadata: { name: client.name, scopes: client.scopes, allowedQueueIds: client.allowedQueueIds, allowAllQueues: client.allowAllQueues },
        });
        return NextResponse.json({ client: serializeApiClient(client), apiKey: rawKey }, { status: 201 });
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
        const parsed = updateApiClientSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'API client validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        if (parsed.data.allowedQueueIds && !(await validateQueueIds(parsed.data.allowedQueueIds))) {
            return NextResponse.json({ error: 'One or more allowed departments do not exist' }, { status: 400 });
        }

        const existing = await prisma.apiClient.findUnique({ where: { id: parsed.data.id } });
        if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        const nextAllowedQueueIds = parsed.data.allowedQueueIds ?? existing.allowedQueueIds;
        const nextAllowAllQueues = parsed.data.allowAllQueues ?? existing.allowAllQueues;
        if (nextAllowAllQueues && nextAllowedQueueIds.length > 0) {
            return NextResponse.json({ error: 'Allow all departments cannot be combined with selected departments' }, { status: 400 });
        }

        const { id, rotateKey, ...changes } = parsed.data;
        const rotated = rotateKey ? apiClientSecretData() : null;
        const client = await prisma.apiClient.update({
            where: { id },
            data: { ...changes, ...(rotated ? { keyHash: rotated.keyHash } : {}) },
        });
        await auditLog({
            userId: session.user.id,
            action: rotateKey ? 'api_client.rotated' : 'api_client.updated',
            entity: 'apiClient',
            entityId: client.id,
            metadata: { name: client.name, scopes: client.scopes, allowedQueueIds: client.allowedQueueIds, allowAllQueues: client.allowAllQueues, isActive: client.isActive },
        });
        return NextResponse.json({
            client: serializeApiClient(client),
            ...(rotated ? { apiKey: rotated.rawKey } : {}),
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
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
            return NextResponse.json({ error: 'A valid id is required' }, { status: 400 });
        }
        await prisma.apiClient.delete({ where: { id } });
        await auditLog({ userId: session.user.id, action: 'api_client.deleted', entity: 'apiClient', entityId: id });
        return NextResponse.json({ success: true });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }
        logger.error('Failed to delete API client', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
