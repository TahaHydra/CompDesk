import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { encryptSettingSecret, isEncryptedSettingSecret, SettingsSecretError } from '@/lib/settings-secret';
import { resolveWebhookDestination, WebhookDestinationError } from '@/lib/webhook-network';
import { createWebhookSchema, createWebhookSecret, serializeWebhook, updateWebhookSchema } from '@/lib/webhook-admin';
import { requestSourceIp } from '@/lib/request-ip';

export async function GET() {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const webhooks = await prisma.webhookConfig.findMany({ orderBy: { createdAt: 'asc' } });
    return NextResponse.json(webhooks.map(serializeWebhook));
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = createWebhookSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Webhook validation failed', details: parsed.error.flatten() }, { status: 400 });
        await resolveWebhookDestination(parsed.data.url);
        const signingSecret = createWebhookSecret();
        const webhook = await prisma.webhookConfig.create({
            data: { ...parsed.data, secret: encryptSettingSecret(signingSecret) },
        });
        void auditLog({
            userId: session.user.id,
            action: 'webhook.created',
            entity: 'webhook',
            entityId: webhook.id,
            metadata: { name: webhook.name, events: webhook.events, destinationOrigin: new URL(webhook.url).origin },
            ipAddress: requestSourceIp(req),
        });
        return NextResponse.json({ webhook: serializeWebhook(webhook), signingSecret }, { status: 201 });
    } catch (error) {
        if (error instanceof WebhookDestinationError) return NextResponse.json({ error: error.message, stage: error.stage }, { status: 400 });
        if (error instanceof SettingsSecretError) return NextResponse.json({ error: error.message }, { status: 503 });
        logger.error('Failed to create webhook', { error: error instanceof Error ? error.message : 'Unknown webhook error' });
        return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = updateWebhookSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Webhook validation failed', details: parsed.error.flatten() }, { status: 400 });
        const current = await prisma.webhookConfig.findUnique({ where: { id: parsed.data.id } });
        if (!current) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
        if (parsed.data.url) await resolveWebhookDestination(parsed.data.url);
        const signingSecret = parsed.data.rotateSecret ? createWebhookSecret() : null;
        const migratedSecret = parsed.data.encryptExistingSecret && current.secret && !isEncryptedSettingSecret(current.secret)
            ? encryptSettingSecret(current.secret)
            : null;
        const { id, rotateSecret, encryptExistingSecret, ...changes } = parsed.data;
        const webhook = await prisma.webhookConfig.update({
            where: { id },
            data: {
                ...changes,
                ...(signingSecret ? { secret: encryptSettingSecret(signingSecret) } : migratedSecret ? { secret: migratedSecret } : {}),
                ...(changes.isActive === true ? { disabledAt: null, failureCount: 0 } : {}),
            },
        });
        void auditLog({
            userId: session.user.id,
            action: rotateSecret ? 'webhook.secret_rotated' : encryptExistingSecret ? 'webhook.secret_encrypted' : 'webhook.updated',
            entity: 'webhook',
            entityId: webhook.id,
            metadata: { changedKeys: Object.keys(changes), secretRotated: Boolean(rotateSecret), secretMigrated: Boolean(migratedSecret) },
            ipAddress: requestSourceIp(req),
        });
        return NextResponse.json({ webhook: serializeWebhook(webhook), ...(signingSecret ? { signingSecret } : {}) });
    } catch (error) {
        if (error instanceof WebhookDestinationError) return NextResponse.json({ error: error.message, stage: error.stage }, { status: 400 });
        if (error instanceof SettingsSecretError) return NextResponse.json({ error: error.message }, { status: 503 });
        logger.error('Failed to update webhook', { error: error instanceof Error ? error.message : 'Unknown webhook error' });
        return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const id = new URL(req.url).searchParams.get('id');
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'A valid id is required' }, { status: 400 });
    const updated = await prisma.webhookConfig.updateMany({
        where: { id }, data: { isActive: false, disabledAt: new Date() },
    });
    if (updated.count === 0) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
    void auditLog({ userId: session.user.id, action: 'webhook.disabled', entity: 'webhook', entityId: id, ipAddress: requestSourceIp(req) });
    return NextResponse.json({ success: true, retained: true });
}
