const mockPrisma = { apiClient: { findUnique: jest.fn().mockResolvedValue(null) } };
const mockBuckets = new Map<string, number>();
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/request-ip', () => ({ requestSourceIp: () => '203.0.113.1' }));
jest.mock('@/lib/database-rate-limit', () => ({
    consumeDatabaseRateLimit: async (scope: string, subject: string, limit: number) => {
        const key = `${scope}:${subject}`;
        const count = (mockBuckets.get(key) ?? 0) + 1;
        mockBuckets.set(key, count);
        return { allowed: count <= limit, retryAfterSeconds: 600 };
    },
}));
import { NextRequest } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-clients';

it('limits failed authentication from a source even when every bearer value is different', async () => {
    mockBuckets.clear();
    let outcome;
    for (let index = 0; index < 21; index += 1) {
        outcome = await authenticateApiRequest(new NextRequest('http://localhost/api/v1/tickets', {
            headers: { authorization: `Bearer invalid-${index}` },
        }), 'tickets:read');
    }
    expect(outcome).toMatchObject({ ok: false, rateLimited: true });
});
