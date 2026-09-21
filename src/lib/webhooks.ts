import { createHmac, randomUUID } from 'node:crypto';
import https from 'node:https';
import net from 'node:net';
import type { WebhookConfig } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { getFeatureFlag } from '@/lib/feature-flags';
import { classifyNetworkError } from '@/lib/network-error';
import { decryptSettingSecret, encryptSettingSecret, isEncryptedSettingSecret, SettingsSecretError } from '@/lib/settings-secret';
import { resolveWebhookDestination, WebhookDestinationError, type ResolvedWebhookDestination } from '@/lib/webhook-network';

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 8;
const DISABLE_AFTER_FAILURES = 10;
const REPLAY_WINDOW_SECONDS = 300;

interface WebhookPayload {
    id: string;
    event: string;
    data: Record<string, unknown>;
    timestamp: string;
}

interface DeliveryResult {
    ok: boolean;
    responseStatus: number | null;
    errorStage: string | null;
}

export function signWebhookPayload(secret: string, timestamp: string, rawBody: string): string {
    return `v1=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

async function resolveSecret(webhook: WebhookConfig): Promise<string> {
    if (!webhook.secret) throw new Error('Webhook signing secret is not configured');
    if (isEncryptedSettingSecret(webhook.secret)) return decryptSettingSecret(webhook.secret);
    const encrypted = encryptSettingSecret(webhook.secret);
    await prisma.webhookConfig.updateMany({
        where: { id: webhook.id, secret: webhook.secret },
        data: { secret: encrypted },
    });
    return webhook.secret;
}

async function postPinned(
    destination: ResolvedWebhookDestination,
    body: string,
    headers: Record<string, string>
): Promise<{ status: number }> {
    return new Promise((resolve, reject) => {
        const request = https.request(destination.url, {
            method: 'POST',
            headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
            rejectUnauthorized: true,
            servername: net.isIP(destination.url.hostname.replace(/^\[|\]$/g, '')) ? undefined : destination.url.hostname,
            lookup: (_hostname, _options, callback) => callback(null, destination.address, destination.family),
            timeout: DELIVERY_TIMEOUT_MS,
        }, (response) => {
            response.resume();
            response.on('end', () => {
                clearTimeout(deadline);
                resolve({ status: response.statusCode ?? 0 });
            });
        });
        const timeoutError = () => Object.assign(new Error('Webhook request timed out'), { code: 'ETIMEDOUT' });
        const deadline = setTimeout(() => request.destroy(timeoutError()), DELIVERY_TIMEOUT_MS);
        request.on('timeout', () => request.destroy(timeoutError()));
        request.on('error', (error) => { clearTimeout(deadline); reject(error); });
        request.end(body);
    });
}

async function deliver(webhook: WebhookConfig, event: string, deliveryId: string, body: string): Promise<DeliveryResult> {
    try {
        const [destination, secret] = await Promise.all([
            resolveWebhookDestination(webhook.url),
            resolveSecret(webhook),
        ]);
        // The body records event time; the signature records this delivery attempt.
        // A delayed retry must still pass the receiver's replay window.
        const timestamp = new Date().toISOString();
        const response = await postPinned(destination, body, {
            'Content-Type': 'application/json',
            'X-CompDesk-Webhook-Id': deliveryId,
            'X-CompDesk-Webhook-Event': event,
            'X-CompDesk-Webhook-Timestamp': timestamp,
            'X-CompDesk-Webhook-Signature': signWebhookPayload(secret, timestamp, body),
            'X-CompDesk-Webhook-Replay-Window': String(REPLAY_WINDOW_SECONDS),
        });
        if (response.status >= 200 && response.status < 300) {
            return { ok: true, responseStatus: response.status, errorStage: null };
        }
        return { ok: false, responseStatus: response.status, errorStage: response.status >= 300 && response.status < 400 ? 'redirect_rejected' : 'http_response' };
    } catch (error) {
        if (error instanceof WebhookDestinationError) {
            return { ok: false, responseStatus: null, errorStage: error.stage };
        }
        if (error instanceof SettingsSecretError) return { ok: false, responseStatus: null, errorStage: 'secret_configuration' };
        if (error instanceof SyntaxError) return { ok: false, responseStatus: null, errorStage: 'payload' };
        const category = classifyNetworkError(error).category;
        return { ok: false, responseStatus: null, errorStage: category };
    }
}

function retryDelayMs(attemptCount: number): number {
    return Math.min(60 * 60 * 1000, 5_000 * (2 ** Math.max(0, attemptCount - 1)));
}

export async function processWebhookDelivery(id: string): Promise<boolean> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + DELIVERY_TIMEOUT_MS + 5_000);
    const claimed = await prisma.webhookDelivery.updateMany({
        where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
        data: { attemptCount: { increment: 1 }, lastAttemptAt: now, nextAttemptAt: leaseUntil },
    });
    if (claimed.count === 0) return false;

    const delivery = await prisma.webhookDelivery.findUnique({
        where: { id },
        include: { webhook: true },
    });
    if (!delivery) return false;
    if (!delivery.webhook.isActive || delivery.webhook.disabledAt) {
        await prisma.webhookDelivery.update({ where: { id }, data: { status: 'FAILED', errorStage: 'webhook_disabled' } });
        return false;
    }

    const result = await deliver(delivery.webhook, delivery.event, delivery.id, delivery.body);
    if (result.ok) {
        await prisma.$transaction([
            prisma.webhookDelivery.update({
                where: { id },
                data: { status: 'DELIVERED', deliveredAt: new Date(), responseStatus: result.responseStatus, errorStage: null },
            }),
            prisma.webhookConfig.update({
                where: { id: delivery.webhookId },
                data: { failureCount: 0 },
            }),
        ]);
        return true;
    }

    const terminal = delivery.attemptCount >= MAX_ATTEMPTS;
    const nextAttemptAt = new Date(Date.now() + retryDelayMs(delivery.attemptCount));
    const [, webhook] = await prisma.$transaction([
        prisma.webhookDelivery.update({
            where: { id },
            data: {
                status: terminal ? 'FAILED' : 'PENDING',
                nextAttemptAt,
                responseStatus: result.responseStatus,
                errorStage: result.errorStage,
            },
        }),
        prisma.webhookConfig.update({
            where: { id: delivery.webhookId },
            data: { failureCount: { increment: 1 } },
        }),
    ]);
    if (webhook.failureCount >= DISABLE_AFTER_FAILURES) {
        await prisma.webhookConfig.update({
            where: { id: webhook.id },
            data: { isActive: false, disabledAt: new Date() },
        });
    }
    logger.warn('Webhook delivery attempt failed', {
        webhookId: delivery.webhookId,
        deliveryId: delivery.id,
        attemptCount: delivery.attemptCount,
        responseStatus: result.responseStatus,
        errorStage: result.errorStage,
        terminal,
    });
    return false;
}

export async function processDueWebhookDeliveries(limit = 25): Promise<number> {
    const due = await prisma.webhookDelivery.findMany({
        where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
        select: { id: true },
        orderBy: { nextAttemptAt: 'asc' },
        take: Math.min(100, Math.max(1, limit)),
    });
    await Promise.all(due.map(({ id }) => processWebhookDelivery(id)));
    return due.length;
}

const workerState = globalThis as typeof globalThis & { __compdeskWebhookWorker?: NodeJS.Timeout };
export function startWebhookDeliveryWorker(): void {
    if (process.env.NODE_ENV === 'test' || workerState.__compdeskWebhookWorker) return;
    const run = () => { void processDueWebhookDeliveries().catch((error) => {
        logger.error('Webhook delivery worker failed', { error: error instanceof Error ? error.message : 'Unknown worker error' });
    }); };
    run();
    const timer = setInterval(run, 15_000);
    timer.unref();
    workerState.__compdeskWebhookWorker = timer;
}

export async function fireWebhook(event: string, data: Record<string, unknown>) {
    try {
        if (!(await getFeatureFlag('feature_webhooks_enabled'))) return;
        const webhooks = await prisma.webhookConfig.findMany({
            where: { isActive: true, disabledAt: null, events: { has: event } },
            select: { id: true },
        });
        for (const webhook of webhooks) {
            const id = randomUUID();
            const payload: WebhookPayload = { id, event, data, timestamp: new Date().toISOString() };
            await prisma.webhookDelivery.create({
                data: { id, webhookId: webhook.id, event, body: JSON.stringify(payload) },
            });
            void processWebhookDelivery(id).catch((error) => {
                logger.error('Webhook delivery dispatch failed', { webhookId: webhook.id, deliveryId: id, error: error instanceof Error ? error.message : 'Unknown dispatch error' });
            });
        }
        if (webhooks.length > 0) startWebhookDeliveryWorker();
    } catch (error) {
        logger.error('Failed to enqueue webhooks', { event, error: error instanceof Error ? error.message : 'Unknown enqueue error' });
    }
}
