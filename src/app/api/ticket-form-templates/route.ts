import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { isAdminRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createTemplateSchema } from '@/lib/ticket-form/schemas';
import { cloneTicketFormTemplate, serializeTemplate, TemplateResolutionError } from '@/lib/ticket-form/service';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const includeArchived = new URL(req.url).searchParams.get('includeArchived') === 'true';
        const templates = await prisma.ticketFormTemplate.findMany({
            where: includeArchived ? {} : { archivedAt: null },
            include: {
                fields: { orderBy: { sortOrder: 'asc' } },
                departmentDefaults: { select: { id: true, name: true } },
                categoryOverrides: { select: { id: true, name: true, queue: { select: { name: true } } } },
                _count: { select: { tickets: true } },
            },
            orderBy: [{ isSystemDefault: 'desc' }, { updatedAt: 'desc' }],
        });
        return NextResponse.json(templates.map((template) => ({
            ...serializeTemplate(template),
            usage: {
                departments: template.departmentDefaults,
                categories: template.categoryOverrides,
                historicalTickets: template._count.tickets,
            },
            updatedAt: template.updatedAt,
        })));
    } catch (error) {
        logger.error('Failed to list ticket form templates', { error });
        return NextResponse.json({ error: 'Failed to load ticket form templates' }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdminRole(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const parsed = createTemplateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Template validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const template = await cloneTicketFormTemplate(parsed.data);
        await auditLog({
            userId: session.user.id,
            action: parsed.data.sourceTemplateId ? 'ticket_form_template.duplicated' : 'ticket_form_template.created',
            entity: 'ticketFormTemplate',
            entityId: template.id,
            metadata: { sourceTemplateId: parsed.data.sourceTemplateId, name: template.name },
        });
        return NextResponse.json(serializeTemplate(template), { status: 201 });
    } catch (error) {
        if (error instanceof TemplateResolutionError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        logger.error('Failed to create ticket form template', { error });
        return NextResponse.json({ error: 'Failed to create ticket form template' }, { status: 500 });
    }
}