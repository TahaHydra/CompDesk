import nodemailer from 'nodemailer';
import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getBrandingConfig, type BrandingConfig } from '@/lib/branding';
import { auditLog } from '@/lib/audit';
import { classifyNetworkError } from '@/lib/network-error';
import { decryptSettingSecret, getEnvironmentSmtpPassword } from '@/lib/settings-secret';
import { isValidSmtpFrom, validateSmtpSecurityCombination } from '@/lib/settings-validation';

interface EmailOptions {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
}

export interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    requireTLS: boolean;
    user?: string;
    pass?: string;
    from: string;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character] ?? character);
}

function booleanSetting(value: string | undefined, fallback: boolean): boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
}

export async function getSmtpConfig(branding: BrandingConfig): Promise<SmtpConfig> {
    void branding;
    let config: Record<string, string> = {};
    try {
        const settings = await prisma.appSetting.findMany({ where: { key: { startsWith: 'smtp_' } } });
        config = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
    } catch {
        config = {};
    }
    const secure = booleanSetting(config.smtp_secure ?? process.env.SMTP_SECURE, false);
    const requireTLS = booleanSetting(config.smtp_require_tls ?? process.env.SMTP_REQUIRE_TLS, !secure);
    const storedPassword = config.smtp_password ? decryptSettingSecret(config.smtp_password) : undefined;
    const environmentPassword = getEnvironmentSmtpPassword();
    return {
        host: config.smtp_host || process.env.SMTP_HOST || 'smtp.office365.com',
        port: Number.parseInt(config.smtp_port || process.env.SMTP_PORT || '587', 10),
        secure,
        requireTLS,
        user: config.smtp_user || process.env.SMTP_USER,
        pass: environmentPassword || storedPassword,
        from: config.smtp_from || process.env.SMTP_FROM || '',
    };
}

export function createSmtpTransport(smtp: SmtpConfig) {
    if (!smtp.host || !smtp.user || !smtp.pass) throw new Error('SMTP is not configured. Fill in the host, user, and password.');
    if (!Number.isInteger(smtp.port) || smtp.port < 1 || smtp.port > 65535) throw new Error('SMTP port must be between 1 and 65535.');
    validateSmtpSecurityCombination(smtp);
    return nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        requireTLS: smtp.requireTLS,
        auth: { user: smtp.user, pass: smtp.pass },
        tls: { rejectUnauthorized: true },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
    });
}

export function requireValidSmtpFrom(smtp: SmtpConfig): void {
    if (!isValidSmtpFrom(smtp.from)) throw new Error('A valid SMTP From address is required before sending email.');
}

export function formatSmtpError(error: unknown, smtp?: { host: string; port: number }): string {
    const target = smtp ? `${smtp.host}:${smtp.port}` : 'the SMTP server';
    const failure = classifyNetworkError(error);
    if (failure.code === 'EACCES') return `Connection to ${target} was blocked by the operating system or container network policy. Allow outbound TCP access for the application process, then retry.`;
    if (failure.category === 'dns') return `DNS resolution failed for ${target}. Check the SMTP host name.`;
    if (failure.category === 'tcp_connectivity') return `TCP connectivity to ${target} failed. Check the port, outbound network policy, and service availability.`;
    if (failure.category === 'timeout') return `Connection to ${target} timed out. Check outbound network access and firewall rules.`;
    if (failure.category === 'tls_certificate') return `TLS or certificate validation failed for ${target}. Certificate verification remains enabled.`;
    if (failure.category === 'authentication') return 'The SMTP server rejected authentication. Check the account and whether SMTP authentication is enabled.';
    if (failure.category === 'proxy_connect') return `A proxy or CONNECT tunnel failed while reaching ${target}.`;
    return error instanceof Error && !/pass(word)?|secret|token/i.test(error.message) ? error.message : 'Unknown mail transport error';
}

export function smtpFailureCategory(error: unknown) {
    return classifyNetworkError(error).category;
}
async function isEmailEventEnabled(eventKey: string): Promise<boolean> {
    try {
        const setting = await prisma.appSetting.findUnique({ where: { key: eventKey } });
        return setting?.value === 'true';
    } catch {
        return false;
    }
}

function absoluteAssetUrl(pathname: string): string {
    if (!pathname) return '';
    const baseUrl = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
    return baseUrl ? `${baseUrl}${pathname}` : '';
}

function brandedEmail(branding: BrandingConfig, heading: string, content: string): string {
    const logoUrl = absoluteAssetUrl(branding.mainLogoUrl || branding.lightLogoUrl);
    const identity = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(branding.applicationName)}" style="display:block;max-height:48px;max-width:220px;object-fit:contain;" />`
        : `<h1 style="color:white;margin:0;font-size:20px;">${escapeHtml(branding.applicationName)}</h1>`;
    const footer = branding.footerText || (branding.supportEmail ? `Support: ${branding.supportEmail}` : '');
    return `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,${branding.primaryColor},${branding.accentColor});padding:24px;border-radius:12px 12px 0 0;">${identity}</div>
        <div style="padding:24px;background:#f8fafc;border-radius:0 0 12px 12px;">
          <h2 style="color:#1e293b;margin-top:0;">${escapeHtml(heading)}</h2>
          ${content}
          ${footer ? `<p style="color:#64748b;font-size:12px;margin-top:20px;">${escapeHtml(footer)}</p>` : ''}
        </div>
      </div>`;
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
    let smtp: Awaited<ReturnType<typeof getSmtpConfig>> | undefined;
    const recipients = [...new Set((Array.isArray(options.to) ? options.to : [options.to]).map((email) => email.trim()).filter(Boolean))];
    try {
        const branding = await getBrandingConfig();
        smtp = await getSmtpConfig(branding);
        requireValidSmtpFrom(smtp);
        if (!smtp.user || !smtp.pass) {
            const message = 'SMTP credentials not configured, skipping email send';
            logger.warn(message, { subject: options.subject, recipientCount: recipients.length });
            await auditLog({ action: 'email.delivery_skipped', entity: 'email', metadata: { reason: message, subject: options.subject, recipientCount: recipients.length } });
            return false;
        }
        if (recipients.length === 0) {
            logger.warn('Email has no recipients, skipping send', { subject: options.subject });
            return false;
        }

        const transporter = createSmtpTransport(smtp);
        const failures: Array<{ recipient: string; message: string }> = [];
        let sentCount = 0;
        for (const recipient of recipients) {
            try {
                await transporter.sendMail({
                    from: smtp.from,
                    to: recipient,
                    subject: options.subject,
                    html: options.html,
                    text: options.text,
                });
                sentCount += 1;
            } catch (error) {
                failures.push({ recipient, message: formatSmtpError(error, smtp) });
            }
        }

        if (failures.length > 0) {
            const message = failures[0].message;
            logger.error('Failed to send email', { error: message, subject: options.subject, sentCount, failedCount: failures.length });
            await auditLog({
                action: 'email.delivery_failed',
                entity: 'email',
                metadata: { subject: options.subject, host: smtp.host, port: smtp.port, sentCount, failedCount: failures.length, error: message },
            });
            return false;
        }

        logger.info('Email sent successfully', { subject: options.subject, recipientCount: sentCount });
        await auditLog({ action: 'email.delivery_succeeded', entity: 'email', metadata: { subject: options.subject, recipientCount: sentCount } });
        return true;
    } catch (error) {
        const message = formatSmtpError(error, smtp);
        logger.error('Failed to send email', { error: message, subject: options.subject, recipientCount: recipients.length });
        await auditLog({
            action: 'email.delivery_failed',
            entity: 'email',
            metadata: { subject: options.subject, host: smtp?.host, port: smtp?.port, failedCount: recipients.length, error: message },
        });
        return false;
    }
}

export async function sendTicketCreatedEmail(userEmail: string, ticketKey: string, ticketTitle: string) {
    if (!(await isEmailEventEnabled('email_on_ticket_created'))) return false;
    const branding = await getBrandingConfig();
    return sendEmail({
        to: userEmail,
        subject: `[${ticketKey}] Ticket Created: ${ticketTitle}`,
        html: brandedEmail(branding, 'Ticket Created', `
          <p style="color:#475569;">Your ticket <strong>${escapeHtml(ticketKey)}</strong> has been created successfully.</p>
          <div style="background:white;padding:16px;border-radius:8px;border:1px solid #e2e8f0;"><p style="margin:0;color:#1e293b;"><strong>Title:</strong> ${escapeHtml(ticketTitle)}</p></div>
          <p style="color:#64748b;font-size:12px;margin-top:16px;">You will be notified of updates to this ticket.</p>`),
    });
}

export async function sendTicketAssignedEmail(agentEmail: string, ticketKey: string, ticketTitle: string) {
    if (!(await isEmailEventEnabled('email_on_ticket_assigned'))) return false;
    const branding = await getBrandingConfig();
    return sendEmail({
        to: agentEmail,
        subject: `[${ticketKey}] Ticket Assigned to You: ${ticketTitle}`,
        html: brandedEmail(branding, 'Ticket Assigned', `
          <p style="color:#475569;">Ticket <strong>${escapeHtml(ticketKey)}</strong> has been assigned to you.</p>
          <div style="background:white;padding:16px;border-radius:8px;border:1px solid #e2e8f0;"><p style="margin:0;color:#1e293b;"><strong>Title:</strong> ${escapeHtml(ticketTitle)}</p></div>`),
    });
}

export async function sendTicketUpdatedEmail(
    emails: string[], ticketKey: string, ticketTitle: string, updateType: string, details: string
) {
    if (!(await isEmailEventEnabled('email_on_ticket_updated'))) return false;
    const branding = await getBrandingConfig();
    return sendEmail({
        to: emails,
        subject: `[${ticketKey}] ${updateType}: ${ticketTitle}`,
        html: brandedEmail(branding, updateType, `
          <p style="color:#475569;">Ticket <strong>${escapeHtml(ticketKey)}</strong> has been updated.</p>
          <div style="background:white;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">
            <p style="margin:0;color:#1e293b;"><strong>Title:</strong> ${escapeHtml(ticketTitle)}</p>
            <p style="margin:8px 0 0;color:#475569;">${escapeHtml(details)}</p>
          </div>`),
    });
}

export async function sendNewCommentEmail(
    emails: string[], ticketKey: string, ticketTitle: string, excerpt: string
) {
    if (!(await isEmailEventEnabled('email_on_new_comment'))) return false;
    const branding = await getBrandingConfig();
    return sendEmail({
        to: emails,
        subject: `[${ticketKey}] New Comment: ${ticketTitle}`,
        html: brandedEmail(branding, 'New Comment', `
          <p style="color:#475569;">A new public comment was added to ticket <strong>${escapeHtml(ticketKey)}</strong>.</p>
          <div style="background:white;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">
            <p style="margin:0;color:#1e293b;"><strong>Title:</strong> ${escapeHtml(ticketTitle)}</p>
            <p style="margin:8px 0 0;color:#475569;">${escapeHtml(excerpt)}</p>
          </div>`),
    });
}
export async function sendNewTicketForDepartmentEmail(
    agentEmails: string[], ticketKey: string, ticketTitle: string, departmentName: string
) {
    if (!(await isEmailEventEnabled('email_on_ticket_created'))) return false;
    const branding = await getBrandingConfig();
    return sendEmail({
        to: agentEmails,
        subject: `[${ticketKey}] New Ticket in ${departmentName}: ${ticketTitle}`,
        html: brandedEmail(branding, `New Ticket in ${departmentName}`, `
          <p style="color:#475569;">A new ticket <strong>${escapeHtml(ticketKey)}</strong> needs attention.</p>
          <div style="background:white;padding:16px;border-radius:8px;border:1px solid #e2e8f0;">
            <p style="margin:0;color:#1e293b;"><strong>Title:</strong> ${escapeHtml(ticketTitle)}</p>
            <p style="margin:8px 0 0;color:#475569;"><strong>Department:</strong> ${escapeHtml(departmentName)}</p>
          </div>
          <p style="color:#64748b;font-size:12px;margin-top:16px;">Sign in to ${escapeHtml(branding.applicationName)} to claim this ticket.</p>`),
    });
}

export async function sendTicketReminderEmail(
    requesterEmail: string,
    requesterName: string,
    ticketId: string,
    ticketKey: string,
    ticketTitle: string
) {
    const branding = await getBrandingConfig();
    const baseUrl = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
    const ticketUrl = baseUrl ? `${baseUrl}/tickets/${encodeURIComponent(ticketId)}` : '';
    const action = ticketUrl
        ? `<p style="margin-top:20px;"><a href="${escapeHtml(ticketUrl)}" style="display:inline-block;background:${branding.primaryColor};color:white;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;">View ticket and reply</a></p>`
        : `<p style="color:#64748b;font-size:12px;margin-top:16px;">Sign in to ${escapeHtml(branding.applicationName)} to view the ticket and reply.</p>`;
    return sendEmail({
        to: requesterEmail,
        subject: `[${ticketKey}] Response requested: ${ticketTitle}`,
        text: `Hello ${requesterName}, your response is needed for ticket ${ticketKey}: ${ticketTitle}.${ticketUrl ? ` ${ticketUrl}` : ''}`,
        html: brandedEmail(branding, "We're waiting for your response", `
          <p style="color:#475569;">Hello ${escapeHtml(requesterName)},</p>
          <p style="color:#475569;">The support team is waiting for your response on ticket <strong>${escapeHtml(ticketKey)}</strong>.</p>
          <div style="background:white;padding:16px;border-radius:8px;border:1px solid #e2e8f0;"><p style="margin:0;color:#1e293b;"><strong>Title:</strong> ${escapeHtml(ticketTitle)}</p></div>
          ${action}`),
    });
}
