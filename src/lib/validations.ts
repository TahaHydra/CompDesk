import { z } from 'zod';
import { Priority, Severity, TicketStatus } from '@prisma/client';
import { attachmentLimits } from '@/lib/attachment-security';

const uploadedFileSchema = z.object({
    url: z.string().regex(/^temporary\/[0-9a-f-]{36}\/[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/, 'Invalid temporary file reference'),
    filename: z.string().trim().min(1).max(255),
    mimetype: z.string().trim().min(1).max(120),
    size: z.number().int().positive().max(attachmentLimits().maxFileBytes),
});

export const createTicketSchema = z.object({
    idempotencyKey: z.guid().optional(),
    queueId: z.guid(),
    categoryId: z.guid().optional(),
    values: z.record(z.string(), z.unknown()).optional(),
    // Compatibility fields for existing API clients. The server maps them into the resolved template.
    title: z.string().max(200).optional(),
    description: z.string().max(10000).optional(),
    priority: z.nativeEnum(Priority).optional(),
    severity: z.nativeEnum(Severity).optional(),
    tagIds: z.array(z.guid()).max(100).optional(),
    formData: z.record(z.string(), z.unknown()).optional(),
    attachments: z.array(uploadedFileSchema).max(5).optional(),
}).strict();

export const updateTicketSchema = z.object({
    expectedVersion: z.number().int().positive(),
    title: z.string().min(3).max(200).optional(),
    description: z.string().max(10000).optional(),
    status: z.nativeEnum(TicketStatus).optional(),
    priority: z.nativeEnum(Priority).optional(),
    severity: z.nativeEnum(Severity).nullable().optional(),
    categoryId: z.guid().nullable().optional(),
    queueId: z.guid().optional(),
    tagIds: z.array(z.guid()).max(100).optional(),
}).strict().refine(
    (value) => Object.keys(value).some((key) => key !== 'expectedVersion'),
    { message: 'At least one ticket field is required' }
);

export const createCommentSchema = z.object({
    content: z.string().min(1, 'Comment cannot be empty').max(10000),
    isInternal: z.boolean().default(false),
});

const queueFieldsSchema = z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    isPublic: z.boolean(),
    isActive: z.boolean(),
    autoAssign: z.boolean(),
    defaultTemplateId: z.guid().nullable().optional(),
});

export const createQueueSchema = queueFieldsSchema.extend({
    isPublic: z.boolean().default(false),
    isActive: z.boolean().default(true),
    autoAssign: z.boolean().default(false),
});

// Built from the fields without defaults: Zod 4 keeps defaults through .partial(), which would reset
// every omitted flag on update.
export const updateQueueSchema = queueFieldsSchema.partial().extend({
    id: z.guid(),
    administratorIds: z.array(z.guid()).max(100).optional(),
}).refine(
    (value) => Object.keys(value).some((key) => key !== 'id'),
    'At least one department field is required'
);

export const createCategorySchema = z.object({
    queueId: z.guid(),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    templateId: z.guid().nullable().optional(),
    isActive: z.boolean().default(true),
});

export const updateCategorySchema = z.object({
    id: z.guid(),
    queueId: z.guid().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    templateId: z.guid().nullable().optional(),
    isActive: z.boolean().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== 'id'), 'At least one category field is required');

const tagScopeSchema = z.object({ queueId: z.guid(), categoryId: z.guid().nullable().optional() });

export const createTagSchema = z.object({
    name: z.string().trim().min(1).max(50),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
    allDepartments: z.boolean().default(true),
    scopes: z.array(tagScopeSchema).max(200).default([]),
});

export const updateTagSchema = z.object({
    id: z.guid(),
    name: z.string().trim().min(1).max(50).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    allDepartments: z.boolean().optional(),
    scopes: z.array(tagScopeSchema).max(200).optional(),
}).refine((data) => data.name !== undefined || data.color !== undefined || data.allDepartments !== undefined || data.scopes !== undefined, {
    message: 'At least one field is required',
});

export const slaPolicySchema = z.object({
    queueId: z.guid(),
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