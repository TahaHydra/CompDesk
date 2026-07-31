import { promises as fs } from 'fs';
import path from 'path';
import { isLocalStandaloneRuntime, resolveRuntimeEnvFiles } from '@/lib/runtime-paths';

export class ManagedEnvironmentError extends Error {}

const MANAGED_ENV_KEYS = {
    azure_ad_client_id: 'AZURE_AD_CLIENT_ID',
    azure_ad_client_secret: 'AZURE_AD_CLIENT_SECRET',
    azure_ad_tenant_id: 'AZURE_AD_TENANT_ID',
} as const;

function decodeEnvValue(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try { return JSON.parse(trimmed) as string; } catch { return trimmed.slice(1, -1); }
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
    return trimmed;
}

function parseManagedValues(contents: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of contents.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!match) continue;
        const settingKey = Object.entries(MANAGED_ENV_KEYS).find(([, envKey]) => envKey === match[1])?.[0];
        if (settingKey) result[settingKey] = decodeEnvValue(match[2]);
    }
    return result;
}

export async function readManagedEnvironment(cwd = process.cwd()): Promise<Record<string, string>> {
    const [envPath] = resolveRuntimeEnvFiles(cwd);
    const backupPath = `${envPath}.bak`;
    const contents = await fs.readFile(envPath, 'utf8').catch(async () => fs.readFile(backupPath, 'utf8').catch(() => ''));
    return parseManagedValues(contents);
}

async function acquireLock(lockPath: string): Promise<Awaited<ReturnType<typeof fs.open>>> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
            return await fs.open(lockPath, 'wx', 0o600);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            const lockAgeMs = Date.now() - (await fs.stat(lockPath).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs;
            if (lockAgeMs > 30_000) {
                await fs.unlink(lockPath).catch(() => undefined);
                continue;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
    }
    throw new ManagedEnvironmentError('The settings file is being updated by another process. Retry in a moment.');
}

async function writeAtomically(envPath: string, contents: string): Promise<void> {
    const directory = path.dirname(envPath);
    const temporaryPath = path.join(directory, `.${path.basename(envPath)}.${process.pid}.${Date.now()}.tmp`);
    const backupPath = `${envPath}.bak`;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.chmod(temporaryPath, 0o600).catch(() => undefined);
    try {
        await fs.copyFile(envPath, backupPath);
        await fs.chmod(backupPath, 0o600).catch(() => undefined);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
        await fs.rename(temporaryPath, envPath);
        await fs.chmod(envPath, 0o600).catch(() => undefined);
    } catch (error) {
        await fs.unlink(temporaryPath).catch(() => undefined);
        throw error;
    }
}

export function canEditManagedEnvironment(cwd = process.cwd()): boolean {
    return process.env.NODE_ENV !== 'production' || isLocalStandaloneRuntime(cwd);
}

export async function updateManagedEnvironment(
    updates: Record<string, unknown>,
    cwd = process.cwd()
): Promise<boolean> {
    const entries = Object.entries(updates).filter(([key, value]) =>
        key in MANAGED_ENV_KEYS && String(value).trim() !== ''
    );
    if (entries.length === 0) return false;
    if (!canEditManagedEnvironment(cwd)) {
        throw new ManagedEnvironmentError('Entra settings are managed by the deployment environment. Update the container environment and restart the application.');
    }

    const [envPath] = resolveRuntimeEnvFiles(cwd);
    const lockPath = `${envPath}.lock`;
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    const lock = await acquireLock(lockPath);
    try {
        let contents = await fs.readFile(envPath, 'utf8').catch(() => '');
        for (const [key, rawValue] of entries) {
            const value = String(rawValue);
            if (/[\r\n]/.test(value)) throw new ManagedEnvironmentError('Environment setting values cannot contain line breaks.');
            const envKey = MANAGED_ENV_KEYS[key as keyof typeof MANAGED_ENV_KEYS];
            const line = `${envKey}=${JSON.stringify(value)}`;
            const pattern = new RegExp(`^#?\\s*${envKey}=.*$`, 'm');
            contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}`;
        }
        await writeAtomically(envPath, `${contents.trim()}\n`);
    } finally {
        await lock.close().catch(() => undefined);
        await fs.unlink(lockPath).catch(() => undefined);
    }
    return true;
}