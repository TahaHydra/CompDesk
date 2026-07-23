import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isAdminRole } from '@/lib/permissions';
import { resolveTicketFormTemplate, TemplateResolutionError } from '@/lib/ticket-form/service';
import logger from '@/lib/logger';

const querySchema = z.object({
    queueId: z.string().uuid(),
    categoryId: z.string().uuid().optional(),
    previewRole: z.nativeEnum(Role).optional(),
});

export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const url = new URL(req.url);
        const parsed = querySchema.safeParse({
            queueId: url.searchParams.get('queueId'),
            categoryId: url.searchParams.get('categoryId') || undefined,
            previewRole: url.searchParams.get('previewRole') || undefined,
        });
        if (!parsed.success) {
            return NextResponse.json({ error: 'Invalid template resolution request', details: parsed.error.flatten() }, { status: 400 });
        }
        if (parsed.data.previewRole && !isAdminRole(session.user.role)) {
            return NextResponse.json({ error: 'Only administrators can preview another role' }, { status: 403 });
        }
        const role = parsed.data.previewRole ?? session.user.role;
        const resolved = await resolveTicketFormTemplate(parsed.data.queueId, parsed.data.categoryId, role);
        return NextResponse.json({
            template: resolved.template,
            fields: resolved.fields,
            source: resolved.source,
            queue: resolved.queue,
            category: resolved.category,
            role,
        });
    } catch (error) {
        if (error instanceof TemplateResolutionError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        logger.error('Failed to resolve ticket form template', { error });
        return NextResponse.json({ error: 'Failed to resolve ticket form template' }, { status: 500 });
    }
}