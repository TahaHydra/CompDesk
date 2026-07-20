import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { getFeatureFlag } from '@/lib/feature-flags';

interface WebhookPayload {
    event: string;
    data: Record<string, unknown>;
    timestamp: string;
}

export async function fireWebhook(event: string, data: Record<string, unknown>) {
    try {
        if (!(await getFeatureFlag('feature_webhooks_enabled'))) {
            return;
        }

        const webhooks = await prisma.webhookConfig.findMany({
            where: {
                isActive: true,
                events: { has: event },
            },
        });

        for (const webhook of webhooks) {
            const payload: WebhookPayload = {
                event,
                data,
                timestamp: new Date().toISOString(),
            };

            // Fire and forget - non-blocking
            fetch(webhook.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Webhook-Secret': webhook.secret ?? '',
                    'X-Webhook-Event': event,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
            }).catch((err) => {
                logger.error('Webhook delivery failed', {
                    webhookId: webhook.id,
                    url: webhook.url,
                    event,
                    error: err instanceof Error ? err.message : err,
                });
            });
        }
    } catch (error) {
        logger.error('Failed to process webhooks', {
            event,
            error: error instanceof Error ? error.message : error,
        });
    }
}
