import { Prisma, type Role } from '@prisma/client';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { sendTicketReminderEmail } from '@/lib/email';
import logger from '@/lib/logger';
import { canAccessTicket, isAgentRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { parseTicketReminderSettings, roleCanSendTicketReminder } from '@/lib/ticket-reminders';

const requestSchema = z.object({
    expectedVersion: z.number().int().positive(),
}).strict();
const emailSchema = z.string().email();
const SETTING_KEYS = [
    'ticket_reminders_enabled',
    'ticket_reminder_cooldown_hours',
    'ticket_reminder_max_per_cycle',
    'ticket_reminder_allow_agents',
    'ticket_reminder_allow_admins',
];
const PENDING_RESERVATION_MS = 2 * 60 * 1000;

class ReminderError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

type ReminderTicket = {
    id: string;
    key: string;
    title: string;
    status: string;
    version: number;
    queueId: string;
    requesterId: string;
    createdAt: Date;
    requester: { id: string; name: string; email: string; isActive: boolean };
};

async function loadReminderState(
    client: Prisma.TransactionClient | typeof prisma,
    ticket: ReminderTicket,
    role: Role,
    now = new Date()
) {
    const [settingsRows, pendingStarted] = await Promise.all([
        client.appSetting.findMany({ where: { key: { in: SETTING_KEYS } }, select: { key: true, value: true } }),
        client.timelineEvent.findFirst({
            where: {
                ticketId: ticket.id,
                type: 'STATUS_CHANGE',
                metadata: { path: ['to'], equals: 'PENDING_USER' },
            },
            select: { createdAt: true },
            orderBy: { createdAt: 'desc' },
        }),
    ]);
    const settings = parseTicketReminderSettings(Object.fromEntries(settingsRows.map((row) => [row.key, row.value])));
    const pendingSince = pendingStarted?.createdAt ?? ticket.createdAt;
    const requesterReply = await client.timelineEvent.findFirst({
        where: {
            ticketId: ticket.id,
            userId: ticket.requesterId,
            type: 'COMMENT',
            createdAt: { gte: pendingSince },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
    });
    const cycleStartedAt = requesterReply?.createdAt ?? pendingSince;
    const [reminderCount, lastReminder, pendingReminder] = await Promise.all([
        client.ticketReminder.count({ where: { ticketId: ticket.id, status: 'SENT', sentAt: { gte: cycleStartedAt } } }),
        client.ticketReminder.findFirst({
            where: { ticketId: ticket.id, status: 'SENT', sentAt: { gte: cycleStartedAt } },
            select: { sentAt: true },
            orderBy: { sentAt: 'desc' },
        }),
        client.ticketReminder.findFirst({
            where: { ticketId: ticket.id, status: 'PENDING', createdAt: { gte: new Date(now.getTime() - PENDING_RESERVATION_MS) } },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
        }),
    ]);
    const nextAvailableAt = lastReminder?.sentAt
        ? new Date(lastReminder.sentAt.getTime() + settings.cooldownHours * 60 * 60 * 1000)
        : null;

    let reason: string | null = null;
    if (!settings.enabled) reason = 'Ticket reminders are disabled by an administrator.';
    else if (!roleCanSendTicketReminder(role, settings)) reason = 'Your role is not allowed to send ticket reminders.';
    else if (ticket.status !== 'PENDING_USER') reason = 'Reminders can only be sent while a ticket is pending the requester.';
    else if (!ticket.requester.isActive) reason = 'The requester account is inactive.';
    else if (!emailSchema.safeParse(ticket.requester.email).success) reason = 'The requester does not have a valid email address.';
    else if (pendingReminder) reason = 'Another reminder delivery is already in progress.';
    else if (reminderCount >= settings.maxPerCycle) reason = 'The reminder limit for this waiting cycle has been reached.';
    else if (nextAvailableAt && nextAvailableAt > now) reason = 'The reminder cooldown is still active.';

    return {
        allowed: reason === null,
        reason,
        enabled: settings.enabled,
        reminderCount,
        maxPerCycle: settings.maxPerCycle,
        cooldownHours: settings.cooldownHours,
        lastReminderAt: lastReminder?.sentAt ?? null,
        nextAvailableAt,
        waitingSince: cycleStartedAt,
        deliveryInProgress: Boolean(pendingReminder),
        requester: { id: ticket.requester.id, name: ticket.requester.name },
    };
}

const ticketSelect = {
    id: true,
    key: true,
    title: true,
    status: true,
    version: true,
    queueId: true,
    requesterId: true,
    createdAt: true,
    requester: { select: { id: true, name: true, email: true, isActive: true } },
} satisfies Prisma.TicketSelect;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!isAgentRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { id } = await params;
        const ticket = await prisma.ticket.findUnique({ where: { id }, select: ticketSelect });
        if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        if (!(await canAccessTicket(session.user.id, session.user.role, ticket))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return NextResponse.json(await loadReminderState(prisma, ticket, session.user.role));
    } catch (error) {
        logger.error('Failed to load ticket reminder state', { error });
        return NextResponse.json({ error: 'Failed to load reminder availability' }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        if (!isAgentRole(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const parsed = requestSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return NextResponse.json({ error: 'A valid expectedVersion is required' }, { status: 400 });
        const { id } = await params;

        const reservation = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
            const ticket = await tx.ticket.findUnique({ where: { id }, select: ticketSelect });
            if (!ticket) throw new ReminderError('Ticket not found', 404);
            if (!(await canAccessTicket(session.user.id, session.user.role, ticket, tx))) throw new ReminderError('Forbidden', 403);
            if (ticket.version !== parsed.data.expectedVersion) {
                throw new ReminderError('Ticket changed since it was loaded. Refresh before sending a reminder.', 409);
            }
            await tx.ticketReminder.updateMany({
                where: { ticketId: ticket.id, status: 'PENDING', createdAt: { lt: new Date(Date.now() - PENDING_RESERVATION_MS) } },
                data: { status: 'FAILED', failedAt: new Date() },
            });
            const state = await loadReminderState(tx, ticket, session.user.role);
            if (!state.allowed) throw new ReminderError(state.reason ?? 'Reminder cannot be sent', 409);
            const reminder = await tx.ticketReminder.create({
                data: { ticketId: ticket.id, sentById: session.user.id, recipientId: ticket.requesterId },
                select: { id: true, createdAt: true },
            });
            return { reminder, ticket, state };
        });

        const delivered = await sendTicketReminderEmail(
            reservation.ticket.requester.email,
            reservation.ticket.requester.name,
            reservation.ticket.id,
            reservation.ticket.key,
            reservation.ticket.title
        );
        if (!delivered) {
            await prisma.ticketReminder.updateMany({
                where: { id: reservation.reminder.id, status: 'PENDING' },
                data: { status: 'FAILED', failedAt: new Date() },
            });
            throw new ReminderError('The reminder email could not be delivered. No reminder was recorded.', 502);
        }

        const sentAt = new Date();
        await prisma.$transaction(async (tx) => {
            const finalized = await tx.ticketReminder.updateMany({
                where: { id: reservation.reminder.id, status: 'PENDING' },
                data: { status: 'SENT', sentAt },
            });
            if (finalized.count !== 1) throw new Error('REMINDER_FINALIZATION_CONFLICT');
            await tx.timelineEvent.create({
                data: {
                    ticketId: reservation.ticket.id,
                    userId: session.user.id,
                    type: 'REMINDER_SENT',
                    content: `Reminder sent to requester ${reservation.ticket.requester.name}`,
                    metadata: {
                        reminderId: reservation.reminder.id,
                        recipientId: reservation.ticket.requesterId,
                        reminderNumber: reservation.state.reminderCount + 1,
                        maxPerCycle: reservation.state.maxPerCycle,
                    },
                },
            });
        });

        await auditLog({
            userId: session.user.id,
            action: 'ticket.reminder_sent',
            entity: 'ticket',
            entityId: reservation.ticket.id,
            metadata: {
                reminderId: reservation.reminder.id,
                ticketKey: reservation.ticket.key,
                recipientId: reservation.ticket.requesterId,
                reminderNumber: reservation.state.reminderCount + 1,
                maxPerCycle: reservation.state.maxPerCycle,
            },
        });
        return NextResponse.json({
            success: true,
            reminder: { id: reservation.reminder.id, sentAt },
            reminderCount: reservation.state.reminderCount + 1,
            maxPerCycle: reservation.state.maxPerCycle,
        }, { status: 201 });
    } catch (error) {
        if (error instanceof ReminderError) return NextResponse.json({ error: error.message }, { status: error.status });
        logger.error('Failed to send ticket reminder', { error });
        return NextResponse.json({ error: 'Failed to send ticket reminder' }, { status: 500 });
    }
}
