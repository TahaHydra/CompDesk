import { createHash, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { mkdir, readFile, rename, stat } from 'fs/promises';
import { Prisma, Role, type User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { PUBLIC_REQUESTER_SELECT, STAFF_USER_SELECT } from '@/lib/api-dto';
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
import { authenticatedAttachmentUrl, privateAttachmentLocation, resolveTemporaryAttachmentPath } from '@/lib/attachment-storage';
import { attachmentLimits, isAttachmentDownloadable } from '@/lib/attachment-security';

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

interface PreparedAttachment {
    id: string;
    temporaryId: string;
    file: UploadedFieldFile;
    sourcePath: string;
    destinationPath: string;
    reference: string;
    sha256: string;
    scanStatus: 'NOT_CONFIGURED' | 'CLEAN' | 'INFECTED' | 'ERROR';
    scannedAt: Date | null;
}

async function reserveNextTicketCount(tx: Prisma.TransactionClient, year: number): Promise<number> {
    const current = await tx.ticketCounter.findUnique({ where: { id: 'singleton' } });
    if (!current) {
        await tx.ticketCounter.create({ data: { id: 'singleton', year, count: 1 } });
        return 1;
    }
    if (current.year !== year) {
        return (await tx.ticketCounter.update({ where: { id: 'singleton' }, data: { year, count: 1 } })).count;
    }
    return (await tx.ticketCounter.update({ where: { id: 'singleton' }, data: { count: { increment: 1 } } })).count;
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

function safeTempSource(url: string, userId: string): { absolutePath: string; filename: string } | null {
    const match = /^temporary\/[a-zA-Z0-9-]+\/([a-zA-Z0-9-]+\.[a-zA-Z0-9]+)$/.exec(url);
    if (!match) return null;
    const absolutePath = resolveTemporaryAttachmentPath(url, userId);
    return absolutePath ? { absolutePath, filename: match[1] } : null;
}

async function prepareUploadedFiles(
    ticketId: string,
    files: UploadedFieldFile[],
    userId: string
): Promise<PreparedAttachment[]> {
    const limits = attachmentLimits();
    if (files.length > limits.maxFilesPerTicket) {
        throw new TicketFormValidationError({ attachments: `A ticket may contain at most ${limits.maxFilesPerTicket} attachments` });
    }
    const prepared: PreparedAttachment[] = [];
    let totalBytes = 0;
    for (const file of files) {
        const source = safeTempSource(file.url, userId);
        if (!source) throw new TicketFormValidationError({ attachments: 'An uploaded file reference is invalid or expired' });
        const temporary = await prisma.temporaryAttachment.findUnique({ where: { path: file.url } });
        if (!temporary || temporary.userId !== userId || temporary.expiresAt <= new Date()) {
            throw new TicketFormValidationError({ attachments: 'An uploaded file reference is invalid or expired' });
        }
        if (!isAttachmentDownloadable(temporary.scanStatus)) {
            throw new TicketFormValidationError({ attachments: `Uploaded file ${temporary.filename} did not pass malware scanning` });
        }
        const [info, buffer] = await Promise.all([
            stat(source.absolutePath).catch(() => null),
            readFile(source.absolutePath).catch(() => null),
        ]);
        if (!info?.isFile() || !buffer || info.size !== temporary.size) {
            throw new TicketFormValidationError({ attachments: `Uploaded file ${temporary.filename} is missing or invalid` });
        }
        const checksum = createHash('sha256').update(buffer).digest('hex');
        if (checksum !== temporary.sha256) {
            throw new TicketFormValidationError({ attachments: `Uploaded file ${temporary.filename} failed its integrity check` });
        }
        totalBytes += temporary.size;
        if (totalBytes > limits.maxBytesPerTicket) {
            throw new TicketFormValidationError({ attachments: 'The combined attachment size exceeds the ticket limit' });
        }
        const location = privateAttachmentLocation(ticketId, source.filename);
        prepared.push({
            id: randomUUID(),
            temporaryId: temporary.id,
            file: {
                url: temporary.path,
                filename: temporary.filename,
                mimetype: temporary.detectedMimetype,
                size: temporary.size,
            },
            sourcePath: source.absolutePath,
            destinationPath: location.absolutePath,
            reference: location.reference,
            sha256: temporary.sha256,
            scanStatus: temporary.scanStatus,
            scannedAt: temporary.scannedAt,
        });
    }
    return prepared;
}
async function restoreMovedFiles(files: PreparedAttachment[]): Promise<void> {
    for (const file of [...files].reverse()) {
        try {
            await mkdir(dirname(file.sourcePath), { recursive: true });
            await rename(file.destinationPath, file.sourcePath);
        } catch (error) {
            logger.error('Failed to restore a temporary attachment after ticket creation rollback', {
                error,
                sourcePath: file.sourcePath,
                destinationPath: file.destinationPath,
            });
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

export async function createTicketFromResolvedTemplate(options: CreateTicketOptions) {
    const { actor, requester, input, source } = options;
    if (source === 'web') {
        if ((actor.role === Role.AGENT || actor.role === Role.ADMIN)
            && !(await canAccessQueue(actor.id, actor.role, input.queueId))) {
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
            include: { queue: true, requester: { select: PUBLIC_REQUESTER_SELECT }, assignments: { include: { user: { select: STAFF_USER_SELECT } } } },
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

    const ticketId = randomUUID();
    const uploadedFiles = fileValuesForFields(validated.submittedValues, resolved.allFields);
    const preparedAttachments = await prepareUploadedFiles(ticketId, uploadedFiles, actor.id);
    const urlMap = new Map(preparedAttachments.map((item) => [item.file.url, authenticatedAttachmentUrl(item.id)]));
    const storedValues = replaceUploadedUrls(validated.submittedValues, resolved.allFields, urlMap);

    const [sla, groupAgents, directAgents] = await Promise.all([
        prisma.slaPolicy.findUnique({
            where: { queueId_priority: { queueId: input.queueId, priority: validated.priority } },
        }),
        prisma.groupMember.findMany({
            where: { group: { queueAssignments: { some: { queueId: input.queueId, role: 'agent' } } } },
            include: { user: { select: { id: true, email: true } } },
        }),
        prisma.queueMember.findMany({
            where: { queueId: input.queueId, role: 'agent' },
            include: { user: { select: { id: true, email: true } } },
        }),
    ]);
    const dueAt = sla ? new Date(Date.now() + sla.resolutionMinutes * 60000) : null;
    const snapshot = buildTicketFormSchemaSnapshot(resolved);
    const agentMap = new Map<string, string>();
    groupAgents.forEach((member) => agentMap.set(member.user.id, member.user.email));
    directAgents.forEach((member) => agentMap.set(member.user.id, member.user.email));
    agentMap.delete(requester.id);
    const movedFiles: PreparedAttachment[] = [];

    let ticket;
    try {
        ticket = await prisma.$transaction(async (tx) => {
            const year = new Date().getFullYear();
            const ticketKey = generateTicketKey(year, await reserveNextTicketCount(tx, year));
            await tx.ticket.create({
                data: {
                    id: ticketId,
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
                    dueAt,
                    resolvedTemplateId: resolved.template.id,
                    resolvedTemplateVersion: resolved.template.version,
                    formSchemaSnapshot: snapshot as unknown as Prisma.InputJsonValue,
                    submittedFormValues: storedValues as Prisma.InputJsonValue,
                },
            });

            if (uniqueTagIds.length > 0) {
                await tx.ticketTag.createMany({
                    data: uniqueTagIds.map((tagId) => ({ ticketId, tagId })),
                    skipDuplicates: true,
                });
            }

            if (preparedAttachments.length > 0) {
                const limits = attachmentLimits();
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(1449756210)`;
                const globalUsage = await tx.attachment.aggregate({ where: { blobRemovedAt: null }, _sum: { size: true } });
                const incomingBytes = preparedAttachments.reduce((total, item) => total + item.file.size, 0);
                if ((globalUsage._sum.size ?? 0) + incomingBytes > limits.globalMaxBytes) {
                    throw new TicketFormValidationError({ attachments: 'Global attachment storage limit reached' });
                }
                for (const file of preparedAttachments) {
                    await mkdir(dirname(file.destinationPath), { recursive: true, mode: 0o700 });
                    await rename(file.sourcePath, file.destinationPath);
                    movedFiles.push(file);
                }
                await tx.attachment.createMany({
                    data: preparedAttachments.map((item) => ({
                        id: item.id,
                        ticketId,
                        uploaderId: actor.id,
                        filename: item.file.filename,
                        mimetype: item.file.mimetype,
                        detectedMimetype: item.file.mimetype,
                        size: item.file.size,
                        path: item.reference,
                        sha256: item.sha256,
                        scanStatus: item.scanStatus,
                        scannedAt: item.scannedAt,
                    })),
                });
                await tx.temporaryAttachment.deleteMany({
                    where: { id: { in: preparedAttachments.map((item) => item.temporaryId) }, userId: actor.id },
                });
            }

            await tx.ticketWatcher.createMany({
                data: [requester.id, ...agentMap.keys()].map((userId) => ({ ticketId, userId })),
                skipDuplicates: true,
            });
            await tx.timelineEvent.create({
                data: {
                    ticketId,
                    userId: requester.id,
                    type: 'CREATED',
                    content: source === 'api' ? `Ticket created via API: ${validated.title}` : `Ticket created: ${validated.title}`,
                    metadata: { templateId: resolved.template.id, templateVersion: resolved.template.version, resolutionSource: resolved.source },
                },
            });

            return tx.ticket.findUniqueOrThrow({
                where: { id: ticketId },
                include: { queue: true, requester: { select: PUBLIC_REQUESTER_SELECT }, assignments: { include: { user: { select: STAFF_USER_SELECT } } } },
            });
        }, { maxWait: 5_000, timeout: 15_000 });
    } catch (error) {
        await restoreMovedFiles(movedFiles);
        if (input.idempotencyKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const existing = await prisma.ticket.findFirst({
                where: { requesterId: requester.id, idempotencyKey: input.idempotencyKey },
                include: { queue: true, requester: { select: PUBLIC_REQUESTER_SELECT }, assignments: { include: { user: { select: STAFF_USER_SELECT } } } },
            });
            if (existing) return { ticket: existing, replayed: true };
        }
        throw error;
    }

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