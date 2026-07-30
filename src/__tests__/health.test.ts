const mockQueryRaw = jest.fn();
const mockFindFirst = jest.fn();

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        user: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
    },
}));

jest.mock('@/lib/attachment-storage', () => ({
    attachmentStorageRoot: () => process.cwd(),
}));

import { GET as live } from '@/app/api/health/live/route';
import { isReady } from '@/lib/health';

describe('health endpoints', () => {
    it('keeps liveness independent from database readiness', async () => {
        const response = await live();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'live' });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('requires every readiness dependency', () => {
        expect(isReady({ database: true, installation: true, migrations: true, privateStorage: true })).toBe(true);
        expect(isReady({ database: true, installation: false, migrations: true, privateStorage: true })).toBe(false);
        expect(isReady({ database: true, installation: true, migrations: false, privateStorage: true })).toBe(false);
        expect(isReady({ database: true, installation: true, migrations: true, privateStorage: false })).toBe(false);
    });
});
