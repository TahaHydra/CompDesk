import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { auth } from '@/lib/auth';
import { getBrandingConfig } from '@/lib/branding';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';

export async function POST() {
    try {
        const session = await auth();
        if (!session || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const branding = await getBrandingConfig();
        const settings = await prisma.appSetting.findMany({ where: { key: { startsWith: 'smtp_' } } });
        const config = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
        const host = config.smtp_host || process.env.SMTP_HOST;
        const port = Number.parseInt(config.smtp_port || process.env.SMTP_PORT || '587', 10);
        const user = config.smtp_user || process.env.SMTP_USER;
        const pass = config.smtp_password || process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
        const from = config.smtp_from || process.env.SMTP_FROM || `${branding.applicationName} <noreply@example.com>`;
        if (!host || !user || !pass) {
            return NextResponse.json({ error: 'SMTP not configured. Fill in the host, user, and password.' }, { status: 400 });
        }
        const transporter = nodemailer.createTransport({
            host, port, secure: config.smtp_secure === 'true', auth: { user, pass },
        });
        await transporter.sendMail({
            from,
            to: session.user.email,
            subject: `[${branding.applicationName}] SMTP test successful`,
            html: `<h2>${branding.applicationName} SMTP configuration successful</h2><p>This message confirms the configured SMTP transport is working.</p><p>Sent at: ${new Date().toISOString()}</p>`,
        });
        return NextResponse.json({ success: true, message: `Test email sent to ${session.user.email}` });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown mail transport error';
        return NextResponse.json({ error: `Failed to send test email: ${message}` }, { status: 500 });
    }
}