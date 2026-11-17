import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { checkRateLimit } from '@/lib/utils';
import { SAVED_REPLIES_PER_USER, SAVED_REPLY_SELECT, canUseSavedReplies, savedReplyInputSchema } from '@/lib/saved-replies';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET /api/saved-replies: the signed-in staff member's own replies, most used first.
export async function GET() {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canUseSavedReplies(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const replies = await prisma.savedReply.findMany({
        where: { ownerId: session.user.id },
        select: SAVED_REPLY_SELECT,
        orderBy: [{ useCount: 'desc' }, { title: 'asc' }],
        take: SAVED_REPLIES_PER_USER,
    });
    return NextResponse.json(replies, { headers: NO_STORE });
}

// POST /api/saved-replies: save a new personal reply.
export async function POST(req: NextRequest) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canUseSavedReplies(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (!checkRateLimit(`saved-replies:${session.user.id}`, 30, 60_000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const parsed = savedReplyInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });

    const ownerId = session.user.id;
    try {
        const created = await prisma.$transaction(async (tx) => {
            // Serialize creates per user so the cap cannot be raced past.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), 1449756213)`;
            if (await tx.savedReply.count({ where: { ownerId } }) >= SAVED_REPLIES_PER_USER) return null;
            return tx.savedReply.create({ data: { ownerId, ...parsed.data }, select: SAVED_REPLY_SELECT });
        });
        if (!created) {
            return NextResponse.json({ error: `You can keep up to ${SAVED_REPLIES_PER_USER} saved replies. Delete one to add another.` }, { status: 409 });
        }
        void auditLog({ userId: ownerId, action: 'saved_reply.created', entity: 'savedReply', entityId: created.id, metadata: { contentLength: created.content.length } });
        return NextResponse.json(created, { status: 201, headers: NO_STORE });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return NextResponse.json({ error: 'You already have a saved reply with this title.' }, { status: 409 });
        }
        logger.error('Failed to save reply', { error: error instanceof Error ? error.message : 'Unknown error' });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
