import nodemailer from 'nodemailer';
import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { getBrandingConfig, type BrandingConfig } from '@/lib/branding';

interface EmailOptions {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character] ?? character);
}

async function getSmtpConfig(branding: BrandingConfig) {
    try {
        const settings = await prisma.appSetting.findMany({ where: { key: { startsWith: 'smtp_' } } });
        const config = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
        return {
            host: config.smtp_host || process.env.SMTP_HOST || 'smtp.office365.com',
            port: Number.parseInt(config.smtp_port || process.env.SMTP_PORT || '587', 10),
            secure: (config.smtp_secure || process.env.SMTP_SECURE) === 'true',
            user: config.smtp_user || process.env.SMTP_USER,
            pass: config.smtp_password || process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
            from: config.smtp_from || process.env.SMTP_FROM || `${branding.applicationName} <noreply@example.com>`,
        };
    } catch {
        return {
            host: process.env.SMTP_HOST || 'smtp.office365.com',
            port: Number.parseInt(process.env.SMTP_PORT || '587', 10),
            secure: process.env.SMTP_SECURE === 'true',
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD,
            from: process.env.SMTP_FROM || `${branding.applicationName} <noreply@example.com>`,
        };
    }
}

async function isEmailEventEnabled(eventKey: string): Promise<boolean> {
    try {
        const setting = await prisma.appSetting.findUnique({ where: { key: eventKey } });
        return setting?.value !== 'false';
    } catch {
        return true;
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
    try {
        const branding = await getBrandingConfig();
        const smtp = await getSmtpConfig(branding);
        if (!smtp.user || !smtp.pass) {
            logger.warn('SMTP credentials not configured, skipping email send', { subject: options.subject });
            return false;
        }
        const transporter = nodemailer.createTransport({
            host: smtp.host, port: smtp.port, secure: smtp.secure,
            auth: { user: smtp.user, pass: smtp.pass },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000,
        });
        await transporter.sendMail({
            from: smtp.from,
            to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
        });
        logger.info('Email sent successfully', { to: options.to, subject: options.subject });
        return true;
    } catch (error) {
        logger.error('Failed to send email', {
            error: error instanceof Error ? error.message : error,
            to: options.to,
            subject: options.subject,
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