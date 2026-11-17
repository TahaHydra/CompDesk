import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { checkRateLimit } from '@/lib/utils';
import { SAVED_REPLY_SELECT, canUseSavedReplies, savedReplyUpdateSchema } from '@/lib/saved-replies';

type Params = { params: Promise<{ id: string }> };
const NOT_FOUND = () => NextResponse.json({ error: 'Saved reply not found' }, { status: 404 });

/** Resolves the caller. Every query below is scoped to ownerId, so another user's reply is simply "not found". */
async function owner(params: Params['params']) {
    const session = await auth();
    if (!session?.user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!canUseSavedReplies(session.user.role)) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
    const id = z.guid().safeParse((await params).id);
    if (!id.success) return { response: NOT_FOUND() };
    return { ownerId: session.user.id, id: id.data };
}

// PATCH /api/saved-replies/[id]: rename or change the text.
export async function PATCH(req: NextRequest, { params }: Params) {
    const ctx = await owner(params);
    if ('response' in ctx) return ctx.response;
    if (!checkRateLimit(`saved-replies:${ctx.ownerId}`, 30, 60_000)) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    const parsed = savedReplyUpdateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    try {
        const changed = await prisma.savedReply.updateMany({ where: { id: ctx.id, ownerId: ctx.ownerId }, data: parsed.data });
        if (changed.count === 0) return NOT_FOUND();
        const updated = await prisma.savedReply.findFirst({ where: { id: ctx.id, ownerId: ctx.ownerId }, select: SAVED_REPLY_SELECT });
        void auditLog({ userId: ctx.ownerId, action: 'saved_reply.updated', entity: 'savedReply', entityId: ctx.id, metadata: { fields: Object.keys(parsed.data) } });
        return NextResponse.json(updated, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return NextResponse.json({ error: 'You already have a saved reply with this title.' }, { status: 409 });
        }
        logger.error('Failed to update saved reply', { error: error instanceof Error ? error.message : 'Unknown error' });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/saved-replies/[id]
export async function DELETE(_req: NextRequest, { params }: Params) {
    const ctx = await owner(params);
    if ('response' in ctx) return ctx.response;
    const removed = await prisma.savedReply.deleteMany({ where: { id: ctx.id, ownerId: ctx.ownerId } });
    if (removed.count === 0) return NOT_FOUND();
    void auditLog({ userId: ctx.ownerId, action: 'saved_reply.deleted', entity: 'savedReply', entityId: ctx.id });
    return NextResponse.json({ success: true });
}
