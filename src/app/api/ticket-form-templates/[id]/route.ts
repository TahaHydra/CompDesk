import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { isAdminRole } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updateTemplateSchema } from '@/lib/ticket-form/schemas';
import {
    getTemplateUsage,
    hardDeleteTicketFormTemplate,
    serializeTemplate,
    setTemplateArchived,
    TemplateResolutionError,
    updateTicketFormTemplate,
} from '@/lib/ticket-form/service';
import logger from '@/lib/logger';

async function requireAdmin() {
    const session = await auth();
    return session?.user && isAdminRole(session.user.role) ? session : null;
}

function templateError(error: unknown) {
    if (error instanceof TemplateResolutionError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { id } = await params;
        const template = await prisma.ticketFormTemplate.findUnique({
            where: { id },
            include: { fields: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
        const definition = serializeTemplate(template);
        const previewRoleValue = new URL(req.url).searchParams.get('previewRole');
        const previewRole = previewRoleValue && Object.values(Role).includes(previewRoleValue as Role)
            ? previewRoleValue as Role
            : null;
        const usage = await getTemplateUsage(id);
        return NextResponse.json({
            ...definition,
            fields: previewRole ? definition.fields.filter((field) => field.visibleTo.includes(previewRole)) : definition.fields,
            usage,
            previewRole,
        });
    } catch (error) {
        logger.error('Failed to load ticket form template', { error });
        return NextResponse.json({ error: 'Failed to load ticket form template' }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await requireAdmin();
        if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { id } = await params;
        const parsed = updateTemplateSchema.safeParse(await req.json());
        if (!parsed.success) {
            return NextResponse.json({ error: 'Template validation failed', details: parsed.error.flatten() }, { status: 400 });
        }
        const template = await updateTicketFormTemplate(id, parsed.data);
        await auditLog({
            userId: session.user.id,
            action: 'ticket_form_template.updated',
            entity: 'ticketFormTemplate',
            entityId: id,
            metadata: { version: template.version, fieldCount: template.fields.length },
        });
        return NextResponse.json(serializeTemplate(template));
    } catch (error) {
        const response = templateError(error);
        if (response) return response;
        logger.error('Failed to update ticket form template', { error });
        return NextResponse.json({ error: 'Failed to update ticket form template' }, { status: 500 });
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await requireAdmin();
        if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { id } = await params;
        const action = new URL(req.url).searchParams.get('action');
        if (action !== 'restore') return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
        const template = await setTemplateArchived(id, false);
        await auditLog({ userId: session.user.id, action: 'ticket_form_template.restored', entity: 'ticketFormTemplate', entityId: id });
        return NextResponse.json(template);
    } catch (error) {
        const response = templateError(error);
        if (response) return response;
        logger.error('Failed to restore ticket form template', { error });
        return NextResponse.json({ error: 'Failed to restore ticket form template' }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await requireAdmin();
        if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const { id } = await params;
        const url = new URL(req.url);
        const mode = url.searchParams.get('mode') ?? 'archive';
        if (mode === 'archive') {
            const template = await setTemplateArchived(id, true);
            await auditLog({ userId: session.user.id, action: 'ticket_form_template.archived', entity: 'ticketFormTemplate', entityId: id });
            return NextResponse.json(template);
        }
        if (mode !== 'hard') return NextResponse.json({ error: 'Unsupported deletion mode' }, { status: 400 });
        const usage = await hardDeleteTicketFormTemplate(id, url.searchParams.get('reassignToId') ?? undefined);
        await auditLog({ userId: session.user.id, action: 'ticket_form_template.deleted', entity: 'ticketFormTemplate', entityId: id, metadata: usage });
        return NextResponse.json({ success: true });
    } catch (error) {
        const response = templateError(error);
        if (response) return response;
        logger.error('Failed to remove ticket form template', { error });
        return NextResponse.json({ error: 'Failed to remove ticket form template' }, { status: 500 });
    }
}