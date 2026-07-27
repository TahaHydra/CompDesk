import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateTicketSchema } from '@/lib/validations';
import { canTransition, isAgentOrAbove } from '@/lib/utils';
import { sendTicketUpdatedEmail } from '@/lib/email';
import { fireWebhook } from '@/lib/webhooks';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { canAccessQueue, canAccessTicket, canDeleteTicket } from '@/lib/permissions';
import { fieldsVisibleToRoleFromSnapshot, parseTicketFormSchemaSnapshot } from '@/lib/ticket-form/validation';
import { authenticatedAttachmentUrl, resolveStoredAttachmentPath } from '@/lib/attachment-storage';
import { unlink } from 'fs/promises';

// GET /api/tickets/[id]
export async function GET(
    req: NextRequest,
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
            ticket.timeline = ticket.timeline.filter((e) => e.type !== 'INTERNAL_NOTE');
        }
        const snapshot = parseTicketFormSchemaSnapshot(ticket.formSchemaSnapshot);
        const historicalFields = fieldsVisibleToRoleFromSnapshot(ticket.formSchemaSnapshot, session.user.role);
        const storedValues = ticket.submittedFormValues && typeof ticket.submittedFormValues === 'object' && !Array.isArray(ticket.submittedFormValues)
            ? ticket.submittedFormValues as Record<string, unknown>
            : {};
        const attachmentUrlsByStoredPath = new Map<string, string>(
            ticket.attachments.map((attachment) => [attachment.path, authenticatedAttachmentUrl(attachment.id)] as const)
        );
        const attachmentUrlsByIdentity = new Map<string, string>(
            ticket.attachments.map((attachment) => [`${attachment.filename}:${attachment.size}`, authenticatedAttachmentUrl(attachment.id)] as const)
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
                firstResponseBreached: !ticket.firstResponseAt && minutesSinceCreation > sla.firstResponseMinutes,
                resolutionBreached: ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && minutesSinceCreation > sla.resolutionMinutes,
                dueAt: ticket.dueAt,
            };
        }

        // Non-exclusive recent-viewer presence indicator. Never used for authorization.
        let presenceInfo = null;
        if (ticket.lockedBy && ticket.lockedAt) {
            const lockAge = (Date.now() - new Date(ticket.lockedAt).getTime()) / 60000;
            if (lockAge < 5) { // Lock expires after 5 minutes
                const lockUser = await prisma.user.findUnique({
                    where: { id: ticket.lockedBy },
                    select: { name: true },
                });
                presenceInfo = { lastViewer: lockUser?.name, lastViewedAt: ticket.lockedAt, exclusive: false };
            }
        }

        // Record recent viewer activity for agents. This is not a lock.
        if (isAgentOrAbove(session.user.role)) {
            await prisma.ticket.update({
                where: { id },
                data: { lockedBy: session.user.id, lockedAt: new Date() },
            });
        }

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
                ...attachment,
                path: authenticatedAttachmentUrl(attachment.id),
            })),
            formSchemaSnapshot: undefined,
            submittedFormValues: undefined,
        };
        return NextResponse.json({
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
        });
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
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await req.json();
        const parsed = updateTicketSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
        }

        const existingTicket = await prisma.ticket.findUnique({ where: { id } });
        if (!existingTicket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        const hasAccess = await canAccessTicket(session.user.id, session.user.role, existingTicket);
        if (!hasAccess) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const data = parsed.data;
        if (session.user.role === 'USER') {
            const protectedKeys = ['title', 'description', 'status', 'queueId', 'categoryId', 'priority', 'severity', 'tagIds'] as const;
            if (protectedKeys.some((key) => data[key] !== undefined)) {
                return NextResponse.json({ error: 'Only agents can change ticket content, status, routing, assignment, priority, severity, or tags' }, { status: 403 });
            }
        }
        if (
            (session.user.role === 'AGENT' || session.user.role === 'ADMIN') &&
            data.queueId &&
            data.queueId !== existingTicket.queueId &&
            !(await canAccessQueue(session.user.id, session.user.role, data.queueId))
        ) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const targetQueueId = data.queueId ?? existingTicket.queueId;
        if (data.queueId && data.queueId !== existingTicket.queueId) {
            const currentAssignees = await prisma.ticketAssignee.findMany({
                where: { ticketId: id },
                include: { user: { select: { id: true, role: true, isActive: true } } },
            });
            for (const assignment of currentAssignees) {
                if (!assignment.user.isActive || !(await canAccessQueue(assignment.user.id, assignment.user.role, targetQueueId))) {
                    return NextResponse.json({ error: 'Remove assignees who cannot access the destination department before moving this ticket' }, { status: 409 });
                }
            }
        }
        const targetCategoryId = data.categoryId !== undefined ? data.categoryId : existingTicket.categoryId;
        if (targetCategoryId && (data.categoryId !== undefined || data.queueId !== undefined)) {
            const category = await prisma.category.findUnique({
                where: { id: targetCategoryId },
                select: { queueId: true, isActive: true, archivedAt: true },
            });
            if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 });
            if (category.queueId !== targetQueueId) {
                return NextResponse.json({ error: 'The selected category does not belong to the ticket department' }, { status: 400 });
            }
            if (data.categoryId !== undefined && (!category.isActive || category.archivedAt)) {
                return NextResponse.json({ error: 'Archived categories cannot be newly assigned' }, { status: 400 });
            }
        }

        const timelineEvents: Array<{ type: string; content: string; metadata?: Record<string, unknown> }> = [];

        // Status transition validation
        if (data.status && data.status !== existingTicket.status) {
            if (!canTransition(existingTicket.status, data.status, session.user.role)) {
                return NextResponse.json(
                    { error: `Cannot transition from ${existingTicket.status} to ${data.status}` },
                    { status: 400 }
                );
            }
            timelineEvents.push({
                type: 'STATUS_CHANGE',
                content: `Status changed from ${existingTicket.status} to ${data.status}`,
                metadata: { from: existingTicket.status, to: data.status },
            });

            // Set timestamps
            if (data.status === 'RESOLVED') {
                (data as any).resolvedAt = new Date();
            }
            if (data.status === 'CLOSED') {
                (data as any).closedAt = new Date();
            }
        }

        // Priority change
        if (data.priority && data.priority !== existingTicket.priority) {
            timelineEvents.push({
                type: 'PRIORITY_CHANGE',
                content: `Priority changed from ${existingTicket.priority} to ${data.priority}`,
                metadata: { from: existingTicket.priority, to: data.priority },
            });
        }

        const uniqueTagIds = data.tagIds ? [...new Set(data.tagIds)] : undefined;
        if (uniqueTagIds && uniqueTagIds.length > 0) {
            const validTagCount = await prisma.tag.count({ where: { id: { in: uniqueTagIds } } });
            if (validTagCount !== uniqueTagIds.length) {
                return NextResponse.json({ error: 'One or more selected tags are invalid' }, { status: 400 });
            }
        }

        const updateData = { ...data } as Record<string, unknown>;
        delete (updateData as any).tagIds;
        const updatedTicket = await prisma.$transaction(async (tx) => {
            if (uniqueTagIds) {
                await tx.ticketTag.deleteMany({ where: { ticketId: id } });
                if (uniqueTagIds.length > 0) {
                    await tx.ticketTag.createMany({
                        data: uniqueTagIds.map((tagId) => ({ ticketId: id, tagId })),
                    });
                }
            }

            const updated = await tx.ticket.update({
                where: { id },
                data: updateData as any,
                include: {
                    queue: true,
                    requester: true,
                    assignments: { include: { user: true } },
                },
            });

            if (timelineEvents.length > 0) {
                await tx.timelineEvent.createMany({
                    data: timelineEvents.map((event) => ({
                        ticketId: id,
                        userId: session.user.id,
                        type: event.type as any,
                        content: event.content,
                        metadata: (event.metadata as any) ?? undefined,
                    })),
                });
            }
            return updated;
        });
        if (timelineEvents.length > 0) {
            const watchers = await prisma.ticketWatcher.findMany({
                where: { ticketId: id, userId: { not: session.user.id } },
                include: { user: { select: { id: true, email: true } } },
            });
            const recipients = [
                { id: updatedTicket.requester.id, email: updatedTicket.requester.email },
                ...updatedTicket.assignments.map((assignment) => ({
                    id: assignment.user.id,
                    email: assignment.user.email,
                })),
                ...watchers.map((watcher) => watcher.user),
            ];
            const emails = [...new Set(recipients
                .filter((recipient) => recipient.id !== session.user.id)
                .map((recipient) => recipient.email)
                .filter(Boolean))];
            if (emails.length > 0) {
                const updateType = timelineEvents.map((e) => e.content).join(', ');
                void sendTicketUpdatedEmail(emails, updatedTicket.key, updatedTicket.title, 'Ticket Updated', updateType);
            }
        }

        // Webhook for resolved
        if (data.status === 'RESOLVED') {
            fireWebhook('ticket.resolved', {
                ticketId: id,
                key: updatedTicket.key,
                title: updatedTicket.title,
            });
        }

        // Audit log
        auditLog({
            userId: session.user.id,
            action: 'ticket.updated',
            entity: 'ticket',
            entityId: id,
            metadata: { changes: data },
        });

        return NextResponse.json(updatedTicket);
    } catch (error) {
        logger.error('Failed to update ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

// DELETE /api/tickets/[id] — super admins can delete any ticket; others can
// only withdraw a ticket they requested while it is still unassigned.
export async function DELETE(
    req: NextRequest,
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
            include: { attachments: true, _count: { select: { assignments: true } } },
        });
        if (!ticket) {
            return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }

        if (!canDeleteTicket(session.user.id, session.user.role, { requesterId: ticket.requesterId, assignmentCount: ticket._count.assignments })) {
            if (ticket.requesterId === session.user.id && ticket._count.assignments > 0) {
                return NextResponse.json({ error: 'Cannot delete a ticket that has been assigned. Contact an agent.' }, { status: 400 });
            }
            return NextResponse.json({ error: 'Only the ticket requester can delete this ticket' }, { status: 403 });
        }

        // Delete all associated records
        await prisma.$transaction([
            prisma.timelineEvent.deleteMany({ where: { ticketId: id } }),
            prisma.ticketWatcher.deleteMany({ where: { ticketId: id } }),
            prisma.ticketTag.deleteMany({ where: { ticketId: id } }),
            prisma.ticketAssignee.deleteMany({ where: { ticketId: id } }),
            prisma.attachment.deleteMany({ where: { ticketId: id } }),
            prisma.ticket.delete({ where: { id } }),
        ]);
        await Promise.all(ticket.attachments.map(async (attachment) => {
            const filePath = resolveStoredAttachmentPath(attachment.path, ticket.id);
            if (filePath) await unlink(filePath).catch(() => undefined);
        }));

        auditLog({
            userId: session.user.id,
            action: 'ticket.deleted',
            entity: 'ticket',
            entityId: id,
            metadata: { key: ticket.key, title: ticket.title },
        });

        return NextResponse.json({ success: true });
    } catch (error) {
        logger.error('Failed to delete ticket', { error });
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
