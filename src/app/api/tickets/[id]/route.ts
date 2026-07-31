import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { PUBLIC_REQUESTER_SELECT, STAFF_USER_SELECT, assertApiResponseSafe } from '@/lib/api-dto';
import { updateTicketSchema } from '@/lib/validations';
import { canTransition, isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail } from '@/lib/email';
import { fireWebhook } from '@/lib/webhooks';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { canAccessQueue, canAccessTicket, canDeleteTicket } from '@/lib/permissions';
import { fieldsVisibleToRoleFromSnapshot, parseTicketFormSchemaSnapshot } from '@/lib/ticket-form/validation';
import { authenticatedAttachmentUrl } from '@/lib/attachment-storage';
import { restartedSlaDueAt, statusTimestampChanges } from '@/lib/tickets/lifecycle';
import { isAttachmentDownloadable } from '@/lib/attachment-security';

// GET /api/tickets/[id]
export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const ticket = await prisma.ticket.findUnique({
            where: { id },
            include: {
                queue: true,
                category: true,
                requester: { select: { id: true, name: true, email: true, image: true } },
                assignments: {
                    include: { user: { select: { id: true, name: true, email: true, image: true, role: true } } },
                    orderBy: { assignedAt: 'asc' },
                },
                tags: { include: { tag: true } },
                watchers: { include: { user: { select: { id: true, name: true, email: true } } } },
                timeline: {
                    include: { user: { select: { id: true, name: true, image: true } } },
                    orderBy: { createdAt: 'asc' },
                },
                attachments: true,
            },
        });

        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const hasAccess = await canAccessTicket(session.user.id, session.user.role, ticket);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        // Filter internal notes and historical form fields for the requesting role.
        if (session.user.role === 'USER') {
            ticket.timeline = ticket.timeline.filter((event) => event.type !== 'INTERNAL_NOTE');
        }
        if (session.user.role !== 'SUPER_ADMIN') {
            ticket.timeline = ticket.timeline.map((event) => event.deletedAt
                ? { ...event, content: '[Deleted comment]', metadata: { deleted: true }, deleteReason: null }
                : event);
        }
        const snapshot = parseTicketFormSchemaSnapshot(ticket.formSchemaSnapshot);
        const historicalFields = fieldsVisibleToRoleFromSnapshot(ticket.formSchemaSnapshot, session.user.role);
        const storedValues = ticket.submittedFormValues && typeof ticket.submittedFormValues === 'object' && !Array.isArray(ticket.submittedFormValues)
            ? ticket.submittedFormValues as Record<string, unknown>
            : {};
        const downloadableAttachments = ticket.attachments.filter(
            (attachment) => !attachment.deletedAt && isAttachmentDownloadable(attachment.scanStatus)
        );
        const attachmentUrlsByStoredPath = new Map<string, string>(
            downloadableAttachments.map((attachment) => [attachment.path, authenticatedAttachmentUrl(attachment.id)] as const)
        );
        const attachmentUrlsByIdentity = new Map<string, string>(
            downloadableAttachments.map((attachment) => [`${attachment.filename}:${attachment.size}`, authenticatedAttachmentUrl(attachment.id)] as const)
        );
        const historicalValues = Object.fromEntries(
            historicalFields
                .filter((field) => Object.prototype.hasOwnProperty.call(storedValues, field.fieldKey))
                .map((field) => {
                    const value = storedValues[field.fieldKey];
                    if (!Array.isArray(value)) return [field.fieldKey, value];
                    return [field.fieldKey, value.map((item) => {
                        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
                        const record = item as Record<string, unknown>;
                        const url = typeof record.url === 'string' ? record.url : null;
                        const identity = typeof record.filename === 'string' && typeof record.size === 'number'
                            ? `${record.filename}:${record.size}`
                            : null;
                        const authenticatedUrl = (url ? attachmentUrlsByStoredPath.get(url) : undefined)
                            ?? (identity ? attachmentUrlsByIdentity.get(identity) : undefined);
                        return authenticatedUrl ? { ...record, url: authenticatedUrl } : item;
                    })];
                })
        );

        // SLA info
        let slaInfo = null;
        const sla = await prisma.slaPolicy.findUnique({
            where: { queueId_priority: { queueId: ticket.queueId, priority: ticket.priority } },
        });
        if (sla) {
            const now = new Date();
            const created = new Date(ticket.createdAt);
            const minutesSinceCreation = (now.getTime() - created.getTime()) / 60000;
            slaInfo = {
                firstResponseMinutes: sla.firstResponseMinutes,
                resolutionMinutes: sla.resolutionMinutes,
                firstResponseBreached: !ticket.firstPublicResponseAt && minutesSinceCreation > sla.firstResponseMinutes,
                resolutionBreached: ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && ticket.status !== 'WITHDRAWN' && minutesSinceCreation > sla.resolutionMinutes,
                dueAt: ticket.dueAt,
            };
        }

        // Read-only, non-exclusive viewer presence. Heartbeats use the dedicated
        // presence endpoint and never mutate ticket business timestamps. Never used for authorization.
        const activePresence = isAgentOrAbove(session.user.role)
            ? await prisma.ticketPresence.findMany({
                where: {
                    ticketId: id,
                    lastSeenAt: { gte: new Date(Date.now() - 90_000) },
                },
                select: {
                    lastSeenAt: true,
                    user: { select: { id: true, name: true, image: true } },
                },
                orderBy: { lastSeenAt: 'desc' },
            })
            : [];
        const presenceInfo = {
            viewers: activePresence.map((entry) => ({ ...entry.user, lastSeenAt: entry.lastSeenAt })),
            exclusive: false,
            expiresAfterSeconds: 90,
        };

        const safeTicket = {
            ...ticket,
            ...(session.user.role === 'USER' ? {
                queue: { id: ticket.queue.id, name: ticket.queue.name, description: ticket.queue.description },
                category: ticket.category ? { id: ticket.category.id, name: ticket.category.name, description: ticket.category.description } : null,
                assignments: ticket.assignments.map((assignment) => ({
                    id: assignment.id,
                    userId: assignment.userId,
                    user: { id: assignment.user.id, name: assignment.user.name, image: assignment.user.image },
                })),
            } : {}),
            watchers: session.user.role === 'USER' ? [] : ticket.watchers.map((watcher) => ({
                id: watcher.id,
                user: { id: watcher.user.id, name: watcher.user.name },
            })),
            attachments: ticket.attachments.map((attachment) => ({
                id: attachment.id,
                filename: attachment.filename,
                mimetype: attachment.detectedMimetype,
                size: attachment.size,
                scanStatus: attachment.scanStatus,
                createdAt: attachment.createdAt,
                deletedAt: attachment.deletedAt,
                path: !attachment.deletedAt && isAttachmentDownloadable(attachment.scanStatus)
                    ? authenticatedAttachmentUrl(attachment.id)
                    : null,
            })),
            formSchemaSnapshot: undefined,
            submittedFormValues: undefined,
        };
        return NextResponse.json(assertApiResponseSafe({
            ...safeTicket,
            slaInfo,
            presenceInfo,
            historicalForm: snapshot ? {
                templateId: snapshot.templateId,
                templateName: snapshot.templateName,
                version: snapshot.version,
                fields: historicalFields,
                values: historicalValues,
            } : null,
        }));
    } catch (error) {
        logger.error('Failed to fetch ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// PATCH /api/tickets/[id]
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { id } = await params;
        const parsed = updateTicketSchema.safeParse(await req.json());
        if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });

        const existingTicket = await prisma.ticket.findUnique({ where: { id } });
        if (!existingTicket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        if (!(await canAccessTicket(session.user.id, session.user.role, existingTicket))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { expectedVersion, tagIds, ...changes } = parsed.data;
        if (expectedVersion !== existingTicket.version) {
            return NextResponse.json({ error: 'Ticket changed since it was loaded. Refresh and review the latest values.', currentVersion: existingTicket.version }, { status: 409 });
        }
        if (changes.status === 'WITHDRAWN') {
            return NextResponse.json({ error: 'Use the ticket withdrawal action to preserve history' }, { status: 400 });
        }
        if (session.user.role === 'USER') {
            const protectedKeys = ['title', 'description', 'queueId', 'categoryId', 'priority', 'severity'] as const;
            if (tagIds !== undefined || protectedKeys.some((key) => changes[key] !== undefined)) {
                return NextResponse.json({ error: 'Requesters may only use their documented limited status transitions; other ticket fields require an agent' }, { status: 403 });
            }
        }
        if ((session.user.role === 'AGENT' || session.user.role === 'ADMIN') && changes.queueId && changes.queueId !== existingTicket.queueId && !(await canAccessQueue(session.user.id, session.user.role, changes.queueId))) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const targetQueueId = changes.queueId ?? existingTicket.queueId;
        if (changes.queueId && changes.queueId !== existingTicket.queueId) {
            const currentAssignees = await prisma.ticketAssignee.findMany({ where: { ticketId: id }, include: { user: { select: { id: true, role: true, isActive: true } } } });
            for (const assignment of currentAssignees) {
                if (!assignment.user.isActive || !(await canAccessQueue(assignment.user.id, assignment.user.role, targetQueueId))) {
                    return NextResponse.json({ error: 'Remove assignees who cannot access the destination department before moving this ticket' }, { status: 409 });
                }
            }
        }
        const targetCategoryId = changes.categoryId !== undefined ? changes.categoryId : existingTicket.categoryId;
        if (targetCategoryId && (changes.categoryId !== undefined || changes.queueId !== undefined)) {
            const category = await prisma.category.findUnique({ where: { id: targetCategoryId }, select: { queueId: true, isActive: true, archivedAt: true } });
            if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
            if (category.queueId !== targetQueueId) return NextResponse.json({ error: 'The selected category does not belong to the ticket department' }, { status: 400 });
            if (changes.categoryId !== undefined && (!category.isActive || category.archivedAt)) {
                return NextResponse.json({ error: 'Archived categories cannot be newly assigned' }, { status: 400 });
            }
        }

        const timelineEvents: Array<{ type: string; content: string; metadata?: Record<string, unknown> }> = [];
        const mutationTime = new Date();
        const updateData: Record<string, unknown> = { ...changes };
        if (changes.status && changes.status !== existingTicket.status) {
            if (!canTransition(existingTicket.status, changes.status, session.user.role)) {
                return NextResponse.json({ error: `Cannot transition from ${existingTicket.status} to ${changes.status}` }, { status: 400 });
            }
            Object.assign(updateData, statusTimestampChanges(existingTicket.status, changes.status, mutationTime));
            timelineEvents.push({ type: 'STATUS_CHANGE', content: `Status changed from ${existingTicket.status} to ${changes.status}`, metadata: { from: existingTicket.status, to: changes.status } });
        }
        if (changes.priority && changes.priority !== existingTicket.priority) {
            timelineEvents.push({ type: 'PRIORITY_CHANGE', content: `Priority changed from ${existingTicket.priority} to ${changes.priority}`, metadata: { from: existingTicket.priority, to: changes.priority } });
        }

        const slaPolicyChanged = targetQueueId !== existingTicket.queueId || (changes.priority !== undefined && changes.priority !== existingTicket.priority);
        let slaAudit: Record<string, unknown> | undefined;
        if (slaPolicyChanged) {
            const targetPriority = changes.priority ?? existingTicket.priority;
            const policy = await prisma.slaPolicy.findUnique({ where: { queueId_priority: { queueId: targetQueueId, priority: targetPriority } }, select: { resolutionMinutes: true } });
            updateData.dueAt = policy ? restartedSlaDueAt(policy.resolutionMinutes, mutationTime) : null;
            slaAudit = { rule: 'restart_on_policy_change', changedAt: mutationTime.toISOString(), resolutionMinutes: policy?.resolutionMinutes ?? null, dueAt: updateData.dueAt instanceof Date ? updateData.dueAt.toISOString() : null };
        }

        const uniqueTagIds = tagIds ? [...new Set(tagIds)] : undefined;
        if (uniqueTagIds && uniqueTagIds.length > 0) {
            const validTagCount = await prisma.tag.count({ where: { id: { in: uniqueTagIds } } });
            if (validTagCount !== uniqueTagIds.length) return NextResponse.json({ error: 'One or more selected tags are invalid' }, { status: 400 });
        }

        let updatedTicket;
        try {
            updatedTicket = await prisma.$transaction(async (tx) => {
                const changed = await tx.ticket.updateMany({ where: { id, version: expectedVersion }, data: { ...updateData, version: { increment: 1 } } as never });
                if (changed.count !== 1) throw new Error('TICKET_VERSION_CONFLICT');
                if (uniqueTagIds) {
                    await tx.ticketTag.deleteMany({ where: { ticketId: id } });
                    if (uniqueTagIds.length > 0) await tx.ticketTag.createMany({ data: uniqueTagIds.map((tagId) => ({ ticketId: id, tagId })) });
                }
                if (timelineEvents.length > 0) {
                    await tx.timelineEvent.createMany({ data: timelineEvents.map((event) => ({ ticketId: id, userId: session.user.id, type: event.type as never, content: event.content, metadata: event.metadata as never })) });
                }
                return tx.ticket.findUniqueOrThrow({ where: { id }, include: { queue: true, requester: { select: PUBLIC_REQUESTER_SELECT }, assignments: { include: { user: { select: STAFF_USER_SELECT } } } } });
            });
        } catch (error) {
            if (error instanceof Error && error.message === 'TICKET_VERSION_CONFLICT') {
                const current = await prisma.ticket.findUnique({ where: { id }, select: { id: true, key: true, version: true, status: true, priority: true, queueId: true, categoryId: true, updatedAt: true } });
                return NextResponse.json({ error: 'Ticket changed since it was loaded. Refresh and review the latest values.', currentTicket: current, currentVersion: current?.version }, { status: 409 });
            }
            throw error;
        }

        if (timelineEvents.length > 0) {
            const watchers = await prisma.ticketWatcher.findMany({ where: { ticketId: id, userId: { not: session.user.id } }, include: { user: { select: { id: true, email: true } } } });
            const recipients = [{ id: updatedTicket.requester.id, email: updatedTicket.requester.email }, ...updatedTicket.assignments.map((assignment) => ({ id: assignment.user.id, email: assignment.user.email })), ...watchers.map((watcher) => watcher.user)];
            const emails = [...new Set(recipients.filter((recipient) => recipient.id !== session.user.id).map((recipient) => recipient.email).filter(Boolean))];
            if (emails.length > 0) void sendTicketUpdatedEmail(emails, updatedTicket.key, updatedTicket.title, 'Ticket Updated', timelineEvents.map((event) => event.content).join(', '));
        }
        if (changes.status === 'RESOLVED') fireWebhook('ticket.resolved', { ticketId: id, key: updatedTicket.key, title: updatedTicket.title });
        void auditLog({ userId: session.user.id, action: 'ticket.updated', entity: 'ticket', entityId: id, metadata: { changes, tagIds: uniqueTagIds, expectedVersion, resultingVersion: updatedTicket.version, sla: slaAudit } });
        return NextResponse.json(assertApiResponseSafe(updatedTicket));
    } catch (error) {
        logger.error('Failed to update ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/tickets/[id] — history-preserving withdrawal.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        const { id } = await params;
        const expectedVersion = Number(req.nextUrl.searchParams.get('expectedVersion'));
        if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: 'A valid expectedVersion is required' }, { status: 400 });
        const ticket = await prisma.ticket.findUnique({ where: { id }, include: { _count: { select: { assignments: true } } } });
        if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        if (!canDeleteTicket(session.user.id, session.user.role, { requesterId: ticket.requesterId, assignmentCount: ticket._count.assignments })) {
            if (ticket.requesterId === session.user.id && ticket._count.assignments > 0) return NextResponse.json({ error: 'Cannot withdraw a ticket that has been assigned. Contact an agent.' }, { status: 400 });
            return NextResponse.json({ error: 'Only the ticket requester or a Super Admin can withdraw this ticket' }, { status: 403 });
        }
        if (ticket.status === 'WITHDRAWN') return NextResponse.json({ error: 'Ticket is already withdrawn' }, { status: 409 });
        if (ticket.version !== expectedVersion) return NextResponse.json({ error: 'Ticket changed since it was loaded. Refresh before withdrawing it.', currentVersion: ticket.version }, { status: 409 });

        const withdrawnAt = new Date();
        try {
            await prisma.$transaction(async (tx) => {
                const changed = await tx.ticket.updateMany({ where: { id, version: expectedVersion }, data: { status: 'WITHDRAWN', resolvedAt: null, closedAt: withdrawnAt, version: { increment: 1 } } });
                if (changed.count !== 1) throw new Error('TICKET_VERSION_CONFLICT');
                await tx.timelineEvent.create({ data: { ticketId: id, userId: session.user.id, type: 'STATUS_CHANGE', content: `Ticket withdrawn from ${ticket.status}`, metadata: { from: ticket.status, to: 'WITHDRAWN', historyPreserved: true } } });
            });
        } catch (error) {
            if (error instanceof Error && error.message === 'TICKET_VERSION_CONFLICT') {
                const current = await prisma.ticket.findUnique({ where: { id }, select: { version: true } });
                return NextResponse.json({ error: 'Ticket changed since it was loaded. Refresh before withdrawing it.', currentVersion: current?.version }, { status: 409 });
            }
            throw error;
        }
        void auditLog({ userId: session.user.id, action: 'ticket.withdrawn', entity: 'ticket', entityId: id, metadata: { key: ticket.key, previousStatus: ticket.status, historyPreserved: true } });
        return NextResponse.json({ success: true, withdrawn: true });
    } catch (error) {
        logger.error('Failed to withdraw ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}