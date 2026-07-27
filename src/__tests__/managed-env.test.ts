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
        await fs.writeFile(path.join(standalone, '.env'), 'DATABASE_URL="postgres://example"\n');
    });

    afterEach(async () => {
        await fs.rm(repository, { recursive: true, force: true });
    });

    it('resolves the repository as the persistent application root', () => {
        expect(resolveApplicationRoot(standalone)).toBe(repository);
        expect(resolveRuntimeEnvFiles(standalone)).toEqual([
            path.join(repository, '.env'),
            path.join(standalone, '.env'),
        ]);
    });

    it('writes Entra values to persistent and active standalone files', async () => {
        const changed = await updateManagedEnvironment({
            azure_ad_client_id: 'client-id',
            azure_ad_client_secret: 'secret-value',
            azure_ad_tenant_id: 'tenant-id',
        }, standalone);

        expect(changed).toBe(true);
        for (const envPath of resolveRuntimeEnvFiles(standalone)) {
            const contents = await fs.readFile(envPath, 'utf8');
            expect(contents).toContain('AZURE_AD_CLIENT_ID="client-id"');
            expect(contents).toContain('AZURE_AD_CLIENT_SECRET="secret-value"');
            expect(contents).toContain('AZURE_AD_TENANT_ID="tenant-id"');
        }
        await expect(readManagedEnvironment(standalone)).resolves.toMatchObject({
            azure_ad_client_id: 'client-id',
            azure_ad_client_secret: 'secret-value',
            azure_ad_tenant_id: 'tenant-id',
        });
    });

    it('rejects line injection in environment values', async () => {
        await expect(updateManagedEnvironment({ azure_ad_client_id: 'client\nINJECTED=true' }, standalone))
            .rejects.toThrow('cannot contain line breaks');
    });
});
