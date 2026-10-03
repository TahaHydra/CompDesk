const mockQueryRaw = jest.fn();
const mockInstallationFindUnique = jest.fn();
import { readdirSync } from 'fs';
import path from 'path';

jest.mock('@/lib/prisma', () => ({
    prisma: {
        $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
        installationRecord: { findUnique: (...args: unknown[]) => mockInstallationFindUnique(...args) },
    },
}));

jest.mock('@/lib/attachment-storage', () => ({
    attachmentStorageRoot: () => process.cwd(),
}));

import { GET as live } from '@/app/api/health/live/route';
import { isReady } from '@/lib/health';
import { readinessChecks } from '@/lib/health';
jest.mock('../../scripts/database-schema.mjs', () => ({
    verifyDatabaseSchema: async () => { throw new Error('temporary_attachments.blob_removed_at is missing'); },
}));

describe('health endpoints', () => {
    it('keeps liveness independent from database readiness', async () => {
        const response = await live();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'live', mode: 'production' });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('requires every readiness dependency', () => {
        expect(isReady({ database: true, installation: true, migrations: true, privateStorage: true })).toBe(true);
        expect(isReady({ database: true, installation: false, migrations: true, privateStorage: true })).toBe(false);
        expect(isReady({ database: true, installation: true, migrations: false, privateStorage: true })).toBe(false);
        expect(isReady({ database: true, installation: true, migrations: true, privateStorage: false })).toBe(false);
    });

    it('does not declare a migrated but incompatible schema ready', async () => {
        mockInstallationFindUnique.mockResolvedValue({ id: 'primary' });
        mockQueryRaw.mockResolvedValue(readdirSync(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true })
            .filter(entry => entry.isDirectory()).map(entry => ({ migration_name: entry.name })));
        const checks = await readinessChecks();
        expect(checks.database).toBe(true);
        expect(checks.migrations).toBe(false);
        expect(isReady(checks)).toBe(false);
    });
});
