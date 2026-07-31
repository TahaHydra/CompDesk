import { randomBytes } from 'node:crypto';
import type { WebhookConfig } from '@prisma/client';
import { z } from 'zod';
import { isEncryptedSettingSecret } from '@/lib/settings-secret';

export const webhookEventSchema = z.enum([
    'ticket.created',
    'ticket.resolved',
    'ticket.assignment_added',
    'ticket.assignment_removed',
    'ticket.assignments_replaced',
]);

const events = z.array(webhookEventSchema).min(1).max(10).transform((values) => [...new Set(values)]);

export const createWebhookSchema = z.object({
    name: z.string().trim().min(1).max(100),
    url: z.string().trim().url().max(2048),
    events,
    isActive: z.boolean().default(true),
}).strict();

export const updateWebhookSchema = z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    url: z.string().trim().url().max(2048).optional(),
    events: events.optional(),
    isActive: z.boolean().optional(),
    rotateSecret: z.boolean().optional(),
    encryptExistingSecret: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'id'), {
    message: 'At least one webhook change is required',
}).refine((value) => !(value.rotateSecret && value.encryptExistingSecret), {
    message: 'Rotate and migrate are separate secret actions',
});

export function createWebhookSecret(): string {
    return randomBytes(32).toString('base64url');
}

export function serializeWebhook(config: WebhookConfig) {
    return {
        id: config.id,
        name: config.name,
        url: config.url,
        events: config.events.filter((event) => webhookEventSchema.safeParse(event).success),
        isActive: config.isActive,
        failureCount: config.failureCount,
        disabledAt: config.disabledAt?.toISOString() ?? null,
        hasSecret: Boolean(config.secret),
        secretNeedsEncryption: Boolean(config.secret && !isEncryptedSettingSecret(config.secret)),
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
    };
}
