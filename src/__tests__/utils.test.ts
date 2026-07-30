import { canTransition, getAllowedTransitions, generateTicketKey, checkRateLimit, sanitizeHtml, isAdmin, isAgentOrAbove, hasRole } from '@/lib/utils';
import { TicketStatus, Role } from '@prisma/client';

describe('Status Transitions', () => {
    test('USER can transition from OPEN to PENDING_AGENT', () => {
        expect(canTransition(TicketStatus.OPEN, TicketStatus.PENDING_AGENT, Role.USER)).toBe(true);
    });

    test('USER cannot transition from NEW to CLOSED', () => {
        expect(canTransition(TicketStatus.NEW, TicketStatus.CLOSED, Role.USER)).toBe(false);
    });

    test('USER can transition from PENDING_USER to PENDING_AGENT', () => {
        expect(canTransition(TicketStatus.PENDING_USER, TicketStatus.PENDING_AGENT, Role.USER)).toBe(true);
    });

    test('AGENT can transition from OPEN to RESOLVED', () => {
        expect(canTransition(TicketStatus.OPEN, TicketStatus.RESOLVED, Role.AGENT)).toBe(true);
    });

    test('AGENT can transition from OPEN to PENDING_USER', () => {
        expect(canTransition(TicketStatus.OPEN, TicketStatus.PENDING_USER, Role.AGENT)).toBe(true);
    });

    test('AGENT can transition from RESOLVED to CLOSED', () => {
        expect(canTransition(TicketStatus.RESOLVED, TicketStatus.CLOSED, Role.AGENT)).toBe(true);
    });

    test('AGENT cannot transition from CLOSED to NEW', () => {
        expect(canTransition(TicketStatus.CLOSED, TicketStatus.NEW, Role.AGENT)).toBe(false);
    });

    test('ADMIN can transition from CLOSED to OPEN', () => {
        expect(canTransition(TicketStatus.CLOSED, TicketStatus.OPEN, Role.ADMIN)).toBe(true);
    });

    test('ADMIN can transition from any status to CLOSED', () => {
        expect(canTransition(TicketStatus.OPEN, TicketStatus.CLOSED, Role.ADMIN)).toBe(true);
        expect(canTransition(TicketStatus.PENDING_USER, TicketStatus.CLOSED, Role.ADMIN)).toBe(true);
    });

    test('getAllowedTransitions returns correct list for AGENT from OPEN', () => {
        const allowed = getAllowedTransitions(TicketStatus.OPEN, Role.AGENT);
        expect(allowed).toContain(TicketStatus.PENDING_USER);
        expect(allowed).toContain(TicketStatus.RESOLVED);
        expect(allowed).not.toContain(TicketStatus.CLOSED);
    });
});

describe('Ticket Key Generation', () => {
    test('generates correct format', () => {
        expect(generateTicketKey(2026, 1)).toBe('TCK-2026-000001');
        expect(generateTicketKey(2026, 123)).toBe('TCK-2026-000123');
        expect(generateTicketKey(2026, 999999)).toBe('TCK-2026-999999');
    });
});

describe('Rate Limiting', () => {
    test('allows requests within limit', () => {
        const key = `test-rate-${Date.now()}`;
        expect(checkRateLimit(key, 3, 60000)).toBe(true);
        expect(checkRateLimit(key, 3, 60000)).toBe(true);
        expect(checkRateLimit(key, 3, 60000)).toBe(true);
    });

    test('blocks requests exceeding limit', () => {
        const key = `test-rate-block-${Date.now()}`;
        checkRateLimit(key, 2, 60000);
        checkRateLimit(key, 2, 60000);
        expect(checkRateLimit(key, 2, 60000)).toBe(false);
    });
});

describe('HTML Sanitization', () => {
    test('normalizes markup to plain text and removes executable element contents', () => {
        expect(sanitizeHtml('<p>Hello</p><script>alert("xss")</script>')).toBe('Hello');
        expect(sanitizeHtml('<STYLE>body { display: none }</STYLE>Visible')).toBe('Visible');
    });

    test('drops tags regardless of quoted or unquoted event-handler attributes', () => {
        expect(sanitizeHtml('<img src=x onerror=alert(1)><strong>Safe</strong>')).toBe('Safe');
        expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('click');
    });

    test('preserves ordinary text, markdown, and non-tag angle brackets', () => {
        expect(sanitizeHtml('Hello **world**\n2 < 3 and <3>')).toBe('Hello **world**\n2 < 3 and <3>');
    });

    test('does not let greater-than characters inside attributes terminate a tag', () => {
        expect(sanitizeHtml('<a title="1 > 0">visible</a>')).toBe('visible');
    });
});

describe('Role Checks', () => {
    test('isAdmin returns true for ADMIN and SUPER_ADMIN', () => {
        expect(isAdmin(Role.ADMIN)).toBe(true);
        expect(isAdmin(Role.SUPER_ADMIN)).toBe(true);
        expect(isAdmin(Role.AGENT)).toBe(false);
        expect(isAdmin(Role.USER)).toBe(false);
    });

    test('isAgentOrAbove returns true for AGENT, ADMIN, SUPER_ADMIN', () => {
        expect(isAgentOrAbove(Role.AGENT)).toBe(true);
        expect(isAgentOrAbove(Role.ADMIN)).toBe(true);
        expect(isAgentOrAbove(Role.SUPER_ADMIN)).toBe(true);
        expect(isAgentOrAbove(Role.USER)).toBe(false);
    });

    test('hasRole checks correctly', () => {
        expect(hasRole(Role.ADMIN, [Role.ADMIN, Role.SUPER_ADMIN])).toBe(true);
        expect(hasRole(Role.USER, [Role.ADMIN, Role.SUPER_ADMIN])).toBe(false);
    });
});
