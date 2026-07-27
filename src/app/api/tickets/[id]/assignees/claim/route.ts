import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { AssignmentServiceError, claimTicket, unclaimSelf } from '@/lib/tickets/assignment-service';

function response(error: unknown) {
    if (error instanceof AssignmentServiceError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: 'Claim operation failed' }, { status: 500 });
}

export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { return NextResponse.json(await claimTicket(session.user, (await params).id)); } catch (error) { return response(error); }
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try { return NextResponse.json(await unclaimSelf(session.user, (await params).id)); } catch (error) { return response(error); }
}