import path from 'path';
import { mkdir, rename, stat } from 'fs/promises';
import { Prisma, Role, type User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { sendNewTicketForDepartmentEmail, sendTicketCreatedEmail } from '@/lib/email';
import { fireWebhook } from '@/lib/webhooks';
import { canAccessQueue } from '@/lib/permissions';
import { generateTicketKey } from '@/lib/utils';
import type { CreateTicketInput } from '@/lib/validations';
import {
    buildTicketFormSchemaSnapshot,
    resolveTicketFormTemplate,
} from '@/lib/ticket-form/service';
import {
    TicketFormValidationError,
    validateTicketFormSubmission,
} from '@/lib/ticket-form/validation';
import type { TicketFormFieldDefinition, UploadedFieldFile } from '@/lib/ticket-form/types';
import logger from '@/lib/logger';

export interface TicketCreationActor {
    id: string;
    email: string;
    role: Role;
}

export interface CreateTicketOptions {
    source: 'web' | 'api';
    actor: TicketCreationActor;
    requester: Pick<User, 'id' | 'email' | 'role'>;
    input: CreateTicketInput;
}

async function reserveNextTicketCount(year: number): Promise<number> {
    return prisma.$transaction(async (tx) => {
        const current = await tx.ticketCounter.findUnique({ where: { id: 'singleton' } });
        if (!current) {
            await tx.ticketCounter.create({ data: { id: 'singleton', year, count: 1 } });
            return 1;
        }
        if (current.year !== year) {
            return (await tx.ticketCounter.update({ where: { id: 'singleton' }, data: { year, count: 1 } })).count;
        }
        return (await tx.ticketCounter.update({ where: { id: 'singleton' }, data: { count: { increment: 1 } } })).count;
    });
}

function submissionValues(input: CreateTicketInput): Record<string, unknown> {
    const values: Record<string, unknown> = { ...(input.formData ?? {}), ...(input.values ?? {}) };
    if (input.title !== undefined) values.title = input.title;
    if (input.description !== undefined) values.description = input.description;
    if (input.priority !== undefined) values.priority = input.priority;
    if (input.severity !== undefined) values.severity = input.severity;
    if (input.tagIds !== undefined) values.tags = input.tagIds;
    if (input.attachments !== undefined) values.attachments = input.attachments;
    return values;
}

function fileValuesForFields(values: Record<string, unknown>, fields: TicketFormFieldDefinition[]): UploadedFieldFile[] {
    const files: UploadedFieldFile[] = [];
    for (const field of fields) {
        if (field.type !== 'FILE') continue;
        const value = values[field.fieldKey];
        if (!Array.isArray(value)) continue;
        for (const item of value) {
            if (item && typeof item === 'object' && !Array.isArray(item) && 'url' in item) {
                files.push(item as UploadedFieldFile);
            }
        }
    }
    return [...new Map(files.map((file) => [file.url, file])).values()];
}

function safeTempSource(url: string): { absolutePath: string; filename: string } | null {
    const match = /^\/uploads\/temp\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(url);
    if (!match) return null;
    const tempRoot = path.resolve(process.cwd(), 'public', 'uploads', 'temp');
    const absolutePath = path.resolve(tempRoot, match[1]);
    if (!absolutePath.startsWith(`${tempRoot}${path.sep}`)) return null;
    return { absolutePath, filename: match[1] };
}

async function verifyTempFiles(files: UploadedFieldFile[]) {
    for (const file of files) {
        const source = safeTempSource(file.url);
        if (!source) throw new TicketFormValidationError({ attachments: 'An uploaded file reference is invalid or expired' });
        const info = await stat(source.absolutePath).catch(() => null);
        if (!info?.isFile() || info.size !== file.size) {
            throw new TicketFormValidationError({ attachments: `Uploaded file ${file.filename} is missing or invalid` });
        }
    }
}

function replaceUploadedUrls(
    values: Record<string, unknown>,
    fields: TicketFormFieldDefinition[],
    urlMap: Map<string, string>
): Record<string, unknown> {
    const next = { ...values };
    for (const field of fields) {
        if (field.type !== 'FILE' || !Array.isArray(next[field.fieldKey])) continue;
        next[field.fieldKey] = (next[field.fieldKey] as UploadedFieldFile[]).map((file) => ({
            ...file,
            url: urlMap.get(file.url) ?? file.url,
        }));
    }
    return next;
}

async function persistUploadedFiles(ticketId: string, files: UploadedFieldFile[]): Promise<Map<string, string>> {
    const destinationRoot = path.resolve(process.cwd(), 'public', 'uploads', ticketId);
    await mkdir(destinationRoot, { recursive: true });
    const urlMap = new Map<string, string>();
    for (const file of files) {
        const source = safeTempSource(file.url);
        if (!source) continue;
        const destination = path.resolve(destinationRoot, source.filename);
        if (!destination.startsWith(`${destinationRoot}${path.sep}`)) continue;
        await rename(source.absolutePath, destination);
        const newUrl = `/uploads/${ticketId}/${source.filename}`;
        urlMap.set(file.url, newUrl);
        await prisma.attachment.create({
            data: {
                ticketId,
                filename: file.filename,
                mimetype: file.mimetype,
                size: file.size,
                path: newUrl,
            },
        });
    }
    return urlMap;
}

export async function createTicketFromResolvedTemplate(options: CreateTicketOptions) {
    const { actor, requester, input, source } = options;
    if (source === 'web') {
        if (actor.role === Role.AGENT && !(await canAccessQueue(actor.id, actor.role, input.queueId))) {
            throw new Error('FORBIDDEN_QUEUE');
        }
        if (actor.role === Role.USER) {
            const publicQueue = await prisma.queue.findFirst({
                where: { id: input.queueId, isActive: true, isPublic: true },
                select: { id: true },
            });
            if (!publicQueue) throw new Error('FORBIDDEN_QUEUE');
        }
    }

    if (input.idempotencyKey) {
        const existing = await prisma.ticket.findFirst({
            where: { requesterId: requester.id, idempotencyKey: input.idempotencyKey },
            include: { queue: true, requester: true, assignee: true },
        });
        if (existing) return { ticket: existing, replayed: true };
    }

    const resolved = await resolveTicketFormTemplate(input.queueId, input.categoryId, requester.role);
    const validated = validateTicketFormSubmission(resolved, submissionValues(input));

    const uniqueTagIds = [...new Set(validated.tagIds)];
    if (uniqueTagIds.length > 0) {
        const count = await prisma.tag.count({ where: { id: { in: uniqueTagIds } } });
        if (count !== uniqueTagIds.length) throw new TicketFormValidationError({ tags: 'One or more selected tags are invalid' });
    }

    const uploadedFiles = fileValuesForFields(validated.submittedValues, resolved.allFields);
    await verifyTempFiles(uploadedFiles);

    const year = new Date().getFullYear();
    const ticketKey = generateTicketKey(year, await reserveNextTicketCount(year));
    const sla = await prisma.slaPolicy.findUnique({
        where: { queueId_priority: { queueId: input.queueId, priority: validated.priority } },
    });
    const dueAt = sla ? new Date(Date.now() + sla.resolutionMinutes * 60000) : null;
    const snapshot = buildTicketFormSchemaSnapshot(resolved);

    const ticket = await prisma.ticket.create({
        data: {
            key: ticketKey,
            idempotencyKey: input.idempotencyKey,
            title: validated.title,
            description: validated.description,
            status: 'NEW',
            priority: validated.priority,
            severity: validated.severity,
            queueId: input.queueId,
            categoryId: input.categoryId,
            requesterId: requester.id,
            assigneeId: null,
            dueAt,
            resolvedTemplateId: resolved.template.id,
            resolvedTemplateVersion: resolved.template.version,
            formSchemaSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            submittedFormValues: validated.submittedValues as Prisma.InputJsonValue,
        },
        include: { queue: true, requester: true, assignee: true },
    });

    if (uniqueTagIds.length > 0) {
        await prisma.ticketTag.createMany({
            data: uniqueTagIds.map((tagId) => ({ ticketId: ticket.id, tagId })),
            skipDuplicates: true,
        });
    }

    if (uploadedFiles.length > 0) {
        const urlMap = await persistUploadedFiles(ticket.id, uploadedFiles);
        if (urlMap.size > 0) {
            const movedValues = replaceUploadedUrls(validated.submittedValues, resolved.allFields, urlMap);
            await prisma.ticket.update({
                where: { id: ticket.id },
                data: { submittedFormValues: movedValues as Prisma.InputJsonValue },
            });
        }
    }

    await prisma.ticketWatcher.upsert({
        where: { ticketId_userId: { ticketId: ticket.id, userId: requester.id } },
        update: {},
        create: { ticketId: ticket.id, userId: requester.id },
    });

    const [groupAgents, directAgents] = await Promise.all([
        prisma.groupMember.findMany({
            where: { group: { queueAssignments: { some: { queueId: input.queueId, role: 'agent' } } } },
            include: { user: { select: { id: true, email: true } } },
        }),
        prisma.queueMember.findMany({
            where: { queueId: input.queueId, role: 'agent' },
            include: { user: { select: { id: true, email: true } } },
        }),
    ]);
    const agentMap = new Map<string, string>();
    groupAgents.forEach((member) => agentMap.set(member.user.id, member.user.email));
    directAgents.forEach((member) => agentMap.set(member.user.id, member.user.email));
    agentMap.delete(requester.id);
    if (agentMap.size > 0) {
        await prisma.ticketWatcher.createMany({
            data: [...agentMap.keys()].map((userId) => ({ ticketId: ticket.id, userId })),
            skipDuplicates: true,
        });
    }

    await prisma.timelineEvent.create({
        data: {
            ticketId: ticket.id,
            userId: requester.id,
            type: 'CREATED',
            content: source === 'api' ? `Ticket created via API: ${ticket.title}` : `Ticket created: ${ticket.title}`,
            metadata: { templateId: resolved.template.id, templateVersion: resolved.template.version, resolutionSource: resolved.source },
        },
    });

    void sendTicketCreatedEmail(requester.email, ticket.key, ticket.title);
    const agentEmails = [...agentMap.values()].filter(Boolean);
    if (agentEmails.length > 0) void sendNewTicketForDepartmentEmail(agentEmails, ticket.key, ticket.title, ticket.queue.name);
    void fireWebhook('ticket.created', {
        ticketId: ticket.id,
        key: ticket.key,
        title: ticket.title,
        queueId: ticket.queueId,
        categoryId: ticket.categoryId,
        requesterId: requester.id,
        templateId: resolved.template.id,
        templateVersion: resolved.template.version,
    });
    void auditLog({
        userId: actor.id,
        action: 'ticket.created',
        entity: 'ticket',
        entityId: ticket.id,
        metadata: { key: ticket.key, queueId: ticket.queueId, categoryId: ticket.categoryId, templateId: resolved.template.id, source },
    });

    logger.info('Ticket created with resolved form template', {
        ticketId: ticket.id,
        templateId: resolved.template.id,
        templateVersion: resolved.template.version,
        source,
    });
    return { ticket, replayed: false };
}