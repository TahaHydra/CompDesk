import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canUseSavedReplies } from '@/lib/saved-replies';

// POST /api/saved-replies/[id]/use: counts an insertion so the most used replies list first.
// Not audited: it only orders the caller's own list.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!canUseSavedReplies(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const id = z.guid().safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: 'Saved reply not found' }, { status: 404 });
    const updated = await prisma.savedReply.updateMany({
        where: { id: id.data, ownerId: session.user.id },
        data: { useCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    if (updated.count === 0) return NextResponse.json({ error: 'Saved reply not found' }, { status: 404 });
    return NextResponse.json({ success: true });
}
