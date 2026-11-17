import { z } from 'zod';
import type { Role } from '@prisma/client';
import { isAgentOrAbove } from '@/lib/utils';

/** Same ceiling as a reply (createCommentSchema), so any saved reply can be sent as-is. */
export const SAVED_REPLY_CONTENT_MAX = 10000;
export const SAVED_REPLY_TITLE_MAX = 80;
export const SAVED_REPLIES_PER_USER = 200;

export const savedReplyInputSchema = z.object({
    title: z.string().trim().min(1).max(SAVED_REPLY_TITLE_MAX),
    content: z.string().trim().min(1).max(SAVED_REPLY_CONTENT_MAX),
}).strict();

export const savedReplyUpdateSchema = savedReplyInputSchema.partial().strict()
    .refine((value) => value.title !== undefined || value.content !== undefined, { message: 'Nothing to update' });

/** Saved replies are a staff tool; requesters never see them. */
export function canUseSavedReplies(role: Role): boolean {
    return isAgentOrAbove(role);
}

export const SAVED_REPLY_SELECT = {
    id: true,
    title: true,
    content: true,
    useCount: true,
    lastUsedAt: true,
    updatedAt: true,
} as const;

/** Inserts text at the caret (or over the selection) and returns the new value and caret position. */
export function insertAtSelection(value: string, insert: string, selectionStart: number | null, selectionEnd: number | null) {
    const start = Math.max(0, Math.min(selectionStart ?? value.length, value.length));
    const end = Math.max(start, Math.min(selectionEnd ?? start, value.length));
    const before = value.slice(0, start);
    const after = value.slice(end);
    // Keep words apart when dropped mid-text; punctuation after the caret still attaches.
    const prefix = before && !/\s$/.test(before) ? ' ' : '';
    const suffix = /^[\p{L}\p{N}]/u.test(after) && !/\s$/.test(insert) ? ' ' : '';
    const next = `${before}${prefix}${insert}${suffix}${after}`;
    return { value: next, caret: before.length + prefix.length + insert.length };
}
