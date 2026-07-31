import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { readManagedEnvironment, updateManagedEnvironment } from '@/lib/managed-env';
import { resolveApplicationRoot, resolveRuntimeEnvFiles } from '@/lib/runtime-paths';

describe('managed standalone environment', () => {
    let repository: string;
    let standalone: string;

    beforeEach(async () => {
        repository = await fs.mkdtemp(path.join(os.tmpdir(), 'compdesk-env-'));
        standalone = path.join(repository, '.next', 'standalone');
        await fs.mkdir(standalone, { recursive: true });
        await fs.writeFile(path.join(repository, '.env'), 'DATABASE_URL="postgres://example"\nAZURE_AD_CLIENT_ID=""\n');
        await fs.writeFile(path.join(standalone, '.env'), 'SHOULD_NOT_CHANGE="true"\n');
    });

    afterEach(async () => {
        await fs.rm(repository, { recursive: true, force: true });
    });

    it('uses one deterministic persistent environment source', () => {
        expect(resolveApplicationRoot(standalone)).toBe(repository);
        expect(resolveRuntimeEnvFiles(standalone)).toEqual([path.join(repository, '.env')]);
    });

    it('writes atomically, keeps a recoverable backup, and does not create conflicting runtime values', async () => {
        const changed = await updateManagedEnvironment({
            azure_ad_client_id: 'client-id',
            azure_ad_client_secret: 'secret-value',
            azure_ad_tenant_id: 'tenant-id',
        }, standalone);

        expect(changed).toBe(true);
        const envPath = path.join(repository, '.env');
        const contents = await fs.readFile(envPath, 'utf8');
        expect(contents).toContain('AZURE_AD_CLIENT_ID="client-id"');
        expect(contents).toContain('AZURE_AD_CLIENT_SECRET="secret-value"');
        expect(contents).toContain('AZURE_AD_TENANT_ID="tenant-id"');
        await expect(fs.readFile(`${envPath}.bak`, 'utf8')).resolves.toContain('DATABASE_URL="postgres://example"');
        await expect(fs.readFile(path.join(standalone, '.env'), 'utf8')).resolves.toBe('SHOULD_NOT_CHANGE="true"\n');
        await expect(fs.stat(`${envPath}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readManagedEnvironment(standalone)).resolves.toMatchObject({
            azure_ad_client_id: 'client-id',
            azure_ad_client_secret: 'secret-value',
            azure_ad_tenant_id: 'tenant-id',
        });
    });

    it('recovers managed values from the backup when the primary file is unavailable', async () => {
        const envPath = path.join(repository, '.env');
        await fs.writeFile(`${envPath}.bak`, 'AZURE_AD_CLIENT_ID="backup-client"\n');
        await fs.unlink(envPath);
        await expect(readManagedEnvironment(standalone)).resolves.toEqual({ azure_ad_client_id: 'backup-client' });
    });

    it('rejects line injection in environment values', async () => {
        await expect(updateManagedEnvironment({ azure_ad_client_id: 'client\nINJECTED=true' }, standalone))
            .rejects.toThrow('cannot contain line breaks');
    });
});