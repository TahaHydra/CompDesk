import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json(
        { status: 'live', mode: 'production' },
        { headers: { 'Cache-Control': 'no-store' } }
    );
}
