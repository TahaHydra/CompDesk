import { promises as fs } from 'fs';
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
    const merged: Record<string, string> = {};
    for (const envPath of resolveRuntimeEnvFiles(cwd)) {
        const contents = await fs.readFile(envPath, 'utf8').catch(() => '');
        Object.assign(merged, parseManagedValues(contents));
    }
    return merged;
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

    for (const envPath of resolveRuntimeEnvFiles(cwd)) {
        let contents = await fs.readFile(envPath, 'utf8').catch(() => '');
        for (const [key, rawValue] of entries) {
            const value = String(rawValue);
            if (/[\r\n]/.test(value)) throw new ManagedEnvironmentError('Environment setting values cannot contain line breaks.');
            const envKey = MANAGED_ENV_KEYS[key as keyof typeof MANAGED_ENV_KEYS];
            const line = `${envKey}=${JSON.stringify(value)}`;
            const pattern = new RegExp(`^#?\\s*${envKey}=.*$`, 'm');
            contents = pattern.test(contents) ? contents.replace(pattern, line) : `${contents.trimEnd()}\n${line}`;
        }
        await fs.writeFile(envPath, `${contents.trim()}\n`, 'utf8');
    }
    return true;
}
