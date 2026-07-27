import { z } from 'zod';

export class SettingsValidationError extends Error {}

const booleanKeys = new Set([
    'smtp_secure',
    'smtp_require_tls',
    'email_on_ticket_created',
    'email_on_ticket_assigned',
    'email_on_ticket_updated',
    'email_on_new_comment',
    'login_local_enabled',
    'feature_attachments_enabled',
    'feature_dashboard_links_enabled',
    'feature_external_api_enabled',
    'feature_webhooks_enabled',
]);

const smtpHostSchema = z.string().trim().min(1, 'SMTP host is required').max(253, 'SMTP host is too long')
    .refine((value) => !/\s|:\/\//.test(value), 'Enter a host name only, without a URL scheme or spaces');
const smtpPortSchema = z.coerce.number().int().min(1).max(65535);
const smtpUserSchema = z.string().trim().min(1, 'SMTP username is required').max(320);
const smtpPasswordSchema = z.string().max(2048);
const mailboxSchema = z.string().email();
const smtpFromSchema = z.string().trim().max(500).refine((value) => {
    if (value === '') return true;
    const bracketed = value.match(/^.*<([^<>]+)>$/);
    return mailboxSchema.safeParse(bracketed ? bracketed[1].trim() : value).success;
}, 'Enter an email address or a sender in the form Name <address@example.com>');
const entraIdentifierSchema = z.string().trim().max(256).refine((value) => !/[\r\n]/.test(value), 'Entra values cannot contain line breaks');
const entraSecretSchema = z.string().max(2048).refine((value) => !/[\r\n]/.test(value), 'Entra values cannot contain line breaks');

export function normalizeSettingValue(key: string, rawValue: unknown): string {
    const value = String(rawValue);
    let parsed: z.SafeParseReturnType<unknown, unknown>;

    if (booleanKeys.has(key)) {
        parsed = z.enum(['true', 'false']).safeParse(value);
    } else if (key === 'smtp_host') {
        parsed = smtpHostSchema.safeParse(value);
    } else if (key === 'smtp_port') {
        const port = smtpPortSchema.safeParse(value);
        if (port.success) return String(port.data);
        parsed = port;
    } else if (key === 'smtp_user') {
        parsed = smtpUserSchema.safeParse(value);
    } else if (key === 'smtp_password') {
        parsed = smtpPasswordSchema.safeParse(value);
    } else if (key === 'smtp_from') {
        parsed = smtpFromSchema.safeParse(value);
    } else if (key === 'azure_ad_client_secret') {
        parsed = entraSecretSchema.safeParse(value);
    } else if (key === 'azure_ad_client_id' || key === 'azure_ad_tenant_id') {
        parsed = entraIdentifierSchema.safeParse(value);
    } else {
        return value;
    }

    if (!parsed.success) {
        throw new SettingsValidationError(parsed.error.issues[0]?.message || `Invalid value for ${key}`);
    }
    return String(parsed.data);
}
export function isValidSmtpFrom(value: string): boolean {
    return Boolean(value.trim()) && smtpFromSchema.safeParse(value).success;
}

export function validateSmtpSecurityCombination(input: { port: number; secure: boolean; requireTLS: boolean }): void {
    if (input.port === 465 && !input.secure) throw new SettingsValidationError('SMTP port 465 requires implicit TLS (Secure must be enabled).');
    if (input.port === 587 && input.secure) throw new SettingsValidationError('SMTP port 587 uses STARTTLS, so Secure must be disabled.');
    if (input.port === 587 && !input.requireTLS) throw new SettingsValidationError('SMTP port 587 must require STARTTLS.');
    if (input.secure && input.requireTLS) throw new SettingsValidationError('Implicit TLS and Require STARTTLS cannot both be enabled.');
}