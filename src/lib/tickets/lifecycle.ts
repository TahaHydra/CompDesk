import type { TicketStatus } from '@prisma/client';

export interface TicketLifecycleTimestamps {
    resolvedAt?: Date | null;
    closedAt?: Date | null;
}

const OPEN_STATUSES: ReadonlySet<TicketStatus> = new Set([
    'NEW',
    'OPEN',
    'PENDING_USER',
    'PENDING_AGENT',
]);

export function statusTimestampChanges(
    currentStatus: TicketStatus,
    nextStatus: TicketStatus,
    now: Date = new Date()
): TicketLifecycleTimestamps {
    if (currentStatus === nextStatus) return {};
    if (nextStatus === 'RESOLVED') return { resolvedAt: now, closedAt: null };
    if (nextStatus === 'CLOSED') return { closedAt: now };
    if (nextStatus === 'WITHDRAWN') return { resolvedAt: null, closedAt: now };
    if (OPEN_STATUSES.has(nextStatus)) return { resolvedAt: null, closedAt: null };
    return {};
}

export function restartedSlaDueAt(resolutionMinutes: number, now: Date = new Date()): Date {
    return new Date(now.getTime() + resolutionMinutes * 60_000);
}