import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { normalizeDashboardLinks, parseDashboardLinks } from '@/lib/dashboard-links';
import logger from '@/lib/logger';
import { ManagedEnvironmentError, readManagedEnvironment, updateManagedEnvironment } from '@/lib/managed-env';
import { prisma } from '@/lib/prisma';
import { removeUploadedImage } from '@/lib/uploaded-image';
import { isValidSmtpFrom, normalizeSettingValue, SettingsValidationError, validateSmtpSecurityCombination } from '@/lib/settings-validation';
import { encryptSettingSecret, getEnvironmentSmtpPassword, hasIgnoredEnvironmentSmtpPlaceholder, hasSettingsEncryptionKey, isEncryptedSettingSecret, SettingsSecretError } from '@/lib/settings-secret';

const SECRET_KEYS = new Set(['smtp_password', 'azure_ad_client_secret']);
const ENV_ONLY_KEYS = new Set(['azure_ad_client_id', 'azure_ad_client_secret', 'azure_ad_tenant_id']);
const ALLOWED_KEYS = new Set([
    'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from', 'smtp_secure', 'smtp_require_tls',
    'email_on_ticket_created', 'email_on_ticket_assigned', 'email_on_ticket_updated', 'email_on_new_comment',
    'azure_ad_client_id', 'azure_ad_client_secret', 'azure_ad_tenant_id',
    'dashboard_links', 'login_local_enabled',
    'feature_attachments_enabled', 'feature_dashboard_links_enabled', 'feature_external_api_enabled',
    'feature_webhooks_enabled',
    'ticket_reminders_enabled', 'ticket_reminder_cooldown_hours', 'ticket_reminder_max_per_cycle',
    'ticket_reminder_allow_agents', 'ticket_reminder_allow_admins',
]);

function mergeSettingSources(dbSettings: Record<string, string>, managedEnv: Record<string, string>): Record<string, string> {
    const environmentPassword = getEnvironmentSmtpPassword();
    const passwordSource = environmentPassword ? 'environment' : dbSettings.smtp_password ? 'database' : 'missing';
    return {
        ...dbSettings,
        azure_ad_client_id: managedEnv.azure_ad_client_id || process.env.AZURE_AD_CLIENT_ID || dbSettings.azure_ad_client_id || '',
        azure_ad_tenant_id: managedEnv.azure_ad_tenant_id || process.env.AZURE_AD_TENANT_ID || dbSettings.azure_ad_tenant_id || '',
        azure_ad_client_secret: '',
        azure_ad_client_secret_configured: process.env.AZURE_AD_CLIENT_SECRET || managedEnv.azure_ad_client_secret ? 'true' : 'false',
        azure_ad_runtime_configured: process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET && process.env.AZURE_AD_TENANT_ID ? 'true' : 'false',
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
        ticket_reminders_enabled: dbSettings.ticket_reminders_enabled ?? 'false',
        ticket_reminder_cooldown_hours: dbSettings.ticket_reminder_cooldown_hours ?? '24',
        ticket_reminder_max_per_cycle: dbSettings.ticket_reminder_max_per_cycle ?? '3',
        ticket_reminder_allow_agents: dbSettings.ticket_reminder_allow_agents ?? 'true',
        ticket_reminder_allow_admins: dbSettings.ticket_reminder_allow_admins ?? 'true',
    };
}

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const settings = await prisma.appSetting.findMany({
            where: { key: { in: [...ALLOWED_KEYS] } },
        });
        const managedEnv = await readManagedEnvironment();
        return NextResponse.json(mergeSettingSources(Object.fromEntries(settings.map((setting) => [setting.key, setting.value])), managedEnv));
    } catch (error) {
        logger.error('Failed to load settings', { error });
        return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }
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
        const entries = Object.entries(body);
        const normalizedEntries: [string, string][] = [];
        let previousIcons = new Set<string>();
        let nextIcons = new Set<string>();

        for (const [key, rawValue] of entries) {
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
                normalizedEntries.push([key, JSON.stringify(parsed.data)]);
            } else {
                const normalized = normalizeSettingValue(key, rawValue);
                if (key === 'smtp_password' && normalized.trim()) {
                    normalizedEntries.push([key, encryptSettingSecret(normalized)]);
                } else {
                    normalizedEntries.push([key, normalized]);
                }
            }
        }

        const disablesLocalLogin = normalizedEntries.some(([key, value]) => key === 'login_local_enabled' && value === 'false');
        if (disablesLocalLogin) {
            const microsoftPolicy = await prisma.appSetting.findUnique({ where: { key: 'login_microsoft_enabled' }, select: { value: true } });
            const providerConfigured = Boolean(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET && process.env.AZURE_AD_TENANT_ID);
            if (microsoftPolicy?.value !== 'true' || !providerConfigured) {
                return NextResponse.json({ error: 'Local login can be disabled only while Microsoft login is enabled and configured in the running application.' }, { status: 409 });
            }
        }
        const smtpEntries = new Map(normalizedEntries.filter(([key]) => key.startsWith('smtp_')));
        if (smtpEntries.size > 0) {
            const existingRows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'smtp_' } } });
            const existing = Object.fromEntries(existingRows.map((setting) => [setting.key, setting.value]));
            const port = Number.parseInt(smtpEntries.get('smtp_port') ?? existing.smtp_port ?? process.env.SMTP_PORT ?? '587', 10);
            const secure = (smtpEntries.get('smtp_secure') ?? existing.smtp_secure ?? process.env.SMTP_SECURE ?? 'false') === 'true';
            const requireTLS = (smtpEntries.get('smtp_require_tls') ?? existing.smtp_require_tls ?? process.env.SMTP_REQUIRE_TLS ?? 'true') === 'true';
            validateSmtpSecurityCombination({ port, secure, requireTLS });
        }
        const enablingEmail = normalizedEntries.some(([key, value]) => (key.startsWith('email_on_') || key === 'ticket_reminders_enabled') && value === 'true');
        if (enablingEmail) {
            const existingFrom = await prisma.appSetting.findUnique({ where: { key: 'smtp_from' }, select: { value: true } });
            const submittedFrom = normalizedEntries.find(([key]) => key === 'smtp_from')?.[1];
            if (!isValidSmtpFrom(submittedFrom ?? existingFrom?.value ?? process.env.SMTP_FROM ?? '')) {
                return NextResponse.json({ error: 'Configure a valid SMTP From address before enabling email notifications.' }, { status: 400 });
            }
        }
        let restartRequired = false;
        const entraEntries = normalizedEntries.filter(([key]) => ENV_ONLY_KEYS.has(key));
        if (entraEntries.length > 0) {
            const [legacyRows, managedEnv] = await Promise.all([
                prisma.appSetting.findMany({ where: { key: { in: [...ENV_ONLY_KEYS] } } }),
                readManagedEnvironment(),
            ]);
            const legacy = Object.fromEntries(legacyRows.map((setting) => [setting.key, setting.value]));
            const submitted = Object.fromEntries(entraEntries.filter(([, value]) => value.trim() !== ''));
            const effectiveEntra = {
                azure_ad_client_id: submitted.azure_ad_client_id || managedEnv.azure_ad_client_id || process.env.AZURE_AD_CLIENT_ID || legacy.azure_ad_client_id || '',
                azure_ad_client_secret: submitted.azure_ad_client_secret || managedEnv.azure_ad_client_secret || process.env.AZURE_AD_CLIENT_SECRET || legacy.azure_ad_client_secret || '',
                azure_ad_tenant_id: submitted.azure_ad_tenant_id || managedEnv.azure_ad_tenant_id || process.env.AZURE_AD_TENANT_ID || legacy.azure_ad_tenant_id || '',
            };
            if (!effectiveEntra.azure_ad_client_id || !effectiveEntra.azure_ad_client_secret || !effectiveEntra.azure_ad_tenant_id) {
                return NextResponse.json({ error: 'Client ID, Client Secret, and Tenant ID are all required for Microsoft sign-in.' }, { status: 400 });
            }
            restartRequired = await updateManagedEnvironment(effectiveEntra);
            if (restartRequired) await prisma.appSetting.deleteMany({ where: { key: { in: [...ENV_ONLY_KEYS] } } });
        }

        const dbUpdates = normalizedEntries.filter(([key, value]) => !ENV_ONLY_KEYS.has(key) && !(SECRET_KEYS.has(key) && value.trim() === ''));
        await prisma.$transaction(dbUpdates.map(([key, value]) => prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })));
        for (const oldIcon of previousIcons) {
            if (!nextIcons.has(oldIcon)) await removeUploadedImage(oldIcon, 'quick-links');
        }
        await auditLog({ userId: session.user.id, action: 'settings.updated', entity: 'app_setting', metadata: { keys: normalizedEntries.map(([key]) => key) } });
        return NextResponse.json({ success: true, restartRequired });
    } catch (error) {
        logger.error('Failed to update settings', { error });
        if (error instanceof SettingsValidationError) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof SettingsSecretError) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        if (error instanceof ManagedEnvironmentError) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}
