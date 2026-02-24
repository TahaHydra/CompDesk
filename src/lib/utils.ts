import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

/** Sanitize rich text input (server-side) */
export function sanitizeHtml(html: string): string {
    // Basic sanitization - strip script tags and event handlers
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/on\w+='[^']*'/gi, '')
        .replace(/javascript:/gi, '');
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
