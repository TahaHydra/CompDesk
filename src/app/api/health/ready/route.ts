import { NextResponse } from 'next/server';
import { isReady, readinessChecks } from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
    const checks = await readinessChecks();
    const ready = isReady(checks);
    return NextResponse.json(
        { status: ready ? 'ready' : 'not_ready', checks },
        {
            status: ready ? 200 : 503,
            headers: { 'Cache-Control': 'no-store' },
        }
    );
}
