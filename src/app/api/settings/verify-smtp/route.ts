import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { getBrandingConfig } from '@/lib/branding';
import { createSmtpTransport, formatSmtpError, getSmtpConfig, smtpFailureCategory } from '@/lib/email';
import logger from '@/lib/logger';

export async function POST() {
    const correlationId = crypto.randomUUID();
    let smtp: Awaited<ReturnType<typeof getSmtpConfig>> | undefined;
    let actorId: string | undefined;
    try {
        const session = await auth();
        if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        actorId = session.user.id;
        smtp = await getSmtpConfig(await getBrandingConfig());
        await createSmtpTransport(smtp).verify();
        const metadata = { correlationId, host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: smtp.requireTLS };
        logger.info('SMTP connection verification succeeded', metadata);
        await auditLog({ userId: actorId, action: 'smtp.verify_succeeded', entity: 'email', metadata });
        return NextResponse.json({ success: true, correlationId, stage: 'connection_authentication', secure: smtp.secure, requireTLS: smtp.requireTLS, fromAccepted: null, message: 'Connection and authentication succeeded. From-address acceptance is only tested by sending a real message.' });
    } catch (error) {
        const category = smtpFailureCategory(error);
        const message = formatSmtpError(error, smtp);
        const metadata = { correlationId, category, host: smtp?.host, port: smtp?.port, secure: smtp?.secure, requireTLS: smtp?.requireTLS };
        logger.error('SMTP connection verification failed', { ...metadata, error: message });
        await auditLog({ userId: actorId, action: 'smtp.verify_failed', entity: 'email', metadata: { ...metadata, error: message } });
        return NextResponse.json({ success: false, correlationId, stage: 'connection_authentication', category, fromAccepted: null, error: message }, { status: 502 });
    }
}