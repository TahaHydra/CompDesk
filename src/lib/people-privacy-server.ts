import type { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getAdministeredQueueIds } from '@/lib/permissions';
import {
    PEOPLE_PRIVACY_SETTING_KEY,
    parsePeoplePrivacy,
    redactPerson,
    visibleFieldsFor,
    type PeoplePrivacyPolicy,
    type PrivacyViewer,
} from '@/lib/people-privacy';

export type PrivacyContext = { policy: PeoplePrivacyPolicy; viewer: PrivacyViewer };

export async function getPeoplePrivacyPolicy(): Promise<PeoplePrivacyPolicy> {
    const setting = await prisma.appSetting.findUnique({ where: { key: PEOPLE_PRIVACY_SETTING_KEY } });
    return parsePeoplePrivacy(setting?.value);
}

/** Loads the policy and the viewer's administered departments once per request. */
export async function loadPrivacyContext(user: { id: string; role: Role }): Promise<PrivacyContext> {
    const [policy, administered] = await Promise.all([
        getPeoplePrivacyPolicy(),
        user.role === 'ADMIN' ? getAdministeredQueueIds(user.id) : Promise.resolve([] as string[]),
    ]);
    return { policy, viewer: { id: user.id, role: user.role, administeredQueueIds: new Set(administered) } };
}

type Person = { id: string; email?: string | null; role?: Role | null };

export type Department = { id: string; name: string };

/** Departments where each user works as staff (direct or through a group), sorted by name. */
export async function staffDepartmentsByUser(userIds: readonly string[]): Promise<Map<string, Department[]>> {
    const result = new Map<string, Map<string, string>>();
    if (userIds.length === 0) return new Map();
    const [direct, viaGroups] = await Promise.all([
        prisma.queueMember.findMany({
            where: { userId: { in: [...userIds] }, role: { in: ['agent', 'admin'] } },
            select: { userId: true, queue: { select: { id: true, name: true } } },
        }),
        prisma.groupMember.findMany({
            where: { userId: { in: [...userIds] } },
            select: { userId: true, group: { select: { queueAssignments: { where: { role: { in: ['agent', 'admin'] } }, select: { queue: { select: { id: true, name: true } } } } } } },
        }),
    ]);
    const add = (userId: string, queue: Department) => {
        if (!result.has(userId)) result.set(userId, new Map());
        result.get(userId)!.set(queue.id, queue.name);
    };
    for (const row of direct) add(row.userId, row.queue);
    for (const row of viaGroups) for (const assignment of row.group.queueAssignments) add(row.userId, assignment.queue);
    return new Map([...result].map(([userId, queues]) => [
        userId,
        [...queues].map(([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name)),
    ]));
}

const normalizedName = (name: string) => name.trim().toLocaleLowerCase();

/**
 * When different people in one view share a name, returns a short hint for each of them:
 * the part of their email before "@" when the viewer may see it, otherwise their department(s)
 * (only the departments in `contextQueueIds` for requesters). Unique names get no hint.
 */
export async function sameNameHints(
    people: ReadonlyArray<{ id: string; name: string }>,
    { policy, viewer }: PrivacyContext,
    contextQueueIds: readonly string[],
): Promise<Record<string, string>> {
    const byName = new Map<string, Set<string>>();
    for (const person of people) {
        if (!person?.id || !person.name) continue;
        const key = normalizedName(person.name);
        if (!byName.has(key)) byName.set(key, new Set());
        byName.get(key)!.add(person.id);
    }
    const duplicateIds = [...byName.values()].filter((ids) => ids.size > 1).flatMap((ids) => [...ids]);
    if (duplicateIds.length === 0) return {};
    const [users, departments] = await Promise.all([
        prisma.user.findMany({ where: { id: { in: duplicateIds } }, select: { id: true, email: true, role: true } }),
        staffDepartmentsByUser(duplicateIds),
    ]);
    const hints: Record<string, string> = {};
    for (const user of users) {
        const visible = visibleFieldsFor(policy, viewer, user, contextQueueIds);
        const userDepartments = (departments.get(user.id) ?? [])
            .filter((department) => viewer.role !== 'USER' || contextQueueIds.includes(department.id))
            .map((department) => department.name);
        const hint = visible.email ? user.email.split('@')[0] : userDepartments.join(', ');
        if (hint) hints[user.id] = hint;
    }
    return hints;
}

/**
 * Applies the policy to the people embedded in a ticket payload (requester, assignees,
 * escalation target), using the ticket's department as the relationship context.
 */
export function redactTicketPeople<T extends {
    queueId: string;
    requester?: Person | null;
    assignments?: Array<{ user: Person }>;
    assignees?: Person[];
    escalatedTo?: Person | null;
}>(ticket: T, { policy, viewer }: PrivacyContext): T {
    const context = [ticket.queueId];
    const redact = <P extends Person>(person: P) => redactPerson(person, policy, viewer, context);
    return {
        ...ticket,
        ...(ticket.requester ? { requester: redact(ticket.requester) } : {}),
        ...(ticket.assignments ? { assignments: ticket.assignments.map((assignment) => ({ ...assignment, user: redact(assignment.user) })) } : {}),
        ...(ticket.assignees ? { assignees: ticket.assignees.map(redact) } : {}),
        ...(ticket.escalatedTo ? { escalatedTo: redact(ticket.escalatedTo) } : {}),
    };
}
