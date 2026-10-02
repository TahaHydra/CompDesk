import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { canAccessTicket } from '@/lib/permissions';
import { sendEmail } from '@/lib/email';
import { translate } from '@/lib/i18n';
import logger from '@/lib/logger';

export const reminderTerminalStatuses = ['RESOLVED', 'CLOSED', 'WITHDRAWN'];
export function reminderRetryTime(attempts: number, now = Date.now()) { return new Date(now + Math.min(3600000, 60000 * 2 ** Math.max(0, attempts - 1))); }
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

/** Atomic leases coordinate all application replicas; completed occurrences remain persisted. */
export async function processTicketReminders() {
    const leaseToken = randomUUID();
    const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "ticket_reminders" SET "lease_token" = ${leaseToken}, "lease_until" = NOW() + INTERVAL '5 minutes', "attempts" = "attempts" + 1
        WHERE "id" IN (SELECT "id" FROM "ticket_reminders" WHERE "status" = 'PENDING' AND "scheduled_at" <= NOW()
        AND "next_attempt_at" <= NOW() AND ("lease_until" IS NULL OR "lease_until" < NOW()) ORDER BY "scheduled_at" FOR UPDATE SKIP LOCKED LIMIT 10)
        RETURNING "id"`;
    for (const { id } of claimed) {
        const reminder = await prisma.ticketReminder.findUnique({ where: { id }, include: { user: { select: { id: true, email: true, role: true, isActive: true, preferredLanguage: true } }, ticket: { select: { id: true, key: true, title: true, status: true, queueId: true, requesterId: true } } } });
        if (!reminder || reminder.status !== 'PENDING' || reminder.leaseToken !== leaseToken) continue;
        const where = { id, status: 'PENDING', leaseToken };
        // A batch can wait behind slow mail requests. Renew only if this worker still owns it.
        const owned = await prisma.ticketReminder.updateMany({ where, data: { leaseUntil: new Date(Date.now() + 300000) } });
        if (!owned.count) continue;
        if (!reminder.user.isActive || reminderTerminalStatuses.includes(reminder.ticket.status) || !await canAccessTicket(reminder.userId, reminder.user.role, reminder.ticket)) {
            await prisma.ticketReminder.updateMany({ where, data: { status: 'CANCELLED', leaseToken: null, leaseUntil: null } }); continue;
        }
        // Bell publication is idempotent. Email can be retried after provider/network failures.
        if (!reminder.deliveredAt) await prisma.ticketReminder.updateMany({ where, data: { deliveredAt: new Date() } });
        let accepted = reminder.emailAccepted;
        if (reminder.email && !accepted && reminder.attempts <= 5) {
            const heading = translate(reminder.user.preferredLanguage === 'fr' ? 'fr' : 'en', 'Ticket reminder');
            const base = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || '').replace(/\/$/, '');
            const link = /^https?:\/\//.test(base) ? `${base}/tickets/${encodeURIComponent(reminder.ticketId)}` : '';
            accepted = await sendEmail({ to: reminder.user.email, subject: `${heading}: ${reminder.ticket.key}`, html: `<h2>${escape(heading)}</h2><p>${escape(reminder.ticket.title)}</p><p>${escape(reminder.note)}</p>${link ? `<a href="${escape(link)}">${escape(reminder.ticket.key)}</a>` : ''}`, text: `${heading}: ${reminder.ticket.key}\n${reminder.ticket.title}\n${reminder.note}\n${link}` });
        }
        const complete = !reminder.email || accepted;
        await prisma.ticketReminder.updateMany({ where, data: { emailAccepted: accepted, status: complete ? 'DELIVERED' : reminder.attempts >= 5 ? 'FAILED' : 'PENDING', nextAttemptAt: reminderRetryTime(reminder.attempts), leaseToken: null, leaseUntil: null } });
    }
}
export function startTicketReminderWorker() {
    if (timer) return;
    const tick = async () => { if (running) return; running = true; try { await processTicketReminders(); } catch { logger.error('Ticket reminder worker failed; persisted leases will expire'); } finally { running = false; } };
    timer = setInterval(() => void tick(), 60000); timer.unref(); void tick();
}
