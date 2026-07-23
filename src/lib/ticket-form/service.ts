import crypto from 'crypto';
import {
    BuiltInTicketField,
    FormFieldType,
    Prisma,
    Role,
    type TicketFormTemplate,
    type TicketFormTemplateField,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type {
    FieldConditionalRules,
    FieldValidationRules,
    ResolvedTicketForm,
    TemplateResolutionSource,
    TicketFormFieldDefinition,
    TicketFormSchemaSnapshot,
    TicketFormTemplateDefinition,
} from '@/lib/ticket-form/types';
import type { z } from 'zod';
import type { templateFieldInputSchema, updateTemplateSchema } from '@/lib/ticket-form/schemas';

export const SYSTEM_DEFAULT_TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';
const ALL_ROLES = Object.values(Role);

export const SYSTEM_DEFAULT_FIELD_INPUTS: Array<z.infer<typeof templateFieldInputSchema> & { id: string }> = [
    {
        id: '00000000-0000-0000-0001-000000000001', fieldKey: 'title', label: 'Title', type: FormFieldType.TEXT,
        builtIn: BuiltInTicketField.TITLE, placeholder: 'Brief summary of your request', helpText: null,
        required: true, defaultValue: null, options: [], validationRules: { minLength: 3, maxLength: 200 },
        conditionalRules: null, visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 10, width: 12, isActive: true,
    },
    {
        id: '00000000-0000-0000-0001-000000000002', fieldKey: 'description', label: 'Description', type: FormFieldType.TEXTAREA,
        builtIn: BuiltInTicketField.DESCRIPTION, placeholder: 'Provide as much detail as possible', helpText: null,
        required: false, defaultValue: null, options: [], validationRules: { maxLength: 10000 },
        conditionalRules: null, visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 20, width: 12, isActive: true,
    },
    {
        id: '00000000-0000-0000-0001-000000000003', fieldKey: 'priority', label: 'Priority', type: FormFieldType.DROPDOWN,
        builtIn: BuiltInTicketField.PRIORITY, placeholder: null, helpText: null, required: true, defaultValue: 'NORMAL',
        options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], validationRules: null, conditionalRules: null,
        visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 30, width: 6, isActive: true,
    },
    {
        id: '00000000-0000-0000-0001-000000000004', fieldKey: 'severity', label: 'Severity', type: FormFieldType.DROPDOWN,
        builtIn: BuiltInTicketField.SEVERITY, placeholder: null, helpText: null, required: false, defaultValue: null,
        options: ['S1', 'S2', 'S3', 'S4'], validationRules: null, conditionalRules: null,
        visibleTo: [Role.AGENT, Role.ADMIN, Role.SUPER_ADMIN], editableBy: [Role.AGENT, Role.ADMIN, Role.SUPER_ADMIN], sortOrder: 40, width: 6, isActive: true,
    },
    {
        id: '00000000-0000-0000-0001-000000000005', fieldKey: 'attachments', label: 'Attachments', type: FormFieldType.FILE,
        builtIn: BuiltInTicketField.ATTACHMENTS, placeholder: null, helpText: 'Up to five files, 10 MB each.', required: false,
        defaultValue: null, options: [], validationRules: null, conditionalRules: null,
        visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 50, width: 12, isActive: true,
    },
    {
        id: '00000000-0000-0000-0001-000000000006', fieldKey: 'tags', label: 'Tags', type: FormFieldType.MULTISELECT,
        builtIn: BuiltInTicketField.TAGS, placeholder: null, helpText: null, required: false, defaultValue: null,
        options: [], validationRules: null, conditionalRules: null,
        visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 60, width: 12, isActive: true,
    },
];

export class TemplateResolutionError extends Error {
    constructor(public code: string, message: string, public status: number = 400) {
        super(message);
        this.name = 'TemplateResolutionError';
    }
}

function jsonStringArray(value: Prisma.JsonValue | null): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function jsonObject<T>(value: Prisma.JsonValue | null): T | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : null;
}

function roles(values: string[]): Role[] {
    return values.filter((value): value is Role => ALL_ROLES.includes(value as Role));
}

export function serializeTemplateField(field: TicketFormTemplateField): TicketFormFieldDefinition {
    return {
        id: field.id,
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        builtIn: field.builtIn,
        placeholder: field.placeholder,
        helpText: field.helpText,
        required: field.required,
        defaultValue: field.defaultValue,
        options: jsonStringArray(field.options),
        validationRules: jsonObject<FieldValidationRules>(field.validationRules),
        conditionalRules: jsonObject<FieldConditionalRules>(field.conditionalRules),
        visibleTo: roles(field.visibleTo),
        editableBy: roles(field.editableBy),
        sortOrder: field.sortOrder,
        width: field.width,
        isActive: field.isActive,
    };
}

export function serializeTemplate(
    template: TicketFormTemplate & { fields: TicketFormTemplateField[] }
): TicketFormTemplateDefinition {
    return {
        id: template.id,
        name: template.name,
        description: template.description,
        version: template.version,
        isSystemDefault: template.isSystemDefault,
        isActive: template.isActive,
        archivedAt: template.archivedAt?.toISOString() ?? null,
        fields: template.fields.map(serializeTemplateField).sort((left, right) => left.sortOrder - right.sortOrder),
    };
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
}

function fieldCreateData(field: z.infer<typeof templateFieldInputSchema>) {
    return {
        id: field.id ?? crypto.randomUUID(),
        fieldKey: field.fieldKey,
        label: field.label,
        type: field.type,
        builtIn: field.builtIn ?? null,
        placeholder: field.placeholder ?? null,
        helpText: field.helpText ?? null,
        required: field.required,
        defaultValue: jsonInput(field.defaultValue),
        options: jsonInput(field.options),
        validationRules: jsonInput(field.validationRules),
        conditionalRules: jsonInput(field.conditionalRules),
        visibleTo: field.visibleTo,
        editableBy: field.editableBy,
        sortOrder: field.sortOrder,
        width: field.width,
        isActive: field.isActive,
    };
}

export async function ensureSystemDefaultTemplate() {
    const existing = await prisma.ticketFormTemplate.findFirst({
        where: { isSystemDefault: true },
        include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (existing) return existing;

    try {
        return await prisma.ticketFormTemplate.create({
            data: {
                id: SYSTEM_DEFAULT_TEMPLATE_ID,
                name: 'System Default Ticket Form',
                description: 'Protected fallback form used when no active assignment exists.',
                isSystemDefault: true,
                isActive: true,
                fields: { create: SYSTEM_DEFAULT_FIELD_INPUTS.map(fieldCreateData) },
            },
            include: { fields: { orderBy: { sortOrder: 'asc' } } },
        });
    } catch {
        const concurrent = await prisma.ticketFormTemplate.findFirst({
            where: { isSystemDefault: true },
            include: { fields: { orderBy: { sortOrder: 'asc' } } },
        });
        if (!concurrent) throw new Error('Unable to create the system default ticket form template');
        return concurrent;
    }
}

export function chooseEffectiveTemplate<T extends { id: string; isActive: boolean; archivedAt: Date | null }>(input: {
    category: T | null;
    department: T | null;
    system: T;
}): { template: T; source: TemplateResolutionSource } {
    if (input.category?.isActive && !input.category.archivedAt) return { template: input.category, source: 'category' };
    if (input.department?.isActive && !input.department.archivedAt) return { template: input.department, source: 'department' };
    return { template: input.system, source: 'system' };
}

export async function resolveTicketFormTemplate(
    queueId: string,
    categoryId: string | null | undefined,
    role: Role
): Promise<ResolvedTicketForm> {
    const queue = await prisma.queue.findUnique({
        where: { id: queueId },
        select: { id: true, name: true, isActive: true, defaultTemplateId: true },
    });
    if (!queue) throw new TemplateResolutionError('QUEUE_NOT_FOUND', 'Department not found', 404);
    if (!queue.isActive) throw new TemplateResolutionError('QUEUE_INACTIVE', 'This department is inactive');

    const category = categoryId
        ? await prisma.category.findUnique({
            where: { id: categoryId },
            select: { id: true, name: true, queueId: true, isActive: true, archivedAt: true, templateId: true },
        })
        : null;
    if (categoryId && !category) throw new TemplateResolutionError('CATEGORY_NOT_FOUND', 'Category not found', 404);
    if (category && category.queueId !== queue.id) {
        throw new TemplateResolutionError('CATEGORY_QUEUE_MISMATCH', 'The selected category does not belong to this department');
    }
    if (category && (!category.isActive || category.archivedAt)) {
        throw new TemplateResolutionError('CATEGORY_INACTIVE', 'The selected category is archived or inactive');
    }

    const system = await ensureSystemDefaultTemplate();
    if (!system.isActive || system.archivedAt) {
        throw new TemplateResolutionError('SYSTEM_TEMPLATE_INVALID', 'The system default ticket form is unavailable', 500);
    }

    const candidateIds = [...new Set([category?.templateId, queue.defaultTemplateId].filter((id): id is string => Boolean(id)))];
    const candidates = candidateIds.length
        ? await prisma.ticketFormTemplate.findMany({
            where: { id: { in: candidateIds } },
            include: { fields: { orderBy: { sortOrder: 'asc' } } },
        })
        : [];
    const candidateMap = new Map(candidates.map((template) => [template.id, template]));
    const selected = chooseEffectiveTemplate({
        category: category?.templateId ? candidateMap.get(category.templateId) ?? null : null,
        department: queue.defaultTemplateId ? candidateMap.get(queue.defaultTemplateId) ?? null : null,
        system,
    });

    const definition = serializeTemplate(selected.template);
    const allFields = definition.fields.filter((field) => field.isActive);
    const visibleFields = allFields.filter((field) => field.visibleTo.includes(role));

    return {
        template: { ...definition, fields: visibleFields },
        fields: visibleFields,
        allFields,
        source: selected.source,
        queue: { id: queue.id, name: queue.name },
        category: category ? { id: category.id, name: category.name } : null,
        role,
    };
}

export function buildTicketFormSchemaSnapshot(resolved: ResolvedTicketForm): TicketFormSchemaSnapshot {
    return {
        templateId: resolved.template.id,
        templateName: resolved.template.name,
        version: resolved.template.version,
        fields: resolved.allFields.map((field) => ({ ...field })),
    };
}

export async function cloneTicketFormTemplate(input: {
    sourceTemplateId?: string;
    name: string;
    description?: string | null;
}) {
    const source = input.sourceTemplateId
        ? await prisma.ticketFormTemplate.findUnique({
            where: { id: input.sourceTemplateId },
            include: { fields: { orderBy: { sortOrder: 'asc' } } },
        })
        : await ensureSystemDefaultTemplate();
    if (!source) throw new TemplateResolutionError('TEMPLATE_NOT_FOUND', 'Source template not found', 404);

    return prisma.ticketFormTemplate.create({
        data: {
            name: input.name,
            description: input.description ?? source.description,
            isActive: true,
            fields: {
                create: source.fields.map((field) => ({
                    fieldKey: field.fieldKey,
                    label: field.label,
                    type: field.type,
                    builtIn: field.builtIn,
                    placeholder: field.placeholder,
                    helpText: field.helpText,
                    required: field.required,
                    defaultValue: field.defaultValue === null ? undefined : (field.defaultValue as Prisma.InputJsonValue),
                    options: field.options === null ? undefined : (field.options as Prisma.InputJsonValue),
                    validationRules: field.validationRules === null ? undefined : (field.validationRules as Prisma.InputJsonValue),
                    conditionalRules: field.conditionalRules === null ? undefined : (field.conditionalRules as Prisma.InputJsonValue),
                    visibleTo: field.visibleTo,
                    editableBy: field.editableBy,
                    sortOrder: field.sortOrder,
                    width: field.width,
                    isActive: field.isActive,
                })),
            },
        },
        include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
}

export async function updateTicketFormTemplate(
    id: string,
    input: z.infer<typeof updateTemplateSchema>
) {
    const existing = await prisma.ticketFormTemplate.findUnique({ where: { id } });
    if (!existing) throw new TemplateResolutionError('TEMPLATE_NOT_FOUND', 'Template not found', 404);

    return prisma.$transaction(async (tx) => {
        await tx.ticketFormTemplateField.deleteMany({ where: { templateId: id } });
        await tx.ticketFormTemplateField.createMany({
            data: input.fields.map((field) => ({ templateId: id, ...fieldCreateData(field) })),
        });
        return tx.ticketFormTemplate.update({
            where: { id },
            data: {
                name: input.name,
                description: input.description ?? null,
                version: { increment: 1 },
            },
            include: { fields: { orderBy: { sortOrder: 'asc' } } },
        });
    });
}

export async function getTemplateUsage(id: string) {
    const [departments, categories, historicalTickets] = await Promise.all([
        prisma.queue.findMany({ where: { defaultTemplateId: id }, select: { id: true, name: true } }),
        prisma.category.findMany({ where: { templateId: id }, select: { id: true, name: true, queue: { select: { name: true } } } }),
        prisma.ticket.count({ where: { resolvedTemplateId: id } }),
    ]);
    return { departments, categories, historicalTickets };
}

export async function setTemplateArchived(id: string, archived: boolean) {
    const template = await prisma.ticketFormTemplate.findUnique({ where: { id } });
    if (!template) throw new TemplateResolutionError('TEMPLATE_NOT_FOUND', 'Template not found', 404);
    if (template.isSystemDefault) {
        throw new TemplateResolutionError('SYSTEM_TEMPLATE_PROTECTED', 'The system default template cannot be archived');
    }
    return prisma.ticketFormTemplate.update({
        where: { id },
        data: { isActive: !archived, archivedAt: archived ? new Date() : null },
    });
}

export async function hardDeleteTicketFormTemplate(id: string, reassignToId?: string) {
    const template = await prisma.ticketFormTemplate.findUnique({ where: { id } });
    if (!template) throw new TemplateResolutionError('TEMPLATE_NOT_FOUND', 'Template not found', 404);
    if (template.isSystemDefault) {
        throw new TemplateResolutionError('SYSTEM_TEMPLATE_PROTECTED', 'The system default template cannot be deleted');
    }
    const usage = await getTemplateUsage(id);
    if (usage.historicalTickets > 0) {
        throw new TemplateResolutionError('TEMPLATE_HAS_HISTORY', 'Templates used by historical tickets must be archived, not deleted');
    }
    if ((usage.departments.length > 0 || usage.categories.length > 0) && !reassignToId) {
        throw new TemplateResolutionError('TEMPLATE_ASSIGNED', 'Reassign departments and categories before deleting this template');
    }
    if (reassignToId) {
        const replacement = await prisma.ticketFormTemplate.findFirst({
            where: { id: reassignToId, isActive: true, archivedAt: null },
        });
        if (!replacement || replacement.id === id) {
            throw new TemplateResolutionError('INVALID_REASSIGNMENT', 'Choose a different active replacement template');
        }
    }

    await prisma.$transaction(async (tx) => {
        if (reassignToId) {
            await tx.queue.updateMany({ where: { defaultTemplateId: id }, data: { defaultTemplateId: reassignToId } });
            await tx.category.updateMany({ where: { templateId: id }, data: { templateId: reassignToId } });
        }
        await tx.ticketFormTemplate.delete({ where: { id } });
    });
    return usage;
}