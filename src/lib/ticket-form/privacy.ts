import { BuiltInTicketField, type Role } from '@prisma/client';
import { parseTicketFormSchemaSnapshot } from '@/lib/ticket-form/validation';

type HistoricalTicket = { formSchemaSnapshot?: unknown; submittedFormValues?: unknown };
type AttachmentIdentity = { id: string; path?: string; filename?: string; size?: number; isInternal?: boolean };
const aliases = { TITLE: 'title', DESCRIPTION: 'description', PRIORITY: 'priority', SEVERITY: 'severity', TAGS: 'tags', ATTACHMENTS: 'attachments' } as const;

export function ticketBuiltInAllowed(ticket: HistoricalTicket, builtIn: BuiltInTicketField, role: Role, editing = false): boolean {
    const fields = parseTicketFormSchemaSnapshot(ticket.formSchemaSnapshot)?.fields.filter((candidate) => candidate.builtIn === builtIn || candidate.fieldKey === aliases[builtIn]) ?? [];
    // Tickets predating snapshots retain the ordinary ticket-column permissions.
    return fields.every((field) => field.isActive && field.visibleTo.includes(role) && (!editing || field.editableBy.includes(role)));
}

export function projectTicketBuiltIns<T extends HistoricalTicket>(ticket: T, role: Role): T {
    const projected: Record<string, unknown> = { ...ticket };
    for (const [builtIn, alias] of Object.entries(aliases)) {
        if (Object.prototype.hasOwnProperty.call(ticket, alias) && !ticketBuiltInAllowed(ticket, builtIn as BuiltInTicketField, role)) {
            projected[alias] = alias === 'title' ? 'Support request' : alias === 'tags' || alias === 'attachments' ? [] : null;
        }
    }
    return projected as T;
}

/** Mail/timeline fanout has multiple audiences. A restricted title must never be copied there. */
export function ticketPublicTitle(ticket: HistoricalTicket & { title: string }): string {
    const fields = parseTicketFormSchemaSnapshot(ticket.formSchemaSnapshot)?.fields.filter((candidate) => candidate.builtIn === 'TITLE' || candidate.fieldKey === 'title') ?? [];
    return fields.some((field) => !field.isActive || ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'].some((role) => !field.visibleTo.includes(role as Role))) ? 'Support request' : ticket.title;
}

export function projectTicketTimelineEvent<T extends { type: string; content: string | null; metadata?: unknown }>(ticket: HistoricalTicket, event: T, role: Role): T {
    if (event.type === 'CREATED' && !ticketBuiltInAllowed(ticket, BuiltInTicketField.TITLE, role)) return { ...event, content: 'Ticket created' };
    if (!ticketBuiltInAllowed(ticket, BuiltInTicketField.PRIORITY, role)) {
        if (event.type === 'PRIORITY_CHANGE') return { ...event, content: 'Priority changed', metadata: {} };
        if (event.type === 'ESCALATED' && event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)) {
            const metadata = { ...event.metadata as Record<string, unknown> };
            delete metadata.priority;
            return { ...event, metadata };
        }
    }
    return event;
}

export function projectPublicTicketTimelineEvent<T extends { type: string; content: string | null; metadata?: unknown }>(ticket: HistoricalTicket, event: T): T {
    return (['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] as const).reduce((projected, role) => projectTicketTimelineEvent(ticket, projected, role), event);
}

/** Form files retain the intersection of every referencing field's immutable permissions. */
export function ticketAttachmentVisibleToRole(ticket: HistoricalTicket, attachment: AttachmentIdentity, role: Role, editing = false): boolean {
    if (attachment.isInternal && role === 'USER') return false;
    const snapshot = parseTicketFormSchemaSnapshot(ticket.formSchemaSnapshot);
    const values = ticket.submittedFormValues && typeof ticket.submittedFormValues === 'object' && !Array.isArray(ticket.submittedFormValues)
        ? ticket.submittedFormValues as Record<string, unknown> : {};
    const matchingFields = snapshot?.fields.filter((field) => field.type === 'FILE' && Array.isArray(values[field.fieldKey]) && (values[field.fieldKey] as unknown[]).some((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const file = item as Record<string, unknown>;
        if (file.url === `/api/upload/${encodeURIComponent(attachment.id)}` || attachment.path && file.url === attachment.path) return true;
        // Older stored form values may contain stale storage paths; conservatively match their identity.
        return typeof file.url === 'string' && !file.url.startsWith('/api/upload/')
            && attachment.filename !== undefined && attachment.size !== undefined
            && file.filename === attachment.filename && file.size === attachment.size;
    })) ?? [];
    return matchingFields.every((field) => field.isActive && field.visibleTo.includes(role) && (!editing || field.editableBy.includes(role)));
}

export function projectFormFileValues(ticket: HistoricalTicket, value: unknown, role: Role): unknown {
    if (!Array.isArray(value)) return value;
    return value.filter((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
        const file = item as Record<string, unknown>;
        const url = typeof file.url === 'string' ? file.url : '';
        const id = /^\/api\/upload\/([^/?#]+)$/.exec(url)?.[1];
        return ticketAttachmentVisibleToRole(ticket, { id: id ? decodeURIComponent(id) : '', path: url, filename: typeof file.filename === 'string' ? file.filename : undefined, size: typeof file.size === 'number' ? file.size : undefined }, role);
    });
}
