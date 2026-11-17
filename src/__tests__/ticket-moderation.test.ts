jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { canDeleteTicketAttachment, canDeleteTimelineEntry, canEditTimelineEntry, OWN_ENTRY_EDIT_WINDOW_MS } from '@/lib/ticket-moderation';
import type { ModeratedEntry, ModerationActor } from '@/lib/ticket-moderation';

const now = Date.UTC(2026, 10, 17, 12);
const entry = (overrides: Partial<ModeratedEntry> = {}): ModeratedEntry => ({
    userId: 'author',
    type: 'COMMENT',
    createdAt: new Date(now - 60_000),
    deletedAt: null,
    authorRole: 'AGENT',
    ...overrides,
});
const actor = (role: ModerationActor['role'], id = 'actor'): ModerationActor => ({ id, role });

describe('conversation moderation rules', () => {
    it('lets authors edit within 24 hours and delete their own replies', () => {
        const own = entry({ userId: 'actor' });
        expect(canEditTimelineEntry(actor('AGENT'), own, false, now)).toBe(true);
        expect(canDeleteTimelineEntry(actor('AGENT'), own, false)).toBe(true);
        const old = entry({ userId: 'actor', createdAt: new Date(now - OWN_ENTRY_EDIT_WINDOW_MS - 1) });
        expect(canEditTimelineEntry(actor('AGENT'), old, false, now)).toBe(false);
        expect(canDeleteTimelineEntry(actor('AGENT'), old, false)).toBe(true);
    });

    it('never lets requesters touch internal notes, even ones attributed to them', () => {
        const note = entry({ userId: 'actor', type: 'INTERNAL_NOTE', authorRole: 'USER' });
        expect(canEditTimelineEntry(actor('USER'), note, false, now)).toBe(false);
        expect(canDeleteTimelineEntry(actor('USER'), note, false)).toBe(false);
    });

    it('requires administering the ticket department to moderate others', () => {
        expect(canDeleteTimelineEntry(actor('ADMIN'), entry(), false)).toBe(false);
        expect(canEditTimelineEntry(actor('ADMIN'), entry(), false, now)).toBe(false);
        expect(canDeleteTimelineEntry(actor('ADMIN'), entry(), true)).toBe(true);
        // Moderators are not bound by the author edit window.
        expect(canEditTimelineEntry(actor('ADMIN'), entry({ createdAt: new Date(0) }), true, now)).toBe(true);
    });

    it('protects Super Admin entries from department administrators only', () => {
        const superAdminEntry = entry({ authorRole: 'SUPER_ADMIN' });
        expect(canDeleteTimelineEntry(actor('ADMIN'), superAdminEntry, true)).toBe(false);
        expect(canEditTimelineEntry(actor('ADMIN'), superAdminEntry, true, now)).toBe(false);
        expect(canDeleteTimelineEntry(actor('SUPER_ADMIN'), superAdminEntry, true)).toBe(true);
    });

    it('never offers changes to system events or deleted entries', () => {
        expect(canDeleteTimelineEntry(actor('SUPER_ADMIN'), entry({ type: 'STATUS_CHANGE' }), true)).toBe(false);
        expect(canEditTimelineEntry(actor('SUPER_ADMIN'), entry({ deletedAt: new Date(now) }), true, now)).toBe(false);
    });
});

describe('attachment removal rules', () => {
    const live = { uploaderId: 'actor', deletedAt: null };

    it('lets requesters remove only files they uploaded', () => {
        expect(canDeleteTicketAttachment(actor('USER'), live, true)).toBe(true);
        expect(canDeleteTicketAttachment(actor('USER'), { ...live, uploaderId: 'agent' }, true)).toBe(false);
    });

    it('refuses requesters when the uploader is unknown', () => {
        expect(canDeleteTicketAttachment(actor('USER'), { ...live, uploaderId: null }, true)).toBe(false);
    });

    it('keeps staff removal and always requires ticket access', () => {
        expect(canDeleteTicketAttachment(actor('AGENT'), { ...live, uploaderId: 'requester' }, true)).toBe(true);
        expect(canDeleteTicketAttachment(actor('AGENT'), live, false)).toBe(false);
        expect(canDeleteTicketAttachment(actor('SUPER_ADMIN'), { ...live, deletedAt: new Date(now) }, true)).toBe(false);
    });
});
