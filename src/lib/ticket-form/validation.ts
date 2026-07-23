import { BuiltInTicketField, FormFieldType, Role } from '@prisma/client';
import { sanitizeHtml } from '@/lib/utils';
import { isFieldConditionVisible } from '@/lib/ticket-form/conditions';
import type {
    ResolvedTicketForm,
    TicketFormFieldDefinition,
    TicketFormSchemaSnapshot,
    UploadedFieldFile,
    ValidatedTicketSubmission,
} from '@/lib/ticket-form/types';

const PRIORITIES = new Set(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
const SEVERITIES = new Set(['S1', 'S2', 'S3', 'S4']);

export class TicketFormValidationError extends Error {
    constructor(public errors: Record<string, string>) {
        super('Ticket form validation failed');
        this.name = 'TicketFormValidationError';
    }
}

function empty(value: unknown): boolean {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function parseUploadedFiles(value: unknown): UploadedFieldFile[] | null {
    if (!Array.isArray(value)) return null;
    const files: UploadedFieldFile[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const candidate = item as Record<string, unknown>;
        if (
            typeof candidate.url !== 'string' || !candidate.url.startsWith('/uploads/') ||
            typeof candidate.filename !== 'string' || !candidate.filename.trim() ||
            typeof candidate.mimetype !== 'string' ||
            typeof candidate.size !== 'number' || !Number.isFinite(candidate.size) || candidate.size < 0
        ) return null;
        files.push({
            url: candidate.url,
            filename: candidate.filename.trim(),
            mimetype: candidate.mimetype,
            size: candidate.size,
        });
    }
    return files;
}

function validateText(field: TicketFormFieldDefinition, value: unknown, errors: Record<string, string>): string | null {
    if (typeof value !== 'string') {
        errors[field.fieldKey] = `${field.label} must be text`;
        return null;
    }
    const cleaned = sanitizeHtml(value.trim());
    const min = field.validationRules?.minLength;
    const max = field.validationRules?.maxLength;
    if (min !== undefined && cleaned.length < min) {
        errors[field.fieldKey] = `${field.label} must be at least ${min} characters`;
        return null;
    }
    if (max !== undefined && cleaned.length > max) {
        errors[field.fieldKey] = `${field.label} must be at most ${max} characters`;
        return null;
    }
    if (field.validationRules?.regex) {
        try {
            if (!new RegExp(field.validationRules.regex).test(cleaned)) {
                errors[field.fieldKey] = `${field.label} format is invalid`;
                return null;
            }
        } catch {
            errors[field.fieldKey] = `${field.label} has an invalid configured pattern`;
            return null;
        }
    }
    return cleaned;
}

function validateFieldValue(
    field: TicketFormFieldDefinition,
    value: unknown,
    errors: Record<string, string>
): unknown {
    if (field.type === FormFieldType.TEXT || field.type === FormFieldType.TEXTAREA) {
        return validateText(field, value, errors);
    }
    if (field.type === FormFieldType.DROPDOWN) {
        if (typeof value !== 'string') {
            errors[field.fieldKey] = `${field.label} must be a single selection`;
            return undefined;
        }
        if (field.options.length > 0 && !field.options.includes(value)) {
            errors[field.fieldKey] = `${field.label} has an invalid option`;
            return undefined;
        }
        return value;
    }
    if (field.type === FormFieldType.MULTISELECT) {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
            errors[field.fieldKey] = `${field.label} must be a list of selections`;
            return undefined;
        }
        const selected = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
        if (field.builtIn !== BuiltInTicketField.TAGS && field.options.length > 0 && selected.some((item) => !field.options.includes(item))) {
            errors[field.fieldKey] = `${field.label} contains an invalid option`;
            return undefined;
        }
        return selected;
    }
    if (field.type === FormFieldType.CHECKBOX) {
        if (typeof value !== 'boolean') {
            errors[field.fieldKey] = `${field.label} must be true or false`;
            return undefined;
        }
        if (field.required && !value) {
            errors[field.fieldKey] = `${field.label} must be checked`;
            return undefined;
        }
        return value;
    }
    if (field.type === FormFieldType.DATE) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
            errors[field.fieldKey] = `${field.label} must be a valid date`;
            return undefined;
        }
        return value;
    }
    if (field.type === FormFieldType.FILE) {
        const files = parseUploadedFiles(value);
        if (!files) {
            errors[field.fieldKey] = `${field.label} contains invalid file references`;
            return undefined;
        }
        const allowedTypes = field.validationRules?.allowedFileTypes ?? [];
        if (allowedTypes.length > 0 && files.some((file) => !allowedTypes.includes(file.mimetype))) {
            errors[field.fieldKey] = `${field.label} contains a file type that is not allowed`;
            return undefined;
        }
        return files;
    }
    errors[field.fieldKey] = `${field.label} has an unsupported field type`;
    return undefined;
}

export function validateTicketFormSubmission(
    resolved: ResolvedTicketForm,
    inputValues: Record<string, unknown>
): ValidatedTicketSubmission {
    const errors: Record<string, string> = {};
    const knownFields = new Map(resolved.allFields.map((field) => [field.fieldKey, field]));
    const visibleFields = new Map(resolved.fields.map((field) => [field.fieldKey, field]));

    for (const key of Object.keys(inputValues)) {
        const known = knownFields.get(key);
        if (!known) errors[key] = 'Unknown field';
        else if (!visibleFields.has(key) || !known.editableBy.includes(resolved.role)) errors[key] = 'This field is not editable for your role';
        else if (!isFieldConditionVisible(known.conditionalRules, inputValues)) errors[key] = 'A hidden conditional field cannot be submitted';
    }

    const sanitized: Record<string, unknown> = {};
    for (const field of resolved.fields) {
        if (!field.editableBy.includes(resolved.role)) continue;
        if (!isFieldConditionVisible(field.conditionalRules, inputValues)) continue;
        const supplied = inputValues[field.fieldKey];
        const value = empty(supplied) ? field.defaultValue : supplied;
        if (empty(value)) {
            if (field.required) errors[field.fieldKey] = `${field.label} is required`;
            continue;
        }
        const validated = validateFieldValue(field, value, errors);
        if (validated !== undefined && validated !== null) sanitized[field.fieldKey] = validated;
    }

    if (Object.keys(errors).length > 0) throw new TicketFormValidationError(errors);

    const builtInValue = (builtIn: BuiltInTicketField): unknown => {
        const field = resolved.allFields.find((candidate) => candidate.builtIn === builtIn);
        return field ? sanitized[field.fieldKey] : undefined;
    };
    const customValues = Object.fromEntries(
        Object.entries(sanitized).filter(([key]) => !knownFields.get(key)?.builtIn)
    );
    const titleValue = builtInValue(BuiltInTicketField.TITLE);
    const fallbackTitle = resolved.category?.name || resolved.template.name || 'Support request';
    const priorityValue = builtInValue(BuiltInTicketField.PRIORITY);
    const severityValue = builtInValue(BuiltInTicketField.SEVERITY);
    const tagsValue = builtInValue(BuiltInTicketField.TAGS);
    const attachmentsValue = builtInValue(BuiltInTicketField.ATTACHMENTS);

    return {
        title: typeof titleValue === 'string' && titleValue.trim() ? titleValue.trim() : fallbackTitle,
        description: typeof builtInValue(BuiltInTicketField.DESCRIPTION) === 'string'
            ? String(builtInValue(BuiltInTicketField.DESCRIPTION))
            : null,
        priority: typeof priorityValue === 'string' && PRIORITIES.has(priorityValue)
            ? (priorityValue as ValidatedTicketSubmission['priority'])
            : 'NORMAL',
        severity: typeof severityValue === 'string' && SEVERITIES.has(severityValue)
            ? (severityValue as ValidatedTicketSubmission['severity'])
            : null,
        tagIds: Array.isArray(tagsValue) ? tagsValue.filter((value): value is string => typeof value === 'string') : [],
        attachments: Array.isArray(attachmentsValue) ? (attachmentsValue as UploadedFieldFile[]) : [],
        customValues,
        submittedValues: sanitized,
    };
}

export function parseTicketFormSchemaSnapshot(value: unknown): TicketFormSchemaSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    if (typeof source.templateId !== 'string' || typeof source.templateName !== 'string' || typeof source.version !== 'number' || !Array.isArray(source.fields)) {
        return null;
    }
    const validTypes = new Set(Object.values(FormFieldType));
    const validBuiltIns = new Set(Object.values(BuiltInTicketField));
    const validRoles = new Set(Object.values(Role));
    const fields: TicketFormFieldDefinition[] = [];
    for (const item of source.fields) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const field = item as Record<string, unknown>;
        if (
            typeof field.id !== 'string' || typeof field.fieldKey !== 'string' || typeof field.label !== 'string' ||
            typeof field.type !== 'string' || !validTypes.has(field.type as FormFieldType)
        ) continue;
        const visibleTo = Array.isArray(field.visibleTo)
            ? field.visibleTo.filter((role): role is Role => typeof role === 'string' && validRoles.has(role as Role))
            : Object.values(Role);
        const editableBy = Array.isArray(field.editableBy)
            ? field.editableBy.filter((role): role is Role => typeof role === 'string' && validRoles.has(role as Role))
            : visibleTo;
        fields.push({
            id: field.id,
            fieldKey: field.fieldKey,
            label: field.label,
            type: field.type as FormFieldType,
            builtIn: typeof field.builtIn === 'string' && validBuiltIns.has(field.builtIn as BuiltInTicketField)
                ? field.builtIn as BuiltInTicketField
                : null,
            placeholder: typeof field.placeholder === 'string' ? field.placeholder : null,
            helpText: typeof field.helpText === 'string' ? field.helpText : null,
            required: field.required === true,
            defaultValue: field.defaultValue,
            options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [],
            validationRules: field.validationRules && typeof field.validationRules === 'object' && !Array.isArray(field.validationRules)
                ? field.validationRules as TicketFormFieldDefinition['validationRules']
                : null,
            conditionalRules: field.conditionalRules && typeof field.conditionalRules === 'object' && !Array.isArray(field.conditionalRules)
                ? field.conditionalRules as TicketFormFieldDefinition['conditionalRules']
                : null,
            visibleTo,
            editableBy,
            sortOrder: typeof field.sortOrder === 'number' ? field.sortOrder : 0,
            width: typeof field.width === 'number' ? field.width : 12,
            isActive: field.isActive !== false,
        });
    }
    return { templateId: source.templateId, templateName: source.templateName, version: source.version, fields };
}

export function fieldsVisibleToRoleFromSnapshot(
    snapshotValue: unknown,
    role: Role
): TicketFormFieldDefinition[] {
    const snapshot = parseTicketFormSchemaSnapshot(snapshotValue);
    if (!snapshot) return [];
    return snapshot.fields
        .filter((field) => field.isActive && field.visibleTo.includes(role))
        .sort((left, right) => left.sortOrder - right.sortOrder);
}