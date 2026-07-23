import { NextResponse } from 'next/server';
import { getPublicBranding } from '@/lib/branding';

export async function GET() {
    const branding = await getPublicBranding();
    return NextResponse.json(branding, {
        headers: { 'Cache-Control': 'no-store' },
    });
}