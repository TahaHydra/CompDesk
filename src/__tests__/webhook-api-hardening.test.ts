import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ApiClient, WebhookConfig } from '@prisma/client';
import { apiClientCanAccessQueue, createApiClientSchema } from '@/lib/api-clients';
import { createWebhookSchema, serializeWebhook, updateWebhookSchema } from '@/lib/webhook-admin';
import { isPublicIpAddress, resolveWebhookDestination } from '@/lib/webhook-network';
import { signWebhookPayload } from '@/lib/webhooks';

const root = path.resolve(__dirname, '..', '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const uuid = '550e8400-e29b-41d4-a716-446655440000';

function apiClient(overrides: Partial<ApiClient> = {}): ApiClient {
    return {
        id: uuid,
        name: 'Integration',
        keyHash: 'hash',
        scopes: ['tickets:read'],
        allowedQueueIds: [],
        allowAllQueues: false,
        isActive: true,
        lastUsedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...overrides,
    };
}

describe('webhook SSRF and signatures', () => {
    it.each([
        '127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.1.1', '169.254.169.254',
        '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1',
        '::ffff:127.0.0.1', '2001:db8::1',
    ])('rejects non-public address %s', (address) => {
        expect(isPublicIpAddress(address)).toBe(false);
    });

    it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('accepts public address %s', (address) => {
        expect(isPublicIpAddress(address)).toBe(true);
    });

    it('requires HTTPS and rejects credentials, localhost, and mixed public/private DNS answers', async () => {
        await expect(resolveWebhookDestination('http://hooks.example.com/path')).rejects.toMatchObject({ stage: 'url' });
        await expect(resolveWebhookDestination('https://user:pass@hooks.example.com/path')).rejects.toMatchObject({ stage: 'url' });
        await expect(resolveWebhookDestination('https://localhost/path')).rejects.toMatchObject({ stage: 'private_network' });
        const mixedLookup = jest.fn().mockResolvedValue([
            { address: '8.8.8.8', family: 4 },
            { address: '127.0.0.1', family: 4 },
        ]);
        await expect(resolveWebhookDestination('https://hooks.example.com/path', mixedLookup as any))
            .rejects.toMatchObject({ stage: 'private_network' });
    });

    it('pins a validated public DNS answer for delivery', async () => {
        const lookup = jest.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
        const result = await resolveWebhookDestination('https://hooks.example.com/path', lookup as any);
        expect(result).toMatchObject({ address: '8.8.8.8', family: 4 });
        expect(result.url.href).toBe('https://hooks.example.com/path');
    });

    it('signs the timestamp and exact raw body with a versioned HMAC', () => {
        const body = '{"event":"ticket.created"}';
        const timestamp = '2026-07-30T20:00:00.000Z';
        const expected = crypto.createHmac('sha256', 'secret').update(`${timestamp}.${body}`).digest('hex');
        expect(signWebhookPayload('secret', timestamp, body)).toBe(`v1=${expected}`);
    });
});

describe('webhook administration and outbox contracts', () => {
    it('strictly validates supported events and separate secret actions', () => {
        expect(createWebhookSchema.safeParse({ name: 'Build', url: 'https://hooks.example.com', events: ['ticket.created'] }).success).toBe(true);
        expect(createWebhookSchema.safeParse({ name: 'Build', url: 'https://hooks.example.com', events: ['unknown.event'] }).success).toBe(false);
        expect(updateWebhookSchema.safeParse({ id: uuid, rotateSecret: true, encryptExistingSecret: true }).success).toBe(false);
    });

    it('never serializes plaintext or encrypted webhook secrets', () => {
        const config = {
            id: uuid, name: 'Build', url: 'https://hooks.example.com', secret: 'enc:v1:nonce:cipher:tag',
            events: ['ticket.created'], isActive: true, failureCount: 0, disabledAt: null,
            createdAt: new Date(0), updatedAt: new Date(0),
        } as WebhookConfig;
        const serialized = serializeWebhook(config);
        expect(serialized).toMatchObject({ hasSecret: true, secretNeedsEncryption: false });
        expect(JSON.stringify(serialized)).not.toContain(config.secret!);
        expect(serialized).not.toHaveProperty('secret');
    });

    it('uses a durable claimed outbox, bounded retries, redirects off, and encrypted secrets', () => {
        const source = read('src', 'lib', 'webhooks.ts');
        expect(source).toContain('webhookDelivery.create');
        expect(source).toContain("status: 'PENDING'");
        expect(source).toContain('nextAttemptAt: leaseUntil');
        expect(source).toContain('MAX_ATTEMPTS');
        expect(source).toContain("'redirect_rejected'");
        expect(source).toContain('encryptSettingSecret(webhook.secret)');
        expect(source).not.toContain('X-Webhook-Secret');
        expect(source).not.toContain('fetch(webhook.url');
        expect(source).toContain('export function startWebhookDeliveryWorker');
        const instrumentation = read('src', 'instrumentation.ts');
        expect(instrumentation).toContain('startWebhookDeliveryWorker()');
    });

    it('provides Super-Admin management, delivery history, test, and retry routes', () => {
        const admin = read('src', 'app', 'api', 'webhooks', 'route.ts');
        const deliveries = read('src', 'app', 'api', 'webhooks', '[id]', 'deliveries', 'route.ts');
        expect(admin).toContain("role !== 'SUPER_ADMIN'");
        expect(admin).toContain('encryptExistingSecret');
        expect(deliveries).toContain("z.literal('test')");
        expect(deliveries).toContain("z.literal('retry')");
    });
});

describe('external API default-deny and attribution', () => {
    it('uses explicit allow-all and treats an empty department list as no access', () => {
        expect(apiClientCanAccessQueue(apiClient(), uuid)).toBe(false);
        expect(apiClientCanAccessQueue(apiClient({ allowAllQueues: true }), uuid)).toBe(true);
        expect(apiClientCanAccessQueue(apiClient({ allowedQueueIds: [uuid] }), uuid)).toBe(true);
        expect(createApiClientSchema.safeParse({ name: 'Default deny', scopes: ['tickets:read'], allowedQueueIds: [] }).success).toBe(true);
        expect(createApiClientSchema.safeParse({ name: 'Invalid', scopes: ['tickets:read'], allowedQueueIds: [uuid], allowAllQueues: true }).success).toBe(false);
    });

    it('applies default-deny beneath both external routes and audits client identity/result', () => {
        const tickets = read('src', 'app', 'api', 'v1', 'tickets', 'route.ts');
        const notes = read('src', 'app', 'api', 'v1', 'tickets', '[id]', 'notes', 'route.ts');
        const auth = read('src', 'lib', 'api-clients.ts');
        for (const source of [tickets, notes]) {
            expect(source).toContain('apiClientCanAccessQueue');
            expect(source).toContain('auditExternalApiRequest');
            expect(source).toContain('consumeDatabaseRateLimit');
        }
        expect(tickets).toContain('client.allowAllQueues ? {} : { queueId: { in: client.allowedQueueIds } }');
        expect(auth).toContain("action: 'external_api.request'");
        expect(auth).toContain('apiClientName');
        expect(auth).toContain('staleBefore');
        expect(auth).toContain('external-api-auth-failure');
    });

    it('migrates existing clients to default-deny and adds durable webhook history', () => {
        const migration = read('prisma', 'migrations', '20260730230000_webhook_api_hardening', 'migration.sql');
        expect(migration).toContain('"allow_all_queues" BOOLEAN NOT NULL DEFAULT false');
        expect(migration).toContain('CREATE TABLE "webhook_deliveries"');
        expect(migration).toContain('Existing API clients with an empty department list become default-deny');
    });
});
