import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { promises as fs } from 'fs';
import path from 'path';

async function updateEnvFile(updates: Record<string, unknown>) {
    try {
        const envPath = path.join(process.cwd(), '.env');
        let envContent = await fs.readFile(envPath, 'utf8').catch(() => '');

        let changed = false;

        const envMapping: Record<string, string> = {
            'azure_ad_client_id': 'AZURE_AD_CLIENT_ID',
            'azure_ad_client_secret': 'AZURE_AD_CLIENT_SECRET',
            'azure_ad_tenant_id': 'AZURE_AD_TENANT_ID',
        };

        for (const [key, value] of Object.entries(updates)) {
            const envKey = envMapping[key];
            if (!envKey) continue;

            changed = true;
            const regex = new RegExp(`^#?\\s*${envKey}=.*$`, 'm');
            const newLine = `${envKey}="${value}"`;

            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, newLine);
            } else {
                envContent += `\n${newLine}`;
            }
        }

        if (changed) {
            await fs.writeFile(envPath, envContent.trim() + '\n', 'utf8');
        }
    } catch (e) {
        console.error('Failed to update .env', e);
    }
}

// GET /api/settings — load all settings
export async function GET() {
    try {
        const session = await auth();
        if (!session || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const settings = await prisma.appSetting.findMany();
        const map: Record<string, string> = {};
        settings.forEach((s) => { map[s.key] = s.value; });

        return NextResponse.json(map);
    } catch {
        return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }
}

// PATCH /api/settings — update settings
export async function PATCH(request: Request) {
    try {
        const session = await auth();
        if (!session || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();

        // body is { key: value, key2: value2, ... }
        const updates = Object.entries(body).filter(([key]) => {
            // Whitelist of allowed settings keys
            const allowed = [
                'smtp_host', 'smtp_port', 'smtp_user', 'smtp_password', 'smtp_from', 'smtp_secure',
                'email_on_ticket_created', 'email_on_ticket_assigned', 'email_on_ticket_updated', 'email_on_new_comment',
                'azure_ad_client_id', 'azure_ad_client_secret', 'azure_ad_tenant_id',
                'dashboard_links',
                'login_local_enabled',
            ];
            return allowed.includes(key);
        });

        for (const [key, value] of updates) {
            await prisma.appSetting.upsert({
                where: { key },
                update: { value: String(value) },
                create: { key, value: String(value) },
            });
        }

        // Also update .env file for environment variables that NextAuth needs at load-time
        await updateEnvFile(Object.fromEntries(updates));

        return NextResponse.json({ success: true });
    } catch {
        return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }
}
