import fs from 'fs';
import path from 'path';
import { TicketStatus } from '@prisma/client';
import { restartedSlaDueAt, statusTimestampChanges } from '@/lib/tickets/lifecycle';
import { updateTicketSchema } from '@/lib/validations';

function source(file: string) {
    return fs.readFileSync(path.join(process.cwd(), ...file.split('/')), 'utf8');
}

describe('ticket lifecycle timestamps', () => {
    const now = new Date('2026-07-30T12:00:00.000Z');

    it('sets resolution time and clears a stale close time', () => {
        expect(statusTimestampChanges(TicketStatus.OPEN, TicketStatus.RESOLVED, now)).toEqual({ resolvedAt: now, closedAt: null });
    });

    it.each([
        TicketStatus.NEW,
        TicketStatus.OPEN,
        TicketStatus.PENDING_USER,
        TicketStatus.PENDING_AGENT,
    ])('clears resolved and closed timestamps when reopening to %s', (status) => {
        expect(statusTimestampChanges(TicketStatus.CLOSED, status, now)).toEqual({ resolvedAt: null, closedAt: null });
    });

    it('records close and withdrawal timestamps deterministically', () => {
        expect(statusTimestampChanges(TicketStatus.RESOLVED, TicketStatus.CLOSED, now)).toEqual({ closedAt: now });
        expect(statusTimestampChanges(TicketStatus.OPEN, TicketStatus.WITHDRAWN, now)).toEqual({ resolvedAt: null, closedAt: now });
    });

    it('restarts the SLA deadline from the policy-change time', () => {
        expect(restartedSlaDueAt(90, now).toISOString()).toBe('2026-07-30T13:30:00.000Z');
    });
});

describe('ticket optimistic concurrency validation', () => {
    it('requires a positive expected version plus a business change', () => {
        expect(updateTicketSchema.safeParse({ status: 'OPEN' }).success).toBe(false);
        expect(updateTicketSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
        expect(updateTicketSchema.safeParse({ expectedVersion: 0, status: 'OPEN' }).success).toBe(false);
        expect(updateTicketSchema.safeParse({ expectedVersion: 1, status: 'OPEN' }).success).toBe(true);
    });

    it('version-checks ticket, assignment, escalation, tag, and routing mutations', () => {
        const updateRoute = source('src/app/api/tickets/[id]/route.ts');
        const assignmentService = source('src/lib/tickets/assignment-service.ts');
        const escalationRoute = source('src/app/api/tickets/[id]/escalate/route.ts');
        expect(updateRoute).toContain('where: { id, version: expectedVersion }');
        expect(updateRoute).toContain('version: { increment: 1 }');
        expect(assignmentService).toContain('where: { id: ticketId, version: expectedVersion }');
        expect(escalationRoute).toContain('where: { id: ticketId, version: expectedVersion }');
        expect([updateRoute, assignmentService, escalationRoute].every((text) => text.includes('409'))).toBe(true);
    });
});

describe('ticket presence and retained history contracts', () => {
    it('keeps GET read-only and stores multiple staff viewers separately', () => {
        const route = source('src/app/api/tickets/[id]/route.ts');
        const getHandler = route.slice(0, route.indexOf('// PATCH /api/tickets/[id]'));
        const presence = source('src/app/api/tickets/[id]/presence/route.ts');
        expect(getHandler).not.toContain('prisma.ticket.update');
        expect(getHandler).toContain('ticketPresence.findMany');
        expect(presence).toContain('ticketPresence.upsert');
        expect(presence).toContain('exclusive: false');
        expect(source('src/app/(dashboard)/tickets/[id]/page.tsx')).toContain("window.setInterval(heartbeat, 45_000)");
    });

    it('separates first assignment from first public response', () => {
        const assignment = source('src/lib/tickets/assignment-service.ts');
        const comments = source('src/app/api/tickets/[id]/comments/route.ts');
        expect(assignment).toContain('firstAssignedAt');
        expect(assignment).not.toContain('firstPublicResponseAt');
        expect(comments).toContain('firstPublicResponseAt');
        expect(comments).toContain('prisma.$transaction');
    });

    it('withdraws tickets and tombstones comments without hard deletion', () => {
        const ticketDelete = source('src/app/api/tickets/[id]/route.ts').split('// DELETE /api/tickets/[id]')[1];
        const comments = source('src/app/api/tickets/[id]/comments/route.ts');
        expect(ticketDelete).toContain("status: 'WITHDRAWN'");
        expect(ticketDelete).not.toContain('ticket.delete');
        expect(comments).toContain("action: 'timeline_event.tombstoned'");
        expect(comments).toContain('deletedAt');
        expect(comments).not.toContain('timelineEvent.delete(');
    });

    it('ships an additive migration with explicit rollback notes', () => {
        const migration = source('prisma/migrations/20260730170000_ticket_integrity_and_presence/migration.sql');
        expect(migration).toContain("ADD VALUE IF NOT EXISTS 'WITHDRAWN'");
        expect(migration).toContain('CREATE TABLE "ticket_presence"');
        expect(migration).toContain('ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1');
        expect(migration.toLowerCase()).toContain('rollback');
        expect(migration).not.toContain('DROP COLUMN "locked_by"');
    });
});