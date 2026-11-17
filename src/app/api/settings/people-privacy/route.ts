import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { requestSourceIp } from '@/lib/request-ip';
import { DEFAULT_PEOPLE_PRIVACY, PEOPLE_PRIVACY_SETTING_KEY, peoplePrivacySchema } from '@/lib/people-privacy';
import { getPeoplePrivacyPolicy } from '@/lib/people-privacy-server';

const NO_STORE = { 'Cache-Control': 'no-store' };

// GET /api/settings/people-privacy: the active policy and the defaults (Super Admin only).
export async function GET() {
    const session = await auth();
    if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ policy: await getPeoplePrivacyPolicy(), defaults: DEFAULT_PEOPLE_PRIVACY }, { headers: NO_STORE });
}

// PUT /api/settings/people-privacy: replaces the whole policy (Super Admin only).
// `requesterVisibleToHandlers` may be omitted by older clients; it then defaults to on.
export async function PUT(req: NextRequest) {
    const session = await auth();
    if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const parsed = peoplePrivacySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });

    const previous = await getPeoplePrivacyPolicy();
    const value = JSON.stringify(parsed.data);
    await prisma.appSetting.upsert({
        where: { key: PEOPLE_PRIVACY_SETTING_KEY },
        update: { value },
        create: { key: PEOPLE_PRIVACY_SETTING_KEY, value },
    });
    await auditLog({
        userId: session.user.id,
        action: 'settings.people_privacy_updated',
        entity: 'setting',
        entityId: PEOPLE_PRIVACY_SETTING_KEY,
        metadata: { previous, policy: parsed.data },
        ipAddress: requestSourceIp(req),
        userAgent: req.headers.get('user-agent') || undefined,
    });
    return NextResponse.json({ policy: parsed.data }, { headers: NO_STORE });
}
