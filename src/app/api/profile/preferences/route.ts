import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

const preferenceSchema = z.object({
    preferredLanguage: z.enum(['en', 'fr']),
}).strict();

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { preferredLanguage: true },
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(user);
}

export async function PATCH(request: Request) {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const parsed = preferenceSchema.safeParse(await request.json());
    if (!parsed.success) {
        return NextResponse.json({ error: 'Preference validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const previous = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { preferredLanguage: true },
    });
    if (!previous) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const user = await prisma.user.update({
        where: { id: session.user.id },
        data: { preferredLanguage: parsed.data.preferredLanguage },
        select: { preferredLanguage: true },
    });
    await auditLog({
        userId: session.user.id,
        action: 'profile.language_updated',
        entity: 'user',
        entityId: session.user.id,
        metadata: { previousLanguage: previous.preferredLanguage, preferredLanguage: user.preferredLanguage },
    });
    return NextResponse.json(user);
}