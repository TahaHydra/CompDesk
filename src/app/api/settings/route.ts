import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { dashboardLinksSchema, parseDashboardLinks } from '@/lib/dashboard-links';
import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { removeUploadedImage } from '@/lib/uploaded-image';
import { isAdmin } from '@/lib/utils';

const SECRET_KEYS = new Set(['smtp_password', 'azure_ad_client_secret']);
const ENV_ONLY_KEYS = new Set(['azure_ad_client_id', 'azure_ad_client_secret', 'azure_ad_tenant_id']);
const ALLOWED_KEYS = new Set([
    'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from', 'smtp_secure',
    'email_on_ticket_created', 'email_on_ticket_assigned', 'email_on_ticket_updated', 'email_on_new_comment',
    'azure_ad_client_id', 'azure_ad_client_secret', 'azure_ad_tenant_id',
    'dashboard_links', 'login_local_enabled',
    'feature_attachments_enabled', 'feature_dashboard_links_enabled', 'feature_external_api_enabled',
    'feature_webhooks_enabled',
]);

async function updateEnvFile(updates: Record<string, unknown>) {
    try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = await fs.readFile(envPath, 'utf8').catch(() => '');
        let changed = false;
        const envMapping: Record<string, string> = {
            azure_ad_client_id: 'AZURE_AD_CLIENT_ID',
            azure_ad_client_secret: 'AZURE_AD_CLIENT_SECRET',
            azure_ad_tenant_id: 'AZURE_AD_TENANT_ID',
        };

        for (const [key, value] of Object.entries(updates)) {
            const envKey = envMapping[key];
            if (!envKey) continue;
            changed = true;
            const regex = new RegExp(`^#?\\s*${envKey}=.*$`, 'm');
            const newLine = `${envKey}="${value}"`;
            envContent = regex.test(envContent) ? envContent.replace(regex, newLine) : `${envContent}\n${newLine}`;
        }
        if (changed) await fs.writeFile(envPath, `${envContent.trim()}\n`, 'utf8');
    } catch (error) {
        logger.error('Failed to update environment settings', { error });
    }
}

function mergeSettingSources(dbSettings: Record<string, string>): Record<string, string> {
    return {
        ...dbSettings,
        azure_ad_client_id: process.env.AZURE_AD_CLIENT_ID || dbSettings.azure_ad_client_id || '',
        azure_ad_tenant_id: process.env.AZURE_AD_TENANT_ID || dbSettings.azure_ad_tenant_id || '',
        azure_ad_client_secret: '',
        azure_ad_client_secret_configured: process.env.AZURE_AD_CLIENT_SECRET ? 'true' : 'false',
        smtp_password: '',
        smtp_password_configured: dbSettings.smtp_password || process.env.SMTP_PASS || process.env.SMTP_PASSWORD ? 'true' : 'false',
    };
}

export async function GET() {
    try {
        const session = await auth();
        if (!session || !isAdmin(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const settings = await prisma.appSetting.findMany();
        return NextResponse.json(mergeSettingSources(Object.fromEntries(settings.map((setting) => [setting.key, setting.value]))));
    } catch (error) {
        logger.error('Failed to load settings', { error });
        return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }
}

export async function PATCH(request: Request) {
    try {
        const session = await auth();
        if (!session || !isAdmin(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const body: unknown = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Settings payload must be an object' }, { status: 400 });

        const entries = Object.entries(body).filter(([key]) => ALLOWED_KEYS.has(key));
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
                        const url = typeof item.url === 'string' && !/^https?:\/\//i.test(item.url) ? `https://${item.url}` : item.url;
                        return { ...item, url, iconUrl: item.iconUrl ?? '' };
                    });
                }
                const parsed = dashboardLinksSchema.safeParse(candidate);
                if (!parsed.success) return NextResponse.json({ error: 'Dashboard link validation failed', details: parsed.error.flatten() }, { status: 400 });
                const previous = await prisma.appSetting.findUnique({ where: { key: 'dashboard_links' } });
                previousIcons = new Set(parseDashboardLinks(previous?.value).map((link) => link.iconUrl).filter(Boolean));
                nextIcons = new Set(parsed.data.map((link) => link.iconUrl).filter(Boolean));
                normalizedEntries.push([key, JSON.stringify(parsed.data)]);
            } else {
                normalizedEntries.push([key, String(rawValue)]);
            }
        }

        const dbUpdates = normalizedEntries.filter(([key, value]) => !ENV_ONLY_KEYS.has(key) && !(SECRET_KEYS.has(key) && value.trim() === ''));
        await prisma.$transaction(dbUpdates.map(([key, value]) => prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } })));

        for (const oldIcon of previousIcons) {
            if (!nextIcons.has(oldIcon)) await removeUploadedImage(oldIcon, 'quick-links');
        }
        await updateEnvFile(Object.fromEntries(normalizedEntries.filter(([, value]) => value.trim() !== '')));
        await auditLog({ userId: session.user.id, action: 'settings.updated', entity: 'app_setting', metadata: { keys: normalizedEntries.map(([key]) => key) } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to update settings', { error });
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}