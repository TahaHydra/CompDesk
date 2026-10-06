import { canEditManagedEnvironment, MANAGED_ENV_NAMES, OIDC_SETTING_FIELDS, readManagedEnvironment, updateManagedEnvironment } from '@/lib/managed-env';
import { isOidcRuntimeConfigured, readOidcConfig, type OidcRuntimeConfig, type OidcSlot } from '@/lib/oidc-provider';
import { normalizeSettingValue, SettingsValidationError } from '@/lib/settings-validation';
import { describeCertificate, normalizePem, parseCertificates, parsePrivateKey } from '@/lib/tls-material';

/**
 * SSO credential settings live in the managed runtime environment file (they configure Auth.js at
 * process start). Request semantics for every key: omitted = keep, a value = replace, and `null` =
 * remove (only for optional or secret material). Secrets also treat an empty string as "keep",
 * matching password fields.
 */
export type SettingValue = string | null;
export type OidcPrefix = 'oidc' | 'oidc_next';

export const ENTRA_KEYS = ['azure_ad_client_id', 'azure_ad_client_secret', 'azure_ad_tenant_id'] as const;
export const oidcKeys = (prefix: OidcPrefix) => OIDC_SETTING_FIELDS.map((field) => `${prefix}_${field}`);
export const OIDC_KEYS = [...oidcKeys('oidc'), ...oidcKeys('oidc_next')];
export const SSO_SECRET_KEYS = new Set(['azure_ad_client_secret', ...['oidc', 'oidc_next'].flatMap((prefix) => [`${prefix}_client_secret`, `${prefix}_client_private_key`])]);

const SECRET_FIELDS = new Set(['client_secret', 'client_private_key']);
const PEM_FIELDS = new Set(['client_private_key', 'client_certificate', 'ca_certificate']);
const REMOVABLE_FIELDS = new Set(['client_secret', 'client_private_key', 'client_certificate', 'client_key_id', 'ca_certificate']);

const fieldOf = (key: string) => key.replace(/^oidc(?:_next)?_/, '');
export const prefixOf = (key: string): OidcPrefix => key.startsWith('oidc_next_') ? 'oidc_next' : 'oidc';
const slotOf = (prefix: OidcPrefix): OidcSlot => prefix === 'oidc' ? 'OIDC' : 'OIDC_NEXT';

function managedValue(managedEnv: Record<string, string>, key: string): string {
    return managedEnv[key] || process.env[MANAGED_ENV_NAMES[key]] || '';
}

/** Validates one OIDC value on its own; cross-field validation happens in applyOidcSettings(). */
export function normalizeOidcSetting(key: string, raw: unknown): SettingValue {
    const field = fieldOf(key);
    if (raw === null) {
        if (!REMOVABLE_FIELDS.has(field)) throw new SettingsValidationError(`${key} cannot be removed.`);
        return null;
    }
    if (typeof raw !== 'string') throw new SettingsValidationError(`${key} must be a string, or null to remove it.`);
    if (!raw.trim()) {
        if (SECRET_FIELDS.has(field) || !REMOVABLE_FIELDS.has(field)) return '';
        throw new SettingsValidationError(`Send null to remove ${key}; an empty value is ambiguous.`);
    }
    if (PEM_FIELDS.has(field)) {
        const pem = normalizePem(raw);
        if (field === 'client_private_key') parsePrivateKey(pem, 'OIDC client private key');
        else parseCertificates(pem, field === 'ca_certificate' ? 'OIDC CA certificate' : 'OIDC client certificate');
        return pem;
    }
    return normalizeSettingValue(`oidc_${field}`, raw);
}

/** The configuration a slot would have after applying submitted values, validated exactly as the restarted process will. */
export async function buildOidcCandidate(prefix: OidcPrefix, submitted: Map<string, SettingValue>): Promise<OidcRuntimeConfig> {
    const keys = oidcKeys(prefix);
    const managedEnv = await readManagedEnvironment();
    const effective = Object.fromEntries(keys.map((key) => {
        const value = submitted.get(key);
        return [key, value === null ? '' : value || managedValue(managedEnv, key)];
    }));
    const slot = slotOf(prefix);
    const candidate = readOidcConfig({
        NODE_ENV: process.env.NODE_ENV,
        [`${slot}_CLIENT_PRIVATE_KEY_FILE`]: process.env[`${slot}_CLIENT_PRIVATE_KEY_FILE`],
        [`${slot}_CLIENT_CERTIFICATE_FILE`]: process.env[`${slot}_CLIENT_CERTIFICATE_FILE`],
        [`${slot}_CA_FILE`]: process.env[`${slot}_CA_FILE`],
        ...Object.fromEntries(keys.map((key) => [MANAGED_ENV_NAMES[key], effective[key] || undefined])),
    } as Record<string, string | undefined> as NodeJS.ProcessEnv, slot);
    if (!candidate) throw new SettingsValidationError('Issuer URL and Client ID are required for OpenID Connect sign-in.');
    return candidate;
}

/** Applies submitted values to one OIDC slot; only submitted keys are written. */
export async function applyOidcSettings(prefix: OidcPrefix, submitted: Map<string, SettingValue>): Promise<boolean> {
    await buildOidcCandidate(prefix, submitted);
    const keys = oidcKeys(prefix);
    const writes = Object.fromEntries([...submitted].filter(([key, value]) => keys.includes(key) && value !== ''));
    return updateManagedEnvironment(writes);
}

export async function applyEntraSettings(submitted: Map<string, SettingValue>, legacy: Record<string, string>): Promise<boolean> {
    const managedEnv = await readManagedEnvironment();
    const effective = Object.fromEntries(ENTRA_KEYS.map((key) => [key, submitted.get(key) || managedValue(managedEnv, key) || legacy[key] || '']));
    if (ENTRA_KEYS.some((key) => !effective[key])) throw new SettingsValidationError('Client ID, Client Secret, and Tenant ID are all required for Microsoft sign-in.');
    return updateManagedEnvironment(effective);
}

/** Removes every value of a slot, e.g. the previous provider after a migration is finished. */
export async function clearOidcSlot(prefix: OidcPrefix): Promise<boolean> {
    return updateManagedEnvironment(Object.fromEntries(oidcKeys(prefix).map((key) => [key, null])));
}

export function certificateSummary(pem: string | undefined): string {
    if (!pem) return '';
    try {
        const certificates = parseCertificates(pem);
        const summary = describeCertificate(certificates[0]);
        const more = certificates.length > 1 ? ` (+${certificates.length - 1} more)` : '';
        return `${summary.subject} · expires ${summary.validTo.slice(0, 10)}${summary.expired ? ' (expired)' : ''}${more}`;
    } catch { return 'Invalid certificate'; }
}

/** Saved values of SSO credentials differ from those loaded by the running process. */
function restartPending(managedEnv: Record<string, string>, keys: readonly string[]): boolean {
    if (!canEditManagedEnvironment()) return false;
    return keys.some((key) => (managedEnv[key] ?? '') !== (process.env[MANAGED_ENV_NAMES[key]] ?? ''));
}

/** Read model for the Settings UI. Secrets are reported only as configured/missing. */
export async function ssoSettingsSummary(legacy: Record<string, string>): Promise<Record<string, string>> {
    const managedEnv = await readManagedEnvironment();
    const flag = (value: unknown) => value ? 'true' : 'false';
    const summary: Record<string, string> = {
        sso_callback_base: (process.env.AUTH_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, ''),
        sso_settings_editable: flag(canEditManagedEnvironment()),
        azure_ad_settings_editable: flag(canEditManagedEnvironment()),
        azure_ad_client_id: managedValue(managedEnv, 'azure_ad_client_id') || legacy.azure_ad_client_id || '',
        azure_ad_tenant_id: managedValue(managedEnv, 'azure_ad_tenant_id') || legacy.azure_ad_tenant_id || '',
        azure_ad_client_secret: '',
        azure_ad_client_secret_configured: flag(managedValue(managedEnv, 'azure_ad_client_secret')),
        azure_ad_runtime_configured: flag(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET && process.env.AZURE_AD_TENANT_ID),
        azure_ad_restart_required: flag(restartPending(managedEnv, ENTRA_KEYS)),
    };
    for (const prefix of ['oidc', 'oidc_next'] as const) {
        const value = (field: string) => managedValue(managedEnv, `${prefix}_${field}`);
        const slot = slotOf(prefix);
        Object.assign(summary, {
            [`${prefix}_issuer`]: value('issuer'),
            [`${prefix}_client_id`]: value('client_id'),
            [`${prefix}_client_auth_method`]: value('client_auth_method') || 'client_secret_basic',
            [`${prefix}_client_key_id`]: value('client_key_id'),
            [`${prefix}_client_secret`]: '',
            [`${prefix}_client_secret_configured`]: flag(value('client_secret')),
            [`${prefix}_client_private_key`]: '',
            [`${prefix}_client_private_key_configured`]: flag(value('client_private_key') || process.env[`${slot}_CLIENT_PRIVATE_KEY_FILE`]),
            [`${prefix}_client_certificate`]: value('client_certificate'),
            [`${prefix}_client_certificate_summary`]: certificateSummary(value('client_certificate')),
            [`${prefix}_ca_certificate`]: value('ca_certificate'),
            [`${prefix}_ca_certificate_summary`]: value('ca_certificate') ? certificateSummary(value('ca_certificate')) : process.env[`${slot}_CA_FILE`] ? `Provided by ${slot}_CA_FILE` : '',
            [`${prefix}_runtime_configured`]: flag(isOidcRuntimeConfigured(slot)),
            [`${prefix}_restart_required`]: flag(restartPending(managedEnv, oidcKeys(prefix))),
        });
    }
    return summary;
}

/**
 * Saved credentials for a runtime provider differ from the configuration loaded by this process.
 * Migration decisions must not rely on a verified link to a configuration that a restart replaces.
 */
export async function isRuntimeConfigOutdated(providerId: 'microsoft-entra-id' | 'oidc' | 'oidc-next'): Promise<boolean> {
    const keys = providerId === 'microsoft-entra-id' ? ENTRA_KEYS : oidcKeys(providerId === 'oidc' ? 'oidc' : 'oidc_next');
    return restartPending(await readManagedEnvironment(), keys);
}
