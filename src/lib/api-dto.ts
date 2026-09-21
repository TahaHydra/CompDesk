import { Prisma, type Role } from '@prisma/client';
import { fieldsVisibleToRoleFromSnapshot, parseTicketFormSchemaSnapshot } from '@/lib/ticket-form/validation';

/** Apply field visibility at every ticket response boundary, including lists and replays. */
export function projectTicketFormForRole<T extends { formSchemaSnapshot?: unknown; submittedFormValues?: unknown }>(ticket: T, role: Role) {
    const snapshot = parseTicketFormSchemaSnapshot(ticket.formSchemaSnapshot);
    const fields = fieldsVisibleToRoleFromSnapshot(ticket.formSchemaSnapshot, role);
    const values = ticket.submittedFormValues && typeof ticket.submittedFormValues === 'object' && !Array.isArray(ticket.submittedFormValues)
        ? ticket.submittedFormValues as Record<string, unknown> : {};
    return {
        ...ticket,
        formSchemaSnapshot: snapshot ? { ...snapshot, fields } : null,
        submittedFormValues: Object.fromEntries(fields
            .filter((field) => Object.prototype.hasOwnProperty.call(values, field.fieldKey))
            .map((field) => [field.fieldKey, values[field.fieldKey]])),
    };
}

export const PUBLIC_REQUESTER_SELECT = {
    id: true,
    name: true,
    email: true,
    image: true,
} satisfies Prisma.UserSelect;

export const TIMELINE_USER_SELECT = {
    id: true,
    name: true,
    image: true,
} satisfies Prisma.UserSelect;

export const STAFF_USER_SELECT = {
    id: true,
    name: true,
    email: true,
    image: true,
    role: true,
    isActive: true,
} satisfies Prisma.UserSelect;

export const ADMIN_USER_SELECT = {
    id: true,
    entraObjectId: true,
    email: true,
    emailVerified: true,
    name: true,
    image: true,
    role: true,
    isActive: true,
    isDemo: true,
    preferredLanguage: true,
    createdAt: true,
    updatedAt: true,
} satisfies Prisma.UserSelect;

export interface PublicRequesterDto {
    id: string;
    name: string;
    email: string;
    image: string | null;
}

export interface StaffUserDto extends PublicRequesterDto {
    role: Role;
    isActive: boolean;
}

export function toPublicRequesterDto(user: PublicRequesterDto): PublicRequesterDto {
    return { id: user.id, name: user.name, email: user.email, image: user.image };
}

export function toStaffUserDto(user: StaffUserDto): StaffUserDto {
    return { ...toPublicRequesterDto(user), role: user.role, isActive: user.isActive };
}

export const FORBIDDEN_API_RESPONSE_KEYS = new Set([
    'passwordHash',
    'password_hash',
    'access_token',
    'refresh_token',
    'id_token',
    'sessionToken',
    'session_token',
    'keyHash',
    'key_hash',
    'smtp_password',
    'azure_ad_client_secret',
    'webhook_secret',
    'encryption_key',
]);

export function findForbiddenApiResponseKey(value: unknown, seen = new WeakSet<object>()): string | null {
    if (!value || typeof value !== 'object') return null;
    if (seen.has(value)) return null;
    seen.add(value);
    if (Array.isArray(value)) {
        for (const item of value) {
            const forbidden = findForbiddenApiResponseKey(item, seen);
            if (forbidden) return forbidden;
        }
        return null;
    }
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_API_RESPONSE_KEYS.has(key)) return key;
        const forbidden = findForbiddenApiResponseKey(child, seen);
        if (forbidden) return forbidden;
    }
    return null;
}

export function assertApiResponseSafe<T>(value: T): T {
    const forbidden = findForbiddenApiResponseKey(value);
    if (forbidden) throw new Error(`Refusing API response containing forbidden key: ${forbidden}`);
    return value;
}
