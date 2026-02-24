import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isAdmin } from '@/lib/utils';
import { createFormFieldSchema } from '@/lib/validations';
import logger from '@/lib/logger';

const updateFormFieldSchema = z.object({
    queueId: z.string().uuid().optional(),
    label: z.string().min(1).max(100).optional(),
    fieldKey: z.string().min(1).max(50).regex(/^[a-z_][a-z0-9_]*$/).optional(),
    type: z.enum(['TEXT', 'TEXTAREA', 'DROPDOWN', 'MULTISELECT', 'CHECKBOX', 'DATE', 'FILE']).optional(),
    required: z.boolean().optional(),
    options: z.array(z.string()).optional(),
    validationRules: z.object({
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        regex: z.string().optional(),
        fileTypes: z.array(z.string()).optional(),
    }).optional(),
    conditionalRules: z.object({
        dependsOn: z.string().optional(),
        showWhen: z.string().optional(),
    }).optional(),
    visibleTo: z.array(z.enum(['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'])).min(1).optional(),
    sortOrder: z.number().int().optional(),
}).refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
});

// GET /api/form-fields?queueId=xxx
export async function GET(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const queueId = searchParams.get('queueId');

        if (!queueId) {
            return NextResponse.json({ error: 'queueId required' }, { status: 400 });
        }

        const fields = await prisma.formField.findMany({
            where: {
                queueId,
                visibleTo: { has: session.user.role },
            },
            orderBy: { sortOrder: 'asc' },
        });

        return NextResponse.json(fields);
    } catch (error) {
        logger.error('Failed to fetch form fields', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// POST /api/form-fields
export async function POST(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const parsed = createFormFieldSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const { options, validationRules, conditionalRules, visibleTo, ...baseData } = parsed.data;
        const field = await prisma.formField.create({
            data: {
                ...baseData,
                options: (options as any) ?? undefined,
                validationRules: (validationRules as any) ?? undefined,
                conditionalRules: (conditionalRules as any) ?? undefined,
                visibleTo: visibleTo ?? ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'],
            },
        });

        return NextResponse.json(field, { status: 201 });
    } catch (error: any) {
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'fieldKey already exists for this department' }, { status: 400 });
        }
        logger.error('Failed to create form field', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/form-fields
export async function PATCH(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await req.json();
        const { id, ...rest } = body;

        if (!id || typeof id !== 'string') {
            return NextResponse.json({ error: 'id required' }, { status: 400 });
        }

        const parsed = updateFormFieldSchema.safeParse(rest);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const data = parsed.data;
        const updateData: Record<string, unknown> = { ...data };

        if (Object.prototype.hasOwnProperty.call(data, 'options')) {
            updateData.options = data.options ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'validationRules')) {
            updateData.validationRules = data.validationRules ?? null;
        }
        if (Object.prototype.hasOwnProperty.call(data, 'conditionalRules')) {
            updateData.conditionalRules = data.conditionalRules ?? null;
        }

        const field = await prisma.formField.update({
            where: { id },
            data: updateData as any,
        });

        return NextResponse.json(field);
    } catch (error: any) {
        if (error.code === 'P2002') {
            return NextResponse.json({ error: 'fieldKey already exists for this department' }, { status: 400 });
        }
        logger.error('Failed to update form field', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/form-fields?id=xxx
export async function DELETE(req: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user || !isAdmin(session.user.role)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { searchParams } = new URL(req.url);
        const id = searchParams.get('id');
        if (!id) {
            return NextResponse.json({ error: 'id required' }, { status: 400 });
        }

        await prisma.formField.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete form field', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
