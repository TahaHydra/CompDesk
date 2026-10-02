import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessTicket } from '@/lib/permissions';
import { auditLog } from '@/lib/audit';

const draft = z.object({ scheduledAt: z.string().datetime(), note: z.string().trim().max(1000).default(''), email: z.boolean().default(false) });
async function context(params: Promise<{ id: string }>) {
    const session = await auth();
    if (!session?.user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    const { id } = await params;
    const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, requesterId: true, queueId: true, status: true } });
    if (!ticket || !await canAccessTicket(session.user.id, session.user.role, ticket)) return { response: NextResponse.json({ error: 'Ticket unavailable' }, { status: 403 }) };
    return { session, ticket };
}
type Params = { params: Promise<{ id: string }> };
export async function GET(_req: NextRequest, { params }: Params) {
    const ctx = await context(params); if (ctx.response) return ctx.response;
    return NextResponse.json(await prisma.ticketReminder.findMany({ where: { ticketId: ctx.ticket!.id, userId: ctx.session!.user.id }, select: { id: true, scheduledAt: true, note: true, email: true, status: true, deliveredAt: true, emailAccepted: true }, orderBy: { scheduledAt: 'desc' }, take: 50 }), { headers: { 'Cache-Control': 'no-store' } });
}
async function save(req: NextRequest, params: Promise<{ id: string }>, edit: boolean) {
    const ctx = await context(params); if (ctx.response) return ctx.response;
    if (['RESOLVED', 'CLOSED', 'WITHDRAWN'].includes(ctx.ticket!.status)) return NextResponse.json({ error: 'Reminders require an active ticket' }, { status: 409 });
    try {
        const input = (edit ? draft.extend({ id: z.string().uuid() }) : draft).strict().parse(await req.json());
        const scheduledAt = new Date(input.scheduledAt);
        if (scheduledAt.getTime() <= Date.now() || scheduledAt.getTime() > Date.now() + 366 * 86400000) return NextResponse.json({ error: 'Choose a future reminder within one year' }, { status: 400 });
        const userId = ctx.session!.user.id, ticketId = ctx.ticket!.id;
        const data = { scheduledAt, note: input.note, email: input.email, nextAttemptAt: scheduledAt };
        if (edit && 'id' in input) {
            const id = z.string().uuid().parse(input.id);
            const changed = await prisma.ticketReminder.updateMany({ where: { id, userId, ticketId, status: 'PENDING', deliveredAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { ...data, attempts: 0, leaseToken: null, leaseUntil: null } });
            if (!changed.count) return NextResponse.json({ error: 'Reminder unavailable or already being delivered' }, { status: 409 });
        } else await prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), 1449756212)`;
            if (await tx.ticketReminder.count({ where: { userId, status: 'PENDING' } }) >= 20) throw new Error('Reminder limit reached');
            await tx.ticketReminder.create({ data: { ...data, userId, ticketId } });
        });
        await auditLog({ userId, action: edit ? 'ticket.reminder_updated' : 'ticket.reminder_created', entity: 'ticket', entityId: ticketId });
        return NextResponse.json({ success: true }, { status: edit ? 200 : 201 });
    } catch { return NextResponse.json({ error: 'Invalid reminder or active reminder limit reached' }, { status: 400 }); }
}
export async function POST(req: NextRequest, { params }: Params) { return save(req, params, false); }
export async function PATCH(req: NextRequest, { params }: Params) { return save(req, params, true); }
export async function DELETE(req: NextRequest, { params }: Params) {
    const ctx = await context(params); if (ctx.response) return ctx.response;
    try {
        const { id } = z.object({ id: z.string().uuid() }).strict().parse(await req.json());
        const changed = await prisma.ticketReminder.updateMany({ where: { id, ticketId: ctx.ticket!.id, userId: ctx.session!.user.id, status: 'PENDING', OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { status: 'CANCELLED', leaseToken: null, leaseUntil: null } });
        if (changed.count) await auditLog({ userId: ctx.session!.user.id, action: 'ticket.reminder_cancelled', entity: 'ticket', entityId: ctx.ticket!.id });
        return NextResponse.json({ success: Boolean(changed.count) }, { status: changed.count ? 200 : 409 });
    } catch { return NextResponse.json({ error: 'Invalid reminder' }, { status: 400 }); }
}
