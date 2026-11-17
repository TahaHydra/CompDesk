import type { Role, TimelineEventType } from '@prisma/client';
import { canAdministerQueue } from '@/lib/permissions';

/**
 * Conversation moderation rules shared by the comment API and the ticket page.
 *
 * - Anyone may edit (within 24 hours) or delete their own conversation entries;
 *   requesters can never touch internal notes.
 * - Moderating someone else's entry requires administering the ticket's
 *   department (Super Admins administer every department). Holding the ADMIN
 *   role in some other department is not enough.
 * - Only a Super Admin may moderate a Super Admin's entries.
 */

export const OWN_ENTRY_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const CONVERSATION_TYPES: ReadonlySet<TimelineEventType> = new Set(['COMMENT', 'INTERNAL_NOTE']);

export type ModerationActor = { id: string; role: Role };

export type ModeratedEntry = {
    userId: string;
    type: TimelineEventType;
    createdAt: Date | string;
    deletedAt: Date | string | null;
    authorRole: Role | null;
};

/** Whether the actor administers the department that owns the ticket. */
export async function canModerateTicketConversation(actor: ModerationActor, ticket: { queueId: string }): Promise<boolean> {
    return canAdministerQueue(actor.id, actor.role, ticket.queueId);
}

function isOwnEntry(actor: ModerationActor, entry: ModeratedEntry): boolean {
    if (entry.userId !== actor.id) return false;
    if (entry.type === 'COMMENT') return true;
    return entry.type === 'INTERNAL_NOTE' && actor.role !== 'USER';
}

function moderatorOutranksAuthor(actor: ModerationActor, entry: ModeratedEntry): boolean {
    return entry.authorRole !== 'SUPER_ADMIN' || actor.role === 'SUPER_ADMIN';
}

export function canEditTimelineEntry(actor: ModerationActor, entry: ModeratedEntry, canModerate: boolean, now = Date.now()): boolean {
    if (entry.deletedAt || !CONVERSATION_TYPES.has(entry.type)) return false;
    if (canModerate && moderatorOutranksAuthor(actor, entry)) return true;
    if (!isOwnEntry(actor, entry)) return false;
    return now - new Date(entry.createdAt).getTime() <= OWN_ENTRY_EDIT_WINDOW_MS;
}

export function canDeleteTimelineEntry(actor: ModerationActor, entry: ModeratedEntry, canModerate: boolean): boolean {
    if (entry.deletedAt || !CONVERSATION_TYPES.has(entry.type)) return false;
    if (canModerate && moderatorOutranksAuthor(actor, entry)) return true;
    return isOwnEntry(actor, entry);
}

/**
 * Staff with ticket access may remove any attachment they can see. Requesters
 * may remove only files they uploaded themselves; a file with no recorded
 * uploader (older rows) cannot be attributed, so requesters cannot remove it.
 */
export function canDeleteTicketAttachment(actor: ModerationActor, attachment: { uploaderId: string | null; deletedAt: Date | string | null }, hasTicketAccess: boolean): boolean {
    if (!hasTicketAccess || attachment.deletedAt) return false;
    if (actor.role !== 'USER') return true;
    return attachment.uploaderId !== null && attachment.uploaderId === actor.id;
}
