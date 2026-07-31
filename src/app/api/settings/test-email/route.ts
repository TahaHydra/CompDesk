import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getBrandingConfig } from '@/lib/branding';
import { createSmtpTransport, formatSmtpError, getSmtpConfig, requireValidSmtpFrom, smtpFailureCategory } from '@/lib/email';
import logger from '@/lib/logger';
import { auditLog } from '@/lib/audit';

function addresses(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return values.slice(0, 20).map((value) => typeof value === 'string' ? value : String(value));
}

function safeResponse(value: unknown): string | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    return value.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

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
            html: `<h2>${branding.applicationName} SMTP delivery test</h2><p>This real message tests connection, authentication, and SMTP relay submission using the configured From address.</p><p>Correlation ID: ${correlationId}</p>`,
        });
        const acceptedRecipients = addresses(info.accepted);
        const rejectedRecipients = addresses(info.rejected);
        const response = safeResponse(info.response);
        const responseStatus = response?.match(/^\s*(\d{3})\b/)?.[1] ?? null;
        const messageId = typeof info.messageId === 'string' ? info.messageId.slice(0, 500) : null;
        const relayAccepted = acceptedRecipients.length > 0 && rejectedRecipients.length === 0;
        const result = {
            correlationId,
            stage: 'send',
            relayAccepted,
            acceptedRecipients,
            rejectedRecipients,
            response,
            responseStatus,
            messageId,
        };
        await auditLog({
            userId: session.user.id,
            action: relayAccepted ? 'smtp.test_succeeded' : 'smtp.test_rejected',
            entity: 'email',
            metadata: {
                correlationId,
                host: smtp.host,
                port: smtp.port,
                secure: smtp.secure,
                requireTLS: smtp.requireTLS,
                acceptedCount: acceptedRecipients.length,
                rejectedCount: rejectedRecipients.length,
                responseStatus,
                messageId,
            },
        });
        if (!relayAccepted) {
            return NextResponse.json({
                success: false,
                ...result,
                category: 'smtp_response',
                error: 'The SMTP server did not accept the test recipient for relay. Review the rejected-recipient and response details.',
            }, { status: 502 });
        }
        return NextResponse.json({
            success: true,
            ...result,
            message: 'The SMTP server accepted the message for relay. This does not prove final delivery to the mailbox.',
        });
    } catch (error: unknown) {
        const message = formatSmtpError(error, smtp);
        const category = smtpFailureCategory(error);
        const metadata = { correlationId, category, host: smtp?.host, port: smtp?.port, secure: smtp?.secure, requireTLS: smtp?.requireTLS };
        logger.error('SMTP delivery test failed', { ...metadata, error: message });
        await auditLog({ userId: actorId, action: 'smtp.test_failed', entity: 'email', metadata: { ...metadata, error: message } });
        return NextResponse.json({ success: false, correlationId, stage: 'send', category, error: message }, { status: 502 });
    }
}