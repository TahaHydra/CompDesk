/** Persisted deadlines are authoritative after a policy change restarts the clock. */
export function resolutionSlaBreached(ticket: { status: string; createdAt: Date | string; dueAt?: Date | string | null }, minutes?: number, now = Date.now()): boolean {
    if (['RESOLVED', 'CLOSED', 'WITHDRAWN'].includes(ticket.status)) return false;
    const deadline = ticket.dueAt ? new Date(ticket.dueAt).getTime() : minutes === undefined ? NaN : new Date(ticket.createdAt).getTime() + minutes * 60000;
    return Number.isFinite(deadline) && now > deadline;
}
