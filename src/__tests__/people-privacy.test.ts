import {
    DEFAULT_PEOPLE_PRIVACY,
    parsePeoplePrivacy,
    redactPerson,
    visibleFieldsFor,
    type PeoplePrivacyPolicy,
    type PrivacyViewer,
} from '@/lib/people-privacy';

const IT = 'queue-it';
const HR = 'queue-hr';
const viewer = (role: PrivacyViewer['role'], administers: string[] = [], id = 'viewer'): PrivacyViewer => ({ id, role, administeredQueueIds: new Set(administers) });
const person = (role: PrivacyViewer['role'], id = 'subject') => ({ id, role });
const emailVisible = (policy: PeoplePrivacyPolicy, who: PrivacyViewer, whom: ReturnType<typeof person>, context = [IT]) => visibleFieldsFor(policy, who, whom, context).email;

describe('people privacy policy', () => {
    const defaults = DEFAULT_PEOPLE_PRIVACY;

    it('defaults to "higher roles only" for every field', () => {
        expect(defaults).toEqual({ email: 'higher', language: 'higher', jobTitle: 'higher', requesterVisibleToHandlers: true });
    });

    it('lets higher roles see lower ones by default, never the reverse', () => {
        expect(emailVisible(defaults, viewer('AGENT'), person('USER'))).toBe(true);
        expect(emailVisible(defaults, viewer('USER'), person('AGENT'))).toBe(false);
        expect(emailVisible(defaults, viewer('AGENT'), person('AGENT'))).toBe(false);
    });

    it('counts a department admin as admin only in departments it administers', () => {
        // Administrator of IT looking at an IT agent or requester: higher rank.
        expect(emailVisible(defaults, viewer('ADMIN', [IT]), person('AGENT'), [IT])).toBe(true);
        expect(emailVisible(defaults, viewer('ADMIN', [IT]), person('USER'), [IT])).toBe(true);
        // HR administrator reaching an IT agent only as an agent: same rank, hidden.
        expect(emailVisible(defaults, viewer('ADMIN', [HR]), person('AGENT'), [IT])).toBe(false);
        // Still above requesters when acting as an agent.
        expect(emailVisible(defaults, viewer('ADMIN', [HR]), person('USER'), [IT])).toBe(true);
    });

    it('always shows everything to Super Admins and to the person themself', () => {
        expect(visibleFieldsFor(defaults, viewer('SUPER_ADMIN'), person('SUPER_ADMIN', 'other'), [])).toEqual({ email: true, language: true, jobTitle: true });
        expect(visibleFieldsFor({ ...defaults }, viewer('USER', [], 'me'), person('USER', 'me'), [])).toEqual({ email: true, language: true, jobTitle: true });
    });

    it('widens visibility level by level', () => {
        const same: PeoplePrivacyPolicy = { ...defaults, email: 'same_or_higher' };
        expect(emailVisible(same, viewer('AGENT'), person('AGENT'))).toBe(true);
        expect(emailVisible(same, viewer('AGENT'), person('ADMIN'))).toBe(false);
        const staff: PeoplePrivacyPolicy = { ...defaults, email: 'staff' };
        expect(emailVisible(staff, viewer('AGENT'), person('SUPER_ADMIN'))).toBe(true);
        expect(emailVisible(staff, viewer('USER'), person('AGENT'))).toBe(false);
        const everyone: PeoplePrivacyPolicy = { ...defaults, email: 'everyone' };
        expect(emailVisible(everyone, viewer('USER'), person('AGENT'))).toBe(true);
    });

    it('evaluates each field independently', () => {
        const policy: PeoplePrivacyPolicy = { email: 'higher', language: 'everyone', jobTitle: 'staff', requesterVisibleToHandlers: true };
        expect(visibleFieldsFor(policy, viewer('USER'), person('AGENT'), [IT])).toEqual({ email: false, language: true, jobTitle: false });
    });

    it('lets staff handling a ticket see its requester, even a colleague of the same rank', () => {
        // An IT agent working a ticket another agent submitted, and an admin on an admin's ticket.
        const onTicket = { subjectIsTicketRequester: true };
        expect(visibleFieldsFor(defaults, viewer('AGENT'), person('AGENT'), [IT], onTicket)).toEqual({ email: true, language: true, jobTitle: true });
        expect(visibleFieldsFor(defaults, viewer('ADMIN', [IT]), person('ADMIN'), [IT], onTicket).email).toBe(true);
        // Never for requesters, and not when the organisation turns it off.
        expect(visibleFieldsFor(defaults, viewer('USER'), person('AGENT'), [IT], onTicket).email).toBe(false);
        expect(visibleFieldsFor({ ...defaults, requesterVisibleToHandlers: false }, viewer('AGENT'), person('AGENT'), [IT], onTicket).email).toBe(false);
        // Only the ticket's requester: other staff on the same ticket still follow the levels.
        expect(visibleFieldsFor(defaults, viewer('AGENT'), person('AGENT'), [IT]).email).toBe(false);
    });

    it('falls back to the safe default for missing, malformed or unknown stored values', () => {
        expect(parsePeoplePrivacy(null)).toEqual(defaults);
        expect(parsePeoplePrivacy('not json')).toEqual(defaults);
        expect(parsePeoplePrivacy(JSON.stringify({ email: 'everyone', language: 'public' }))).toEqual({ ...defaults, email: 'everyone' });
        expect(parsePeoplePrivacy(JSON.stringify({ ...defaults, requesterVisibleToHandlers: 'yes' })).requesterVisibleToHandlers).toBe(true);
        expect(parsePeoplePrivacy(JSON.stringify({ ...defaults, requesterVisibleToHandlers: false })).requesterVisibleToHandlers).toBe(false);
    });

    it('removes hidden fields and treats an unknown role as the most protected', () => {
        const redacted = redactPerson({ id: 'subject', name: 'Jean', email: 'jean@example.com', role: 'USER' as const, jobTitle: 'Accountant' }, defaults, viewer('USER'), [IT]);
        expect(redacted).toEqual({ id: 'subject', name: 'Jean', role: 'USER' });
        expect(redactPerson({ id: 'subject', email: 'x@example.com' }, defaults, viewer('ADMIN', [IT]), [IT])).not.toHaveProperty('email');
    });
});
