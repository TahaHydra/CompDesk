import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'iframe', 'object', 'template']);

function tagName(markup: string): { name: string; closing: boolean } | null {
    let cursor = 0;
    const closing = markup[cursor] === '/';
    if (closing) cursor += 1;
    const start = cursor;
    const firstCode = markup.charCodeAt(cursor);
    const startsWithLetter = (firstCode >= 65 && firstCode <= 90) || (firstCode >= 97 && firstCode <= 122);
    if (!startsWithLetter) return null;
    cursor += 1;
    while (cursor < markup.length) {
        const code = markup.charCodeAt(cursor);
        const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        const digit = code >= 48 && code <= 57;
        if (!letter && !digit && markup[cursor] !== '-' && markup[cursor] !== ':') break;
        cursor += 1;
    }
    return { name: markup.slice(start, cursor).toLowerCase(), closing };
}

/** Normalize untrusted legacy rich text to plain text before storing it. */
export function sanitizeHtml(html: string): string {
    let output = '';
    let cursor = 0;
    let suppressedElement: string | null = null;

    while (cursor < html.length) {
        if (html[cursor] !== '<') {
            if (!suppressedElement && html[cursor] !== '\0') output += html[cursor];
            cursor += 1;
            continue;
        }

        if (html.startsWith('<!--', cursor)) {
            const commentEnd = html.indexOf('-->', cursor + 4);
            if (commentEnd === -1) break;
            cursor = commentEnd + 3;
            continue;
        }

        let quote: '"' | "'" | null = null;
        let tagEnd = cursor + 1;
        for (; tagEnd < html.length; tagEnd += 1) {
            const character = html[tagEnd];
            if (quote) {
                if (character === quote) quote = null;
            } else if (character === '"' || character === "'") {
                quote = character;
            } else if (character === '>') {
                break;
            }
        }
        if (tagEnd >= html.length) {
            if (!suppressedElement) output += '<';
            cursor += 1;
            continue;
        }

        const parsed = tagName(html.slice(cursor + 1, tagEnd));
        if (!parsed) {
            if (!suppressedElement) output += html.slice(cursor, tagEnd + 1);
            cursor = tagEnd + 1;
            continue;
        }
        if (suppressedElement) {
            if (parsed.closing && parsed.name === suppressedElement) suppressedElement = null;
        } else if (!parsed.closing && RAW_TEXT_ELEMENTS.has(parsed.name)) {
            suppressedElement = parsed.name;
        }
        cursor = tagEnd + 1;
    }

    return output;
}

/** Generate ticket key like TCK-2026-000123 */
export function generateTicketKey(year: number, count: number): string {
    return `TCK-${year}-${String(count).padStart(6, '0')}`;
}

/** Rate limiter using in-memory store */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
    key: string,
    maxRequests: number = 100,
    windowMs: number = 60000
): boolean {
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now > record.resetAt) {
        rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }

    if (record.count >= maxRequests) {
        return false;
    }

    record.count++;
    return true;
}

/** Status transition rules */
import { TicketStatus, Role } from '@prisma/client';

type TransitionMap = Record<string, TicketStatus[]>;

const USER_TRANSITIONS: TransitionMap = {
    [TicketStatus.OPEN]: [TicketStatus.PENDING_AGENT],
    [TicketStatus.PENDING_USER]: [TicketStatus.PENDING_AGENT],
};

const AGENT_TRANSITIONS: TransitionMap = {
    [TicketStatus.NEW]: [TicketStatus.OPEN],
    [TicketStatus.OPEN]: [TicketStatus.PENDING_USER, TicketStatus.RESOLVED],
    [TicketStatus.PENDING_AGENT]: [TicketStatus.OPEN, TicketStatus.PENDING_USER, TicketStatus.RESOLVED],
    [TicketStatus.PENDING_USER]: [TicketStatus.OPEN, TicketStatus.RESOLVED],
    [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.OPEN],
};

const ADMIN_TRANSITIONS: TransitionMap = {
    [TicketStatus.NEW]: [TicketStatus.OPEN, TicketStatus.CLOSED],
    [TicketStatus.OPEN]: [TicketStatus.PENDING_USER, TicketStatus.PENDING_AGENT, TicketStatus.RESOLVED, TicketStatus.CLOSED],
    [TicketStatus.PENDING_AGENT]: [TicketStatus.OPEN, TicketStatus.PENDING_USER, TicketStatus.RESOLVED, TicketStatus.CLOSED],
    [TicketStatus.PENDING_USER]: [TicketStatus.OPEN, TicketStatus.PENDING_AGENT, TicketStatus.RESOLVED, TicketStatus.CLOSED],
    [TicketStatus.RESOLVED]: [TicketStatus.CLOSED, TicketStatus.OPEN],
    [TicketStatus.CLOSED]: [TicketStatus.OPEN],
};

export function getAllowedTransitions(
    currentStatus: TicketStatus,
    role: Role
): TicketStatus[] {
    switch (role) {
        case 'SUPER_ADMIN':
        case 'ADMIN':
            return ADMIN_TRANSITIONS[currentStatus] ?? [];
        case 'AGENT':
            return AGENT_TRANSITIONS[currentStatus] ?? [];
        case 'USER':
            return USER_TRANSITIONS[currentStatus] ?? [];
        default:
            return [];
    }
}

export function canTransition(
    currentStatus: TicketStatus,
    newStatus: TicketStatus,
    role: Role
): boolean {
    const allowed = getAllowedTransitions(currentStatus, role);
    return allowed.includes(newStatus);
}

/** Format date for display */
export function formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/** Check if user has required role */
export function hasRole(userRole: Role, requiredRoles: Role[]): boolean {
    return requiredRoles.includes(userRole);
}

/** Check if user is admin or super admin */
export function isAdmin(role: Role): boolean {
    return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

/** Check if user is agent or above */
export function isAgentOrAbove(role: Role): boolean {
    return role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'AGENT';
}
