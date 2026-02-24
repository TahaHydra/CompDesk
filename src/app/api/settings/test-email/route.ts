import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/utils';
import nodemailer from 'nodemailer';
import { prisma } from '@/lib/prisma';

// POST /api/settings/test-email — send a test email
export async function POST() {
    try {
        const session = await auth();
        if (!session || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Load SMTP settings from DB
        const settings = await prisma.appSetting.findMany({
            where: { key: { startsWith: 'smtp_' } },
        });
        const cfg: Record<string, string> = {};
        settings.forEach((s) => { cfg[s.key] = s.value; });

        const host = cfg.smtp_host || process.env.SMTP_HOST;
        const port = parseInt(cfg.smtp_port || process.env.SMTP_PORT || '587');
        const user = cfg.smtp_user || process.env.SMTP_USER;
        const pass = cfg.smtp_password || process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
        const from = cfg.smtp_from || process.env.SMTP_FROM || 'noreply@compdesk.local';

        if (!host || !user || !pass) {
            return NextResponse.json({ error: 'SMTP not configured. Please fill in host, user, and password.' }, { status: 400 });
        }

        const transporter = nodemailer.createTransport({
            host,
            port,
            secure: cfg.smtp_secure === 'true',
            auth: { user, pass },
        });

        await transporter.sendMail({
            from,
            to: session.user.email,
            subject: '[CompDesk] Test Email — SMTP is working!',
            html: `<h2>✅ SMTP Configuration Successful</h2><p>This test email confirms that your SMTP settings are correctly configured.</p><p>Sent at: ${new Date().toISOString()}</p>`,
        });

        return NextResponse.json({ success: true, message: `Test email sent to ${session.user.email}` });
    } catch (error: any) {
        return NextResponse.json({ error: `Failed to send test email: ${error.message}` }, { status: 500 });
    }
}
