import nodemailer from 'nodemailer';
import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';

interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

// Load SMTP config from DB (fallback to env vars)
async function getSmtpConfig() {
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { startsWith: 'smtp_' } },
    });
    const cfg: Record<string, string> = {};
    settings.forEach((s) => { cfg[s.key] = s.value; });

    return {
      host: cfg.smtp_host || process.env.SMTP_HOST || 'smtp.office365.com',
      port: parseInt(cfg.smtp_port || process.env.SMTP_PORT || '587', 10),
      secure: (cfg.smtp_secure || process.env.SMTP_SECURE) === 'true',
      user: cfg.smtp_user || process.env.SMTP_USER,
      pass: cfg.smtp_password || process.env.SMTP_PASS,
      from: cfg.smtp_from || process.env.SMTP_FROM || 'ExcoDesk <noreply@example.com>',
    };
  } catch {
    return {
      host: process.env.SMTP_HOST || 'smtp.office365.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM || 'ExcoDesk <noreply@example.com>',
    };
  }
}

// Check if a specific email event is enabled (default: true)
async function isEmailEventEnabled(eventKey: string): Promise<boolean> {
  try {
    const setting = await prisma.appSetting.findUnique({ where: { key: eventKey } });
    return setting?.value !== 'false'; // default true if not set
  } catch {
    return true;
  }
}

export async function sendEmail(options: EmailOptions): Promise<boolean> {
  try {
    const smtp = await getSmtpConfig();

    if (!smtp.user || !smtp.pass) {
      logger.warn('SMTP credentials not configured, skipping email send', {
        subject: options.subject,
      });
      return false;
    }

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
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

export async function sendTicketCreatedEmail(
  userEmail: string,
  ticketKey: string,
  ticketTitle: string
) {
  if (!(await isEmailEventEnabled('email_on_ticket_created'))) return false;

  return sendEmail({
    to: userEmail,
    subject: `[${ticketKey}] Ticket Created: ${ticketTitle}`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">ExcoDesk</h1>
        </div>
        <div style="padding: 24px; background: #f8fafc; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1e293b; margin-top: 0;">Ticket Created</h2>
          <p style="color: #475569;">Your ticket <strong>${ticketKey}</strong> has been created successfully.</p>
          <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #1e293b;"><strong>Title:</strong> ${ticketTitle}</p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">You will be notified of any updates to this ticket.</p>
        </div>
      </div>
    `,
  });
}

export async function sendTicketAssignedEmail(
  agentEmail: string,
  ticketKey: string,
  ticketTitle: string
) {
  if (!(await isEmailEventEnabled('email_on_ticket_assigned'))) return false;

  return sendEmail({
    to: agentEmail,
    subject: `[${ticketKey}] Ticket Assigned to You: ${ticketTitle}`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">ExcoDesk</h1>
        </div>
        <div style="padding: 24px; background: #f8fafc; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1e293b; margin-top: 0;">Ticket Assigned</h2>
          <p style="color: #475569;">Ticket <strong>${ticketKey}</strong> has been assigned to you.</p>
          <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #1e293b;"><strong>Title:</strong> ${ticketTitle}</p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">Please review and take action.</p>
        </div>
      </div>
    `,
  });
}

export async function sendTicketUpdatedEmail(
  emails: string[],
  ticketKey: string,
  ticketTitle: string,
  updateType: string,
  details: string
) {
  if (!(await isEmailEventEnabled('email_on_ticket_updated'))) return false;

  return sendEmail({
    to: emails,
    subject: `[${ticketKey}] ${updateType}: ${ticketTitle}`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">ExcoDesk</h1>
        </div>
        <div style="padding: 24px; background: #f8fafc; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1e293b; margin-top: 0;">${updateType}</h2>
          <p style="color: #475569;">Ticket <strong>${ticketKey}</strong> has been updated.</p>
          <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #1e293b;"><strong>Title:</strong> ${ticketTitle}</p>
            <p style="margin: 8px 0 0; color: #475569;">${details}</p>
          </div>
        </div>
      </div>
    `,
  });
}

export async function sendNewTicketForDepartmentEmail(
  agentEmails: string[],
  ticketKey: string,
  ticketTitle: string,
  departmentName: string
) {
  if (!(await isEmailEventEnabled('email_on_ticket_created'))) return false;

  return sendEmail({
    to: agentEmails,
    subject: `[${ticketKey}] New Ticket in ${departmentName}: ${ticketTitle}`,
    html: `
      <div style="font-family: 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 20px;">ExcoDesk</h1>
        </div>
        <div style="padding: 24px; background: #f8fafc; border-radius: 0 0 12px 12px;">
          <h2 style="color: #1e293b; margin-top: 0;">New Ticket in ${departmentName}</h2>
          <p style="color: #475569;">A new ticket <strong>${ticketKey}</strong> has been submitted and needs attention.</p>
          <div style="background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <p style="margin: 0; color: #1e293b;"><strong>Title:</strong> ${ticketTitle}</p>
            <p style="margin: 8px 0 0; color: #475569;"><strong>Department:</strong> ${departmentName}</p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 16px;">Log in to ExcoDesk to claim this ticket.</p>
        </div>
      </div>
    `,
  });
}
