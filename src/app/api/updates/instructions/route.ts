import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export async function GET() {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Super Admin privileges required' }, { status: 403 });
    // Informational only: the operator runs these on the host AFTER selecting the pinned
    // release asset and making/verifying a coordinated backup. Never execute host commands.
    return NextResponse.json({ command: 'docker compose pull\ndocker compose up -d' }, { headers: { 'Cache-Control': 'no-store' } });
}
