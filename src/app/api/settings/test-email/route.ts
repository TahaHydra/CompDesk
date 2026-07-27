import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBrandingConfig } from '@/lib/branding';
import { createSmtpTransport, formatSmtpError, getSmtpConfig, requireValidSmtpFrom, smtpFailureCategory } from '@/lib/email';
import logger from '@/lib/logger';
import { auditLog } from '@/lib/audit';

export async function POST() {
    const correlationId = crypto.randomUUID();
    let smtp: Awaited<ReturnType<typeof getSmtpConfig>> | undefined;
    let actorId: string | undefined;
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        actorId = session.user.id;
        const branding = await getBrandingConfig();
        smtp = await getSmtpConfig(branding);
        requireValidSmtpFrom(smtp);
        const transporter = createSmtpTransport(smtp);
        const info = await transporter.sendMail({
            from: smtp.from,
            to: session.user.email,
            subject: `[${branding.applicationName}] SMTP delivery test`,
            html: `<h2>${branding.applicationName} SMTP delivery test</h2><p>This real message confirms connection, authentication, and message submission using the configured From address.</p><p>Correlation ID: ${correlationId}</p>`,
        });
        const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0;
        await auditLog({ userId: session.user.id, action: 'smtp.test_succeeded', entity: 'email', metadata: { correlationId, host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTLS, accepted } });
        return NextResponse.json({ success: true, correlationId, stage: 'send', fromAccepted: true, message: `Test email submitted to ${session.user.email}. The SMTP server accepted the configured From address for this message.` });
    } catch (error: unknown) {
        const message = formatSmtpError(error, smtp);
        const category = smtpFailureCategory(error);
        const metadata = { correlationId, category, host: smtp?.host, port: smtp?.port, secure: smtp?.secure, requireTLS: smtp?.requireTLS };
        logger.error('SMTP delivery test failed', { ...metadata, error: message });
        await auditLog({ userId: actorId, action: 'smtp.test_failed', entity: 'email', metadata: { ...metadata, error: message } });
        return NextResponse.json({ success: false, correlationId, stage: 'send', category, fromAccepted: false, error: message }, { status: 502 });
    }
}