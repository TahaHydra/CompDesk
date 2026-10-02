import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { canInspectUpdates } from '@/lib/updates';
import { getUpdateState } from '@/lib/update-service';

export const dynamic = 'force-dynamic';

async function respond(force: boolean) {
    const session = await auth();
    if (!session?.user || !canInspectUpdates(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await getUpdateState(force), { headers: { 'Cache-Control': 'no-store' } });
}
export async function GET() { return respond(false); }
export async function POST() { return respond(true); }
