import { EventEmitter } from 'node:events';
import https from 'node:https';
import { createHmac } from 'node:crypto';

const mockBody = JSON.stringify({ id: 'delivery', event: 'ticket.created', timestamp: '2026-01-01T00:00:00.000Z', data: { key: 'TEST-1' } });
const mockPrisma = {
    webhookDelivery: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: 'delivery', event: 'ticket.created', body: mockBody, webhookId: 'hook', webhook: { id: 'hook', url: 'https://hooks.example.test', secret: 'test-secret', isActive: true, disabledAt: null } }),
        update: jest.fn().mockResolvedValue({}),
    },
    webhookConfig: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn((queries) => Promise.all(queries)),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { warn: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/settings-secret', () => ({ isEncryptedSettingSecret: () => true, decryptSettingSecret: () => 'test-secret', SettingsSecretError: class extends Error {} }));
jest.mock('@/lib/webhook-network', () => ({
    resolveWebhookDestination: async () => ({ url: new URL('https://hooks.example.test'), address: '8.8.8.8', family: 4 }),
    WebhookDestinationError: class extends Error {},
}));

import { processWebhookDelivery } from '@/lib/webhooks';

test('a late webhook retry signs a fresh delivery timestamp and preserves the stored event bytes and identity', async () => {
    const now = new Date('2026-09-21T01:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    let sentHeaders: Record<string, string> = {};
    let sentBody = '';
    jest.spyOn(https, 'request').mockImplementation(((_url: unknown, options: { headers: Record<string, string> }, onResponse: (response: unknown) => void) => {
        sentHeaders = options.headers;
        const request = new EventEmitter();
        Object.assign(request, {
            destroy: jest.fn(),
            end(body: string) {
                sentBody = body;
                const response = Object.assign(new EventEmitter(), { statusCode: 200, resume: jest.fn() });
                onResponse(response);
                response.emit('end');
            },
        });
        return request;
    }) as typeof https.request);
    try {
        expect(await processWebhookDelivery('delivery')).toBe(true);
        expect(sentHeaders['X-CompDesk-Webhook-Timestamp']).toBe(now.toISOString());
        expect(sentHeaders['X-CompDesk-Webhook-Id']).toBe('delivery');
        expect(sentBody).toBe(mockBody);
        expect(sentHeaders['X-CompDesk-Webhook-Signature']).toBe(`v1=${createHmac('sha256', 'test-secret').update(`${now.toISOString()}.${mockBody}`).digest('hex')}`);
    } finally {
        jest.restoreAllMocks();
        jest.useRealTimers();
    }
});
