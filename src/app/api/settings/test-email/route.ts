import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBrandingConfig } from '@/lib/branding';
import { createSmtpTransport, formatSmtpError, getSmtpConfig } from '@/lib/email';
import logger from '@/lib/logger';
import { auditLog } from '@/lib/audit';

export async function POST() {
    let smtp: Awaited<ReturnType<typeof getSmtpConfig>> | undefined;
    let actorId: string | undefined;
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        actorId = session.user.id;
        const branding = await getBrandingConfig();
        smtp = await getSmtpConfig(branding);
        const transporter = createSmtpTransport(smtp);
        await transporter.sendMail({
            from: smtp.from,
            to: session.user.email,
            subject: `[${branding.applicationName}] SMTP test successful`,
            html: `<h2>${branding.applicationName} SMTP configuration successful</h2><p>This message confirms the configured SMTP transport is working.</p><p>Sent at: ${new Date().toISOString()}</p>`,
        });
        await auditLog({
            userId: session.user.id,
            action: 'smtp.test_succeeded',
            entity: 'email',
            metadata: { host: smtp.host, port: smtp.port, secure: smtp.secure, recipient: session.user.email },
        });
        return NextResponse.json({ success: true, message: `Test email sent to ${session.user.email}` });
    } catch (error: unknown) {
        const message = formatSmtpError(error, smtp);
        logger.error('SMTP test failed', {
            error: message,
            host: smtp?.host,
            port: smtp?.port,
            secure: smtp?.secure,
        });
        await auditLog({
            userId: actorId,
            action: 'smtp.test_failed',
            entity: 'email',
            metadata: { host: smtp?.host, port: smtp?.port, secure: smtp?.secure, error: message },
        });
        return NextResponse.json({ error: `Failed to send test email: ${message}` }, { status: 500 });
    }
}