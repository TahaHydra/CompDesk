import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAgentOrAbove } from '@/lib/utils';
import { cannedResponseSchema } from '@/lib/validations';
import logger from '@/lib/logger';

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user || !isAgentOrAbove(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const responses = await prisma.cannedResponse.findMany({ orderBy: { title: 'asc' } });
        return NextResponse.json(responses);
    } catch (error) {
        logger.error('Failed to fetch canned responses', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAgentOrAbove(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const parsed = cannedResponseSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
        }

        const response = await prisma.cannedResponse.create({ data: parsed.data });
        return NextResponse.json(response, { status: 201 });
    } catch (error) {
        logger.error('Failed to create canned response', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
