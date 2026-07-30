import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { processWebhookDelivery } from '@/lib/webhooks';
import { requestSourceIp } from '@/lib/request-ip';
import logger from '@/lib/logger';

const actionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('test') }).strict(),
    z.object({ action: z.literal('retry'), deliveryId: z.string().uuid() }).strict(),
]);

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id } = await params;
    const deliveries = await prisma.webhookDelivery.findMany({
        where: { webhookId: id },
        select: {
            id: true, event: true, status: true, attemptCount: true, nextAttemptAt: true,
            lastAttemptAt: true, responseStatus: true, errorStage: true, deliveredAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    return NextResponse.json(deliveries);
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const parsed = actionSchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: 'Invalid delivery action', details: parsed.error.flatten() }, { status: 400 });
    const { id: webhookId } = await params;
    const webhook = await prisma.webhookConfig.findUnique({ where: { id: webhookId } });
    if (!webhook) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    if (!webhook.isActive || webhook.disabledAt) return NextResponse.json({ error: 'Enable the webhook before sending or retrying' }, { status: 409 });

    let deliveryId: string;
    if (parsed.data.action === 'test') {
        deliveryId = randomUUID();
        const timestamp = new Date().toISOString();
        await prisma.webhookDelivery.create({
            data: {
                id: deliveryId,
                webhookId,
                event: 'webhook.test',
                body: JSON.stringify({ id: deliveryId, event: 'webhook.test', data: { test: true }, timestamp }),
            },
        });
    } else {
        deliveryId = parsed.data.deliveryId;
        const reset = await prisma.webhookDelivery.updateMany({
            where: { id: deliveryId, webhookId },
            data: {
                status: 'PENDING', attemptCount: 0, nextAttemptAt: new Date(), lastAttemptAt: null,
                responseStatus: null, errorStage: null, deliveredAt: null,
            },
        });
        if (reset.count === 0) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 });
    }
    void processWebhookDelivery(deliveryId).catch((error) => logger.error('Manual webhook delivery dispatch failed', { webhookId, deliveryId, error: error instanceof Error ? error.message : 'Unknown dispatch error' }));
    void auditLog({
        userId: session.user.id,
        action: parsed.data.action === 'test' ? 'webhook.test_requested' : 'webhook.delivery_retried',
        entity: 'webhook',
        entityId: webhookId,
        metadata: { deliveryId },
        ipAddress: requestSourceIp(req),
    });
    return NextResponse.json({ accepted: true, deliveryId }, { status: 202 });
}
