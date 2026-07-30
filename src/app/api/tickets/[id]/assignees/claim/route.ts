import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { AssignmentServiceError, claimTicket, unclaimSelf } from '@/lib/tickets/assignment-service';

const versionSchema = z.object({ expectedVersion: z.coerce.number().int().positive() });

function response(error: unknown) {
    if (error instanceof AssignmentServiceError) {
        return NextResponse.json({ error: error.message, currentVersion: error.currentVersion }, { status: error.status });
    }
    return NextResponse.json({ error: 'Claim operation failed' }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = versionSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'A valid expectedVersion is required', details: parsed.error.flatten() }, { status: 400 });
    try {
        return NextResponse.json(await claimTicket(session.user, (await params).id, parsed.data.expectedVersion));
    } catch (error) {
        return response(error);
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = versionSchema.safeParse({ expectedVersion: request.nextUrl.searchParams.get('expectedVersion') });
    if (!parsed.success) return NextResponse.json({ error: 'A valid expectedVersion is required', details: parsed.error.flatten() }, { status: 400 });
    try {
        return NextResponse.json(await unclaimSelf(session.user, (await params).id, parsed.data.expectedVersion));
    } catch (error) {
        return response(error);
    }
}