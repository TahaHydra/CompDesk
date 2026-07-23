import { z } from 'zod';
import { BuiltInTicketField, FormFieldType, Role } from '@prisma/client';

const roleSchema = z.nativeEnum(Role);
const fieldKeySchema = z.string().trim().min(1).max(64).regex(/^[a-z_][a-z0-9_]*$/);

export const validationRulesSchema = z.object({
    minLength: z.number().int().min(0).max(100000).optional(),
    maxLength: z.number().int().min(1).max(100000).optional(),
    regex: z.string().max(500).optional(),
    allowedFileTypes: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
}).superRefine((rules, ctx) => {
    if (rules.minLength !== undefined && rules.maxLength !== undefined && rules.minLength > rules.maxLength) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minLength'], message: 'Minimum length cannot exceed maximum length' });
    }
    if (rules.regex) {
        try { new RegExp(rules.regex); } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['regex'], message: 'Regular expression is invalid' });
        }
    }
});

export const conditionalRulesSchema = z.object({
    fieldKey: fieldKeySchema.optional(),
    operator: z.enum(['equals', 'notEquals', 'contains', 'in', 'truthy']).optional(),
    value: z.unknown().optional(),
    dependsOn: fieldKeySchema.optional(),
    showWhen: z.unknown().optional(),
}).refine((rules) => Boolean(rules.fieldKey || rules.dependsOn), 'A controlling field is required');

export const templateFieldInputSchema = z.object({
    id: z.string().uuid().optional(),
    fieldKey: fieldKeySchema,
    label: z.string().trim().min(1).max(100),
    type: z.nativeEnum(FormFieldType),
    builtIn: z.nativeEnum(BuiltInTicketField).nullable().optional(),
    placeholder: z.string().trim().max(200).nullable().optional(),
    helpText: z.string().trim().max(500).nullable().optional(),
    required: z.boolean().default(false),
    defaultValue: z.unknown().nullable().optional(),
    options: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
    validationRules: validationRulesSchema.nullable().optional(),
    conditionalRules: conditionalRulesSchema.nullable().optional(),
    visibleTo: z.array(roleSchema).min(1).default(Object.values(Role)),
    editableBy: z.array(roleSchema).min(1).default(Object.values(Role)),
    sortOrder: z.number().int().min(0).max(100000),
    width: z.number().int().min(1).max(12).default(12),
    isActive: z.boolean().default(true),
}).superRefine((field, ctx) => {
    const selectionField = field.type === FormFieldType.DROPDOWN || field.type === FormFieldType.MULTISELECT;
    if (selectionField && field.builtIn !== BuiltInTicketField.TAGS && field.options.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: 'Selection fields require at least one option' });
    }
    if (field.builtIn && field.fieldKey !== field.builtIn.toLowerCase()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fieldKey'], message: 'Built-in field keys are fixed' });
    }
    if (field.editableBy.some((role) => !field.visibleTo.includes(role))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['editableBy'], message: 'A role cannot edit a field it cannot view' });
    }
});

export const templateFieldsSchema = z.array(templateFieldInputSchema).min(1).max(100).superRefine((fields, ctx) => {
    const keys = new Set<string>();
    const builtIns = new Set<string>();
    fields.forEach((field, index) => {
        if (keys.has(field.fieldKey)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'fieldKey'], message: 'Field keys must be unique within a template' });
        }
        keys.add(field.fieldKey);
        if (field.builtIn) {
            if (builtIns.has(field.builtIn)) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'builtIn'], message: 'A built-in field can only appear once' });
            }
            builtIns.add(field.builtIn);
        }
        const dependency = field.conditionalRules?.fieldKey ?? field.conditionalRules?.dependsOn;
        if (dependency && dependency === field.fieldKey) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'conditionalRules'], message: 'A field cannot depend on itself' });
        }
        if (dependency && !fields.some((candidate) => candidate.fieldKey === dependency)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'conditionalRules'], message: 'Conditional field dependency does not exist' });
        }
    });
});

export const createTemplateSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    sourceTemplateId: z.string().uuid().optional(),
});

export const updateTemplateSchema = z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    fields: templateFieldsSchema,
});