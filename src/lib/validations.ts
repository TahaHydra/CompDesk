import { z } from 'zod';
import { Priority, Severity, TicketStatus, FormFieldType } from '@prisma/client';

export const createTicketSchema = z.object({
    idempotencyKey: z.string().uuid().optional(),
    title: z.string().min(3, 'Title must be at least 3 characters').max(200),
    description: z.string().max(10000).optional(),
    queueId: z.string().uuid(),
    categoryId: z.string().uuid().optional(),
    priority: z.nativeEnum(Priority).default('NORMAL'),
    severity: z.nativeEnum(Severity).optional(),
    tagIds: z.array(z.string().uuid()).optional(),
    formData: z.record(z.unknown()).optional(),
});

export const updateTicketSchema = z.object({
    title: z.string().min(3).max(200).optional(),
    description: z.string().max(10000).optional(),
    status: z.nativeEnum(TicketStatus).optional(),
    priority: z.nativeEnum(Priority).optional(),
    severity: z.nativeEnum(Severity).nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    assigneeId: z.string().uuid().nullable().optional(),
    queueId: z.string().uuid().optional(),
    tagIds: z.array(z.string().uuid()).optional(),
});

export const createCommentSchema = z.object({
    content: z.string().min(1, 'Comment cannot be empty').max(10000),
    isInternal: z.boolean().default(false),
});

export const createQueueSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    isPublic: z.boolean().default(false),
    autoAssign: z.boolean().default(false),
});

export const createCategorySchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
});

export const createTagSchema = z.object({
    name: z.string().min(1).max(50),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
});

export const updateTagSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(50).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
}).refine((data) => data.name !== undefined || data.color !== undefined, {
    message: 'At least one field is required',
});

export const createFormFieldSchema = z.object({
    queueId: z.string().uuid(),
    label: z.string().min(1).max(100),
    fieldKey: z.string().min(1).max(50).regex(/^[a-z_][a-z0-9_]*$/),
    type: z.nativeEnum(FormFieldType),
    required: z.boolean().default(false),
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
    sortOrder: z.number().int().default(0),
}).superRefine((data, ctx) => {
    if ((data.type === 'DROPDOWN' || data.type === 'MULTISELECT') && (!data.options || data.options.length === 0)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Options are required for dropdown and multiselect fields',
            path: ['options'],
        });
    }
});

export const slaPolicySchema = z.object({
    queueId: z.string().uuid(),
    priority: z.nativeEnum(Priority),
    firstResponseMinutes: z.number().int().positive(),
    resolutionMinutes: z.number().int().positive(),
});

export const cannedResponseSchema = z.object({
    title: z.string().min(1).max(100),
    content: z.string().min(1).max(5000),
    category: z.string().max(50).optional(),
});

export const webhookConfigSchema = z.object({
    url: z.string().url(),
    secret: z.string().optional(),
    events: z.array(z.string()),
    isActive: z.boolean().default(true),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type UpdateTicketInput = z.infer<typeof updateTicketSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
