import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { Role, TicketStatus } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessTicket, getQueueInboxQueueIds } from '@/lib/permissions';
import { visibleFieldsFor } from '@/lib/people-privacy';
import { loadPrivacyContext, staffDepartmentsByUser } from '@/lib/people-privacy-server';

const OPEN_STATUSES: TicketStatus[] = ['NEW', 'OPEN', 'PENDING_USER', 'PENDING_AGENT'];
// Unknown, unrelated and inaccessible people all look the same, so ids cannot be probed.
const notFound = () => NextResponse.json({ error: 'Person not found' }, { status: 404 });

/**
 * Decides whether the viewer has a working relationship with the person, and through which
 * departments. Returns null when there is none.
 */
type Relationship = { context: string[]; subjectIsTicketRequester: boolean };

async function relationship(viewer: { id: string; role: Role }, subjectId: string, ticketId: string | null, subjectDepartmentIds: string[]): Promise<Relationship | null> {
    const via = (context: string[], subjectIsTicketRequester = false) => ({ context, subjectIsTicketRequester });
    if (viewer.id === subjectId) return via(subjectDepartmentIds);
    if (ticketId) {
        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            select: { id: true, requesterId: true, queueId: true, assignments: { select: { userId: true } }, watchers: { select: { userId: true } } },
        });
        if (!ticket || !await canAccessTicket(viewer.id, viewer.role, ticket)) return null;
        // Both sides are checked: the viewer can open the ticket AND the person really is on it.
        const onTicket = ticket.requesterId === subjectId
            || ticket.assignments.some((assignment) => assignment.userId === subjectId)
            || (viewer.role !== 'USER' && ticket.watchers.some((watcher) => watcher.userId === subjectId))
            || await prisma.timelineEvent.count({
                where: { ticketId: ticket.id, userId: subjectId, ...(viewer.role === 'USER' ? { type: { not: 'INTERNAL_NOTE' } } : {}) },
            }) > 0;
        return onTicket ? via([ticket.queueId], ticket.requesterId === subjectId) : null;
    }
    if (viewer.role === 'SUPER_ADMIN') return via(subjectDepartmentIds);
    if (viewer.role === 'USER') return null;
    // Without a ticket, staff can open cards of staff who work in a department they can reach.
    const reachable = new Set(await getQueueInboxQueueIds(viewer.id, viewer.role) ?? []);
    const shared = subjectDepartmentIds.filter((queueId) => reachable.has(queueId));
    return shared.length > 0 ? via(shared) : null;
}

// GET /api/users/[id]/card?ticketId=…: the person card shown when hovering or clicking a name.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const subjectId = z.guid().safeParse((await params).id);
    const rawTicketId = req.nextUrl.searchParams.get('ticketId');
    const ticketId = rawTicketId ? z.guid().safeParse(rawTicketId) : null;
    if (!subjectId.success || (ticketId && !ticketId.success)) return notFound();

    const subject = await prisma.user.findUnique({
        where: { id: subjectId.data },
        select: { id: true, name: true, image: true, email: true, role: true, isActive: true, preferredLanguage: true, jobTitle: true },
    });
    if (!subject) return notFound();

    const viewer = { id: session.user.id, role: session.user.role };
    const departments = (await staffDepartmentsByUser([subject.id])).get(subject.id) ?? [];
    const related = await relationship(viewer, subject.id, ticketId?.data ?? null, departments.map((department) => department.id));
    if (!related) return notFound();
    const { context } = related;

    const privacy = await loadPrivacyContext(viewer);
    const visible = visibleFieldsFor(privacy.policy, privacy.viewer, subject, context, { subjectIsTicketRequester: related.subjectIsTicketRequester });
    const isStaffViewer = viewer.role !== 'USER';
    const isSelf = viewer.id === subject.id;

    // Departments the viewer can reach themself (null: every department, for Super Admins).
    const scope = isStaffViewer && !isSelf ? await getQueueInboxQueueIds(viewer.id, viewer.role) : null;
    let openRequests: number | undefined;
    if (isStaffViewer && !isSelf) {
        openRequests = await prisma.ticket.count({
            where: { requesterId: subject.id, status: { in: OPEN_STATUSES }, ...(scope ? { queueId: { in: scope } } : {}) },
        });
    }

    return NextResponse.json({
        id: subject.id,
        name: subject.name,
        image: subject.image,
        role: subject.role,
        isSelf,
        // Only departments relevant to the viewer: the one they reach the person through and, for
        // staff, departments they work in themselves. Super Admins and the person see them all.
        departments: departments
            .filter((department) => isSelf || viewer.role === 'SUPER_ADMIN' || context.includes(department.id)
                || (isStaffViewer && Boolean(scope?.includes(department.id))))
            .map((department) => department.name),
        ...(isStaffViewer ? { isActive: subject.isActive } : {}),
        ...(visible.email ? { email: subject.email } : {}),
        ...(visible.language ? { preferredLanguage: subject.preferredLanguage } : {}),
        ...(visible.jobTitle && subject.jobTitle ? { jobTitle: subject.jobTitle } : {}),
        ...(openRequests !== undefined ? { openRequests, requestsHref: `/tickets?view=all&requesterId=${subject.id}` } : {}),
        ...(viewer.role === 'SUPER_ADMIN' && !isSelf ? { manageHref: '/admin/users' } : {}),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
}
