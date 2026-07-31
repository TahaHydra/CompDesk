import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { addAssignee, AssignmentServiceError, listAssignments, removeAssignee } from '@/lib/tickets/assignment-service';

const addSchema = z.object({ userId: z.string().uuid(), expectedVersion: z.number().int().positive() }).strict();

function assignmentError(error: unknown) {
    if (error instanceof AssignmentServiceError) {
        return NextResponse.json({ error: error.message, currentVersion: error.currentVersion }, { status: error.status });
    }
    return NextResponse.json({ error: 'Assignment operation failed' }, { status: 500 });
}

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
        return NextResponse.json(await listAssignments(session.user, (await params).id));
    } catch (error) {
        return assignmentError(error);
    }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = addSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: 'A valid assignee user ID and expectedVersion are required', details: parsed.error.flatten() }, { status: 400 });
    try {
        return NextResponse.json(await addAssignee(session.user, (await params).id, parsed.data.userId, parsed.data.expectedVersion));
    } catch (error) {
        return assignmentError(error);
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const parsed = z.object({ userId: z.string().uuid(), expectedVersion: z.coerce.number().int().positive() }).safeParse({
        userId: request.nextUrl.searchParams.get('userId'),
        expectedVersion: request.nextUrl.searchParams.get('expectedVersion'),
    });
    if (!parsed.success) return NextResponse.json({ error: 'A valid assignee user ID and expectedVersion are required', details: parsed.error.flatten() }, { status: 400 });
    try {
        return NextResponse.json(await removeAssignee(session.user, (await params).id, parsed.data.userId, parsed.data.expectedVersion));
    } catch (error) {
        return assignmentError(error);
    }
}