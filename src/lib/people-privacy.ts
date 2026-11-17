import { z } from 'zod';
import type { Role } from '@prisma/client';

/**
 * Who may see a person's contact and profile details (email, preferred language, job title).
 *
 * Identity (name, photo, role label, relevant department) is always visible to anyone who
 * legitimately sees the person. Contact fields follow an organisation-wide policy chosen by
 * a Super Admin, evaluated on top of a working relationship:
 *
 * - callers only evaluate people the viewer is already allowed to see (a ticket they can
 *   access, or staff in departments they belong to); this module never widens that;
 * - a department admin counts as an administrator only toward people reached through a
 *   department it administers, and as an agent everywhere else;
 * - Super Admins and the person themself always see everything;
 * - when `requesterVisibleToHandlers` is on (default), staff who can open a ticket always see
 *   its requester's details, whatever their roles: handling a request means contacting its author.
 */

export const PRIVACY_LEVELS = ['higher', 'same_or_higher', 'staff', 'everyone'] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

export const PRIVACY_FIELDS = ['email', 'language', 'jobTitle'] as const;
export type PrivacyField = (typeof PRIVACY_FIELDS)[number];

export type PeoplePrivacyPolicy = Record<PrivacyField, PrivacyLevel> & {
    /** Staff who can open a ticket always see its requester's details. */
    requesterVisibleToHandlers: boolean;
};

export const PEOPLE_PRIVACY_SETTING_KEY = 'people_privacy';

export const DEFAULT_PEOPLE_PRIVACY: PeoplePrivacyPolicy = Object.freeze({
    email: 'higher',
    language: 'higher',
    jobTitle: 'higher',
    requesterVisibleToHandlers: true,
});

export const peoplePrivacySchema = z.object({
    email: z.enum(PRIVACY_LEVELS),
    language: z.enum(PRIVACY_LEVELS),
    jobTitle: z.enum(PRIVACY_LEVELS),
    requesterVisibleToHandlers: z.boolean().default(true),
}).strict();

/** Stored JSON that is missing, malformed or partial falls back field by field to the safe default. */
export function parsePeoplePrivacy(value: string | null | undefined): PeoplePrivacyPolicy {
    if (!value) return { ...DEFAULT_PEOPLE_PRIVACY };
    try {
        const raw = JSON.parse(value) as Record<string, unknown>;
        const levels = Object.fromEntries(PRIVACY_FIELDS.map((field) => {
            const level = raw?.[field];
            return [field, PRIVACY_LEVELS.includes(level as PrivacyLevel) ? level : DEFAULT_PEOPLE_PRIVACY[field]];
        }));
        return {
            ...levels,
            requesterVisibleToHandlers: typeof raw?.requesterVisibleToHandlers === 'boolean' ? raw.requesterVisibleToHandlers : DEFAULT_PEOPLE_PRIVACY.requesterVisibleToHandlers,
        } as PeoplePrivacyPolicy;
    } catch {
        return { ...DEFAULT_PEOPLE_PRIVACY };
    }
}

const RANK: Record<Role, number> = { USER: 1, AGENT: 2, ADMIN: 3, SUPER_ADMIN: 4 };

export function roleRank(role: Role): number {
    return RANK[role];
}

export type PrivacyViewer = {
    id: string;
    role: Role;
    /** Departments this viewer administers (only meaningful for ADMIN). */
    administeredQueueIds: ReadonlySet<string>;
};

export type PrivacySubject = { id: string; role: Role };

/**
 * The viewer's rank toward one person. `contextQueueIds` are the departments through which
 * the viewer reaches that person: the ticket's department, or the person's departments.
 */
export function effectiveViewerRank(viewer: PrivacyViewer, contextQueueIds: readonly string[]): number {
    if (viewer.role === 'ADMIN') {
        return contextQueueIds.some((queueId) => viewer.administeredQueueIds.has(queueId)) ? RANK.ADMIN : RANK.AGENT;
    }
    return RANK[viewer.role];
}

export function levelAllows(level: PrivacyLevel, viewerRank: number, subjectRank: number, viewerIsStaff: boolean): boolean {
    switch (level) {
        case 'higher': return viewerRank > subjectRank;
        case 'same_or_higher': return viewerRank >= subjectRank;
        case 'staff': return viewerIsStaff;
        case 'everyone': return true;
    }
}

export type VisibleFields = Record<PrivacyField, boolean>;

export type VisibilityOptions = {
    /** The person is the requester of the ticket through which the viewer reaches them. */
    subjectIsTicketRequester?: boolean;
};

export function visibleFieldsFor(
    policy: PeoplePrivacyPolicy,
    viewer: PrivacyViewer,
    subject: PrivacySubject,
    contextQueueIds: readonly string[],
    options: VisibilityOptions = {},
): VisibleFields {
    if (viewer.id === subject.id || viewer.role === 'SUPER_ADMIN') {
        return { email: true, language: true, jobTitle: true };
    }
    if (options.subjectIsTicketRequester && viewer.role !== 'USER' && policy.requesterVisibleToHandlers) {
        return { email: true, language: true, jobTitle: true };
    }
    const viewerRank = effectiveViewerRank(viewer, contextQueueIds);
    const subjectRank = RANK[subject.role];
    const isStaff = viewer.role !== 'USER';
    return {
        email: levelAllows(policy.email, viewerRank, subjectRank, isStaff),
        language: levelAllows(policy.language, viewerRank, subjectRank, isStaff),
        jobTitle: levelAllows(policy.jobTitle, viewerRank, subjectRank, isStaff),
    };
}

/** Removes contact fields the viewer may not see. Unknown subject roles are treated as the most protected. */
export function redactPerson<T extends { id: string; email?: string | null; role?: Role | null; preferredLanguage?: string | null; jobTitle?: string | null }>(
    person: T,
    policy: PeoplePrivacyPolicy,
    viewer: PrivacyViewer,
    contextQueueIds: readonly string[],
    options: VisibilityOptions = {},
): T {
    const visible = visibleFieldsFor(policy, viewer, { id: person.id, role: person.role ?? 'SUPER_ADMIN' }, contextQueueIds, options);
    const copy: T = { ...person };
    if (!visible.email && 'email' in copy) delete copy.email;
    if (!visible.language && 'preferredLanguage' in copy) delete copy.preferredLanguage;
    if (!visible.jobTitle && 'jobTitle' in copy) delete copy.jobTitle;
    return copy;
}
