import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { getBrandingConfig, saveBrandingConfig } from '@/lib/branding';
import { normalizeDashboardLinks, parseDashboardLinks } from '@/lib/dashboard-links';
import logger from '@/lib/logger';
import { assertProposedAuthentication, assessActiveEntraChange, assessActiveIssuerChange, environmentPolicy, getSsoState, isLoginMethodEnabled } from '@/lib/login-policy';
import { MANAGED_ENV_NAMES, ManagedEnvironmentError, readManagedEnvironment } from '@/lib/managed-env';
import { OidcConfigError } from '@/lib/oidc-provider';
import { prisma } from '@/lib/prisma';
import { removeUploadedImage } from '@/lib/uploaded-image';
import { isValidSmtpFrom, normalizeSettingValue, SettingsValidationError, validateSmtpSecurityCombination } from '@/lib/settings-validation';
import { decryptSettingSecret, encryptSettingSecret, getEnvironmentSmtpPassword, hasIgnoredEnvironmentSmtpPlaceholder, hasSettingsEncryptionKey, isEncryptedSettingSecret, SettingsSecretError } from '@/lib/settings-secret';
import { applyEntraSettings, applyOidcSettings, certificateSummary, ENTRA_KEYS, normalizeOidcSetting, OIDC_KEYS, prefixOf, ssoSettingsSummary, type SettingValue } from '@/lib/sso-settings';
import { defaultSsoButtonText, isDefaultSsoButtonText, parseSsoProvider, SSO_OIDC_SLOT_KEY } from '@/lib/sso-presets';
import { assertKeyMatchesCertificate, normalizePem, parseCertificates, parsePrivateKey, TlsMaterialError } from '@/lib/tls-material';
import { AuthenticationPolicyError } from '../../../../scripts/auth-policy.mjs';

const SMTP_PEM_KEYS = new Set(['smtp_ca_certificate', 'smtp_client_certificate', 'smtp_client_key']);
const SSO_LOGIN_KEYS = new Set(['sso_provider', 'login_sso_enabled', 'sso_button_text']);
const ENV_ONLY_KEYS = new Set<string>([...ENTRA_KEYS, ...OIDC_KEYS]);
const DB_SECRET_KEYS = new Set(['smtp_password', 'smtp_client_key']);
const ALLOWED_KEYS = new Set([
    'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from', 'smtp_secure', 'smtp_require_tls',
    ...SMTP_PEM_KEYS,
    'email_on_ticket_created', 'email_on_ticket_assigned', 'email_on_ticket_updated', 'email_on_new_comment',
    ...ENV_ONLY_KEYS, ...SSO_LOGIN_KEYS,
    'dashboard_links', 'login_local_enabled',
    'feature_attachments_enabled', 'feature_dashboard_links_enabled', 'feature_external_api_enabled',
    'feature_webhooks_enabled', 'updates_automatic',
]);
// Stored outside this route's GET read model; the SSO tab reads them from the summary instead.
const DB_READ_KEYS = [...ALLOWED_KEYS].filter((key) => !ENV_ONLY_KEYS.has(key)).concat(SSO_OIDC_SLOT_KEY, 'sso_migration_target', 'sso_migration_phase');

function mergeSettingSources(dbSettings: Record<string, string>, ssoSummary: Record<string, string>, ssoButtonText: string): Record<string, string> {
    const environmentPassword = getEnvironmentSmtpPassword();
    const passwordSource = environmentPassword ? 'environment' : dbSettings.smtp_password ? 'database' : 'missing';
    return {
        ...dbSettings,
        ...ssoSummary,
        mail_graph_secret: '',
        sso_provider: parseSsoProvider(dbSettings.sso_provider),
        // Mirrors isLoginMethodEnabled(): database value, then LOGIN_SSO_ENABLED, then disabled.
        login_sso_enabled: dbSettings.login_sso_enabled ?? String(environmentPolicy('login_sso_enabled', process.env) ?? false),
        sso_button_text: ssoButtonText,
        smtp_host: dbSettings.smtp_host || process.env.SMTP_HOST || '',
        smtp_port: dbSettings.smtp_port || process.env.SMTP_PORT || '587',
        smtp_user: dbSettings.smtp_user || process.env.SMTP_USER || '',
        smtp_from: dbSettings.smtp_from || process.env.SMTP_FROM || '',
        smtp_secure: dbSettings.smtp_secure || process.env.SMTP_SECURE || 'false',
        smtp_password: '',
        smtp_password_configured: dbSettings.smtp_password || environmentPassword ? 'true' : 'false',
        smtp_password_source: passwordSource,
        smtp_environment_placeholder_ignored: hasIgnoredEnvironmentSmtpPlaceholder() ? 'true' : 'false',
        smtp_password_migration_required: dbSettings.smtp_password && !isEncryptedSettingSecret(dbSettings.smtp_password) ? 'true' : 'false',
        smtp_encryption_key_configured: hasSettingsEncryptionKey() ? 'true' : 'false',
        smtp_require_tls: dbSettings.smtp_require_tls ?? process.env.SMTP_REQUIRE_TLS ?? ((dbSettings.smtp_secure ?? process.env.SMTP_SECURE) === 'true' ? 'false' : 'true'),
        smtp_ca_certificate: dbSettings.smtp_ca_certificate || '',
        smtp_ca_summary: dbSettings.smtp_ca_certificate ? certificateSummary(dbSettings.smtp_ca_certificate) : process.env.SMTP_CA_FILE ? 'Provided by SMTP_CA_FILE' : '',
        smtp_client_certificate: dbSettings.smtp_client_certificate || '',
        smtp_client_certificate_summary: dbSettings.smtp_client_certificate ? certificateSummary(dbSettings.smtp_client_certificate) : process.env.SMTP_CLIENT_CERT_FILE ? 'Provided by SMTP_CLIENT_CERT_FILE' : '',
        smtp_client_key: '',
        smtp_client_key_configured: dbSettings.smtp_client_key ? 'true' : 'false',
    };
}

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const [settings, legacyEntra, branding] = await Promise.all([
            prisma.appSetting.findMany({ where: { key: { in: DB_READ_KEYS } } }),
            prisma.appSetting.findMany({ where: { key: { in: [...ENTRA_KEYS] } } }),
            getBrandingConfig(),
        ]);
        const ssoSummary = await ssoSettingsSummary(Object.fromEntries(legacyEntra.map((setting) => [setting.key, setting.value])));
        return NextResponse.json(mergeSettingSources(Object.fromEntries(settings.map((setting) => [setting.key, setting.value])), ssoSummary, branding.microsoftButtonText));
    } catch (error) {
        logger.error('Failed to load settings', { error });
        return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }
}

/** SMTP TLS material: null removes it, a PEM replaces it, an empty client key keeps the stored one. */
function normalizeSmtpPem(key: string, raw: unknown): SettingValue {
    if (raw === null) return null;
    if (typeof raw !== 'string') throw new SettingsValidationError(`${key} must be a PEM string, or null to remove it.`);
    const pem = normalizePem(raw);
    if (!pem) {
        if (key === 'smtp_client_key') return '';
        throw new SettingsValidationError(`Send null to remove ${key}; an empty value is ambiguous.`);
    }
    if (key === 'smtp_client_key') parsePrivateKey(pem, 'SMTP client key');
    else parseCertificates(pem, key === 'smtp_ca_certificate' ? 'SMTP CA certificate' : 'SMTP client certificate');
    return pem;
}

export async function PATCH(request: Request) {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const body: unknown = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Settings payload must be an object' }, { status: 400 });

        const unknownKeys = Object.keys(body).filter((key) => !ALLOWED_KEYS.has(key));
        if (unknownKeys.length > 0) {
            return NextResponse.json({ error: `Unknown settings: ${unknownKeys.join(', ')}` }, { status: 400 });
        }
        // Only submitted keys are touched: omitted = keep, value = replace, null = remove.
        const values = new Map<string, SettingValue>();
        let previousIcons = new Set<string>();
        let nextIcons = new Set<string>();

        for (const [key, rawValue] of Object.entries(body)) {
            if (key === 'dashboard_links') {
                let candidate: unknown;
                try { candidate = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue; }
                catch { return NextResponse.json({ error: 'Dashboard links must be valid JSON' }, { status: 400 }); }
                if (Array.isArray(candidate)) {
                    candidate = candidate.map((link) => {
                        if (!link || typeof link !== 'object' || Array.isArray(link)) return link;
                        const item = link as Record<string, unknown>;
                        const type = item.type ?? 'external';
                        if (type === 'ticket_form') return { ...item, type, iconUrl: item.iconUrl ?? '' };
                        const url = typeof item.url === 'string' && !/^https?:\/\//i.test(item.url) ? `https://${item.url}` : item.url;
                        return { ...item, type, url, iconUrl: item.iconUrl ?? '' };
                    });
                }
                const parsed = normalizeDashboardLinks(candidate);
                if (!parsed.success) return NextResponse.json({ error: 'Dashboard link validation failed', details: parsed.error.flatten() }, { status: 400 });
                for (const link of parsed.data) {
                    if (link.type !== 'ticket_form') continue;
                    const queue = await prisma.queue.findFirst({ where: { id: link.queueId, isActive: true }, select: { id: true } });
                    const category = link.categoryId
                        ? await prisma.category.findFirst({
                            where: { id: link.categoryId, queueId: link.queueId, isActive: true, archivedAt: null },
                            select: { id: true },
                        })
                        : null;
                    if (!queue || (link.categoryId && !category)) {
                        return NextResponse.json({ error: 'Ticket-form links must use an active department and a category from that department' }, { status: 400 });
                    }
                }
                const previous = await prisma.appSetting.findUnique({ where: { key: 'dashboard_links' } });
                previousIcons = new Set(parseDashboardLinks(previous?.value).map((link) => link.iconUrl).filter(Boolean));
                nextIcons = new Set(parsed.data.map((link) => link.iconUrl).filter(Boolean));
                values.set(key, JSON.stringify(parsed.data));
            } else if (SMTP_PEM_KEYS.has(key)) {
                values.set(key, normalizeSmtpPem(key, rawValue));
            } else if (OIDC_KEYS.includes(key)) {
                values.set(key, normalizeOidcSetting(key, rawValue));
            } else {
                if (rawValue === null) return NextResponse.json({ error: `${key} cannot be removed.` }, { status: 400 });
                values.set(key, normalizeSettingValue(key, rawValue));
            }
        }
        const submitted = (key: string) => values.get(key) ?? undefined;

        // Authentication policy: one shared guard for lockout prevention and provider switching.
        const submittedProvider = values.has('sso_provider') ? parseSsoProvider(submitted('sso_provider')) : undefined;
        const ssoState = submittedProvider ? await getSsoState() : null;
        if (submittedProvider && ssoState && submittedProvider !== ssoState.provider && ssoState.migrationTarget) {
            return NextResponse.json({ error: 'An SSO migration is in progress. Finish or cancel it before switching the provider directly.' }, { status: 409 });
        }
        if (values.has('login_local_enabled') || values.has('login_sso_enabled') || submittedProvider) {
            await assertProposedAuthentication({
                localEnabled: values.has('login_local_enabled') ? submitted('login_local_enabled') === 'true' : undefined,
                ssoEnabled: values.has('login_sso_enabled') ? submitted('login_sso_enabled') === 'true' : undefined,
                ssoProvider: submittedProvider,
            });
        }

        // Changing the active provider's issuer orphans its links; same rule as a direct provider switch.
        let warning: string | undefined;
        for (const prefix of ['oidc', 'oidc_next'] as const) {
            const issuerKey = `${prefix}_issuer`;
            const nextIssuer = submitted(issuerKey);
            if (!nextIssuer) continue;
            const currentIssuer = (await readManagedEnvironment())[issuerKey] || process.env[MANAGED_ENV_NAMES[issuerKey]] || '';
            const orphaned = await assessActiveIssuerChange(prefix, currentIssuer, nextIssuer);
            if (orphaned) warning = `${orphaned} account link(s) belong to the previous issuer and will no longer sign in after the restart. Users can link the new issuer from Profile; SSO migration moves users without interruption.`;
        }

        const orphanedEntra = await assessActiveEntraChange({ tenant: submitted('azure_ad_tenant_id'), client: submitted('azure_ad_client_id') });
        if (orphanedEntra) warning = `${orphanedEntra} user(s) are linked to the current Entra tenant and application and will no longer sign in with Microsoft after the restart. They can link again from Profile; SSO migration moves users without interruption.`;

        // SMTP client certificate pair: removing either half removes both; replacing must still match.
        const clearsClientPair = values.get('smtp_client_certificate') === null || values.get('smtp_client_key') === null;
        const newCertificate = submitted('smtp_client_certificate');
        const newKey = submitted('smtp_client_key');
        if (!clearsClientPair && (newCertificate || newKey)) {
            const rows = await prisma.appSetting.findMany({ where: { key: { in: ['smtp_client_certificate', 'smtp_client_key'] } } });
            const stored = Object.fromEntries(rows.map((setting) => [setting.key, setting.value]));
            const certificatePem = newCertificate || stored.smtp_client_certificate;
            const keyPem = newKey || (stored.smtp_client_key ? decryptSettingSecret(stored.smtp_client_key) : undefined);
            if (!certificatePem || !keyPem) return NextResponse.json({ error: 'Provide both the SMTP client certificate and its private key.' }, { status: 400 });
            assertKeyMatchesCertificate(parseCertificates(certificatePem, 'SMTP client certificate')[0], parsePrivateKey(keyPem, 'SMTP client key'));
        }
        if (clearsClientPair) { values.set('smtp_client_certificate', null); values.set('smtp_client_key', null); }

        const smtpKeys = [...values.keys()].filter((key) => ['smtp_port', 'smtp_secure', 'smtp_require_tls'].includes(key));
        if (smtpKeys.length > 0) {
            const existingRows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'smtp_' } } });
            const existing = Object.fromEntries(existingRows.map((setting) => [setting.key, setting.value]));
            const port = Number.parseInt(submitted('smtp_port') ?? existing.smtp_port ?? process.env.SMTP_PORT ?? '587', 10);
            const secure = (submitted('smtp_secure') ?? existing.smtp_secure ?? process.env.SMTP_SECURE ?? 'false') === 'true';
            const requireTLS = (submitted('smtp_require_tls') ?? existing.smtp_require_tls ?? process.env.SMTP_REQUIRE_TLS ?? (secure ? 'false' : 'true')) === 'true';
            validateSmtpSecurityCombination({ port, secure, requireTLS });
        }
        const enablingEmail = [...values].some(([key, value]) => key.startsWith('email_on_') && value === 'true');
        if (enablingEmail) {
            const existingFrom = await prisma.appSetting.findUnique({ where: { key: 'smtp_from' }, select: { value: true } });
            if (!isValidSmtpFrom(submitted('smtp_from') ?? existingFrom?.value ?? process.env.SMTP_FROM ?? '')) {
                return NextResponse.json({ error: 'Configure a valid SMTP From address before enabling email notifications.' }, { status: 400 });
            }
        }

        let restartRequired = false;
        const entraValues = new Map([...values].filter(([key]) => (ENTRA_KEYS as readonly string[]).includes(key)));
        if (entraValues.size > 0) {
            const legacyRows = await prisma.appSetting.findMany({ where: { key: { in: [...ENTRA_KEYS] } } });
            restartRequired = await applyEntraSettings(entraValues, Object.fromEntries(legacyRows.map((setting) => [setting.key, setting.value])));
            if (restartRequired) await prisma.appSetting.deleteMany({ where: { key: { in: [...ENTRA_KEYS] } } });
        }
        for (const prefix of ['oidc', 'oidc_next'] as const) {
            const slotValues = new Map([...values].filter(([key]) => OIDC_KEYS.includes(key) && prefixOf(key) === prefix));
            if (slotValues.size > 0) restartRequired = (await applyOidcSettings(prefix, slotValues)) || restartRequired;
        }

        const dbEntries = [...values].filter(([key]) => !ENV_ONLY_KEYS.has(key) && key !== 'sso_button_text');
        const upserts = dbEntries.filter((entry): entry is [string, string] => entry[1] !== null && !(DB_SECRET_KEYS.has(entry[0]) && entry[1].trim() === ''));
        const removals = dbEntries.filter(([, value]) => value === null).map(([key]) => key);
        await prisma.$transaction([
            ...upserts.map(([key, value]) => {
                const stored = (key === 'smtp_password' || key === 'smtp_client_key') ? encryptSettingSecret(value) : value;
                return prisma.appSetting.upsert({ where: { key }, update: { value: stored }, create: { key, value: stored } });
            }),
            ...(removals.length ? [prisma.appSetting.deleteMany({ where: { key: { in: removals } } })] : []),
        ]);
        const submittedButtonText = submitted('sso_button_text');
        if (submittedProvider || submittedButtonText) {
            // The button text lives in the public branding config. Without an explicit text, follow the
            // provider unless an administrator customised it.
            const branding = await getBrandingConfig();
            const followsProvider = submittedProvider && isDefaultSsoButtonText(branding.microsoftButtonText);
            const text = submittedButtonText || (followsProvider ? defaultSsoButtonText(submittedProvider) : branding.microsoftButtonText);
            // saveBrandingConfig also persists the login switches; pin them to the effective
            // configuration so a text change can never enable or disable a method implicitly.
            if (text !== branding.microsoftButtonText) {
                await saveBrandingConfig({ ...branding, showLocalLogin: await isLoginMethodEnabled('login_local_enabled'), showMicrosoftLogin: await isLoginMethodEnabled('login_sso_enabled'), microsoftButtonText: text });
            }
        }
        for (const oldIcon of previousIcons) {
            if (!nextIcons.has(oldIcon)) await removeUploadedImage(oldIcon, 'quick-links');
        }
        await auditLog({ userId: session.user.id, action: 'settings.updated', entity: 'app_setting', metadata: { keys: [...values.keys()], removed: [...values].filter(([, value]) => value === null).map(([key]) => key) } });
        return NextResponse.json({ success: true, restartRequired, ...(warning ? { warning } : {}) });
    } catch (error) {
        logger.error('Failed to update settings', { error });
        if (error instanceof SettingsValidationError || error instanceof TlsMaterialError || error instanceof OidcConfigError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof AuthenticationPolicyError || error instanceof SettingsSecretError || error instanceof ManagedEnvironmentError) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}
