import type { Role } from '@prisma/client';

export const DEFAULT_TICKET_REMINDER_SETTINGS = {
    enabled: false,
    cooldownHours: 24,
    maxPerCycle: 3,
    allowAgents: true,
    allowAdmins: true,
} as const;

export type TicketReminderSettings = {
    enabled: boolean;
    cooldownHours: number;
    maxPerCycle: number;
    allowAgents: boolean;
    allowAdmins: boolean;
};

function booleanValue(value: string | undefined, fallback: boolean): boolean {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function parseTicketReminderSettings(values: Record<string, string>): TicketReminderSettings {
    return {
        enabled: booleanValue(values.ticket_reminders_enabled, DEFAULT_TICKET_REMINDER_SETTINGS.enabled),
        cooldownHours: boundedInteger(values.ticket_reminder_cooldown_hours, DEFAULT_TICKET_REMINDER_SETTINGS.cooldownHours, 1, 720),
        maxPerCycle: boundedInteger(values.ticket_reminder_max_per_cycle, DEFAULT_TICKET_REMINDER_SETTINGS.maxPerCycle, 1, 10),
        allowAgents: booleanValue(values.ticket_reminder_allow_agents, DEFAULT_TICKET_REMINDER_SETTINGS.allowAgents),
        allowAdmins: booleanValue(values.ticket_reminder_allow_admins, DEFAULT_TICKET_REMINDER_SETTINGS.allowAdmins),
    };
}

export function roleCanSendTicketReminder(role: Role, settings: TicketReminderSettings): boolean {
    if (role === 'SUPER_ADMIN') return true;
    if (role === 'ADMIN') return settings.allowAdmins;
    if (role === 'AGENT') return settings.allowAgents;
    return false;
}
