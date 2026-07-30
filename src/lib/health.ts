import { access, mkdir, readdir } from 'fs/promises';
import path from 'path';
import { constants } from 'fs';
import { prisma } from '@/lib/prisma';
import { attachmentStorageRoot } from '@/lib/attachment-storage';

export interface ReadinessChecks {
    database: boolean;
    installation: boolean;
    migrations: boolean;
    privateStorage: boolean;
}

async function databaseAndInstallationChecks(): Promise<Pick<ReadinessChecks, 'database' | 'installation'>> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        const firstAdministrator = await prisma.user.findFirst({
            where: { role: 'SUPER_ADMIN', isActive: true },
            select: { id: true },
        });
        return { database: true, installation: Boolean(firstAdministrator) };
    } catch {
        return { database: false, installation: false };
    }
}

async function migrationCheck(): Promise<boolean> {
    try {
        const migrationRoot = path.resolve(process.cwd(), 'prisma', 'migrations');
        const expected = (await readdir(migrationRoot, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
            SELECT migration_name
            FROM "_prisma_migrations"
            WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        `;
        const appliedNames = new Set(applied.map((migration) => migration.migration_name));
        return expected.length > 0 && expected.every((migration) => appliedNames.has(migration));
    } catch {
        return false;
    }
}

async function privateStorageCheck(): Promise<boolean> {
    try {
        const root = attachmentStorageRoot();
        await mkdir(root, { recursive: true, mode: 0o700 });
        await access(root, constants.R_OK | constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

export async function readinessChecks(): Promise<ReadinessChecks> {
    const [databaseState, migrations, privateStorage] = await Promise.all([
        databaseAndInstallationChecks(),
        migrationCheck(),
        privateStorageCheck(),
    ]);
    return { ...databaseState, migrations, privateStorage };
}

export function isReady(checks: ReadinessChecks): boolean {
    return Object.values(checks).every(Boolean);
}
