import crypto from 'crypto';

const PREFIX = 'enc:v1:';
export class SettingsSecretError extends Error {}

const DOCUMENTED_PLACEHOLDER = /^(?:your-smtp-password|change-me|replace-with|example-secret)$/i;

export function getEnvironmentSmtpPassword(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const value = env.SMTP_PASS || env.SMTP_PASSWORD;
    if (!value?.trim() || DOCUMENTED_PLACEHOLDER.test(value.trim())) return undefined;
    return value;
}

export function hasIgnoredEnvironmentSmtpPlaceholder(env: NodeJS.ProcessEnv = process.env): boolean {
    const value = env.SMTP_PASS || env.SMTP_PASSWORD;
    return Boolean(value?.trim() && DOCUMENTED_PLACEHOLDER.test(value.trim()));
}

function decodeKey(value: string | undefined): Buffer | null {
    if (!value?.trim()) return null;
    const input = value.trim();
    if (/^[0-9a-f]{64}$/i.test(input)) return Buffer.from(input, 'hex');
    try { const key = Buffer.from(input, 'base64'); return key.length === 32 ? key : null; } catch { return null; }
}

export function hasSettingsEncryptionKey(env: NodeJS.ProcessEnv = process.env): boolean {
    return Boolean(decodeKey(env.APP_SETTINGS_ENCRYPTION_KEY));
}

export function isEncryptedSettingSecret(value: string): boolean { return value.startsWith(PREFIX); }

export function encryptSettingSecret(plaintext: string, env: NodeJS.ProcessEnv = process.env): string {
    const key = decodeKey(env.APP_SETTINGS_ENCRYPTION_KEY);
    if (!key) throw new SettingsSecretError('APP_SETTINGS_ENCRYPTION_KEY must be a base64 or hexadecimal 32-byte key.');
    const nonce = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}${nonce.toString('base64')}:${ciphertext.toString('base64')}:${tag.toString('base64')}`;
}

function decryptWithKey(value: string, key: Buffer): string {
    const parts = value.split(':');
    if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') throw new SettingsSecretError('Unsupported encrypted settings-secret envelope.');
    const nonce = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    const tag = Buffer.from(parts[4], 'base64');
    if (nonce.length !== 12 || tag.length !== 16) throw new SettingsSecretError('Invalid encrypted settings-secret envelope.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function decryptSettingSecret(value: string, env: NodeJS.ProcessEnv = process.env): string {
    if (!isEncryptedSettingSecret(value)) return value;
    const keys = [decodeKey(env.APP_SETTINGS_ENCRYPTION_KEY), decodeKey(env.APP_SETTINGS_ENCRYPTION_KEY_PREVIOUS)].filter((key): key is Buffer => Boolean(key));
    if (!keys.length) throw new SettingsSecretError('No application settings encryption key is available.');
    for (const key of keys) {
        try { return decryptWithKey(value, key); } catch { /* try the previous rotation key */ }
    }
    throw new SettingsSecretError('Encrypted settings secret could not be authenticated.');
}