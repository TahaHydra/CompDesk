import { BuiltInTicketField, FormFieldType, Role } from '@prisma/client';
import {
    fieldsVisibleToRoleFromSnapshot,
    parseTicketFormSchemaSnapshot,
    TicketFormValidationError,
    validateTicketFormSubmission,
} from '@/lib/ticket-form/validation';
import type { ResolvedTicketForm, TicketFormFieldDefinition } from '@/lib/ticket-form/types';

function field(overrides: Partial<TicketFormFieldDefinition> = {}): TicketFormFieldDefinition {
    return {
        id: crypto.randomUUID(),
        fieldKey: 'custom_text',
        label: 'Custom text',
        type: FormFieldType.TEXT,
        builtIn: null,
        placeholder: null,
        helpText: null,
        required: false,
        defaultValue: null,
        options: [],
        validationRules: null,
        conditionalRules: null,
        visibleTo: Object.values(Role),
        editableBy: Object.values(Role),
        sortOrder: 10,
        width: 12,
        isActive: true,
        ...overrides,
    };
}

function resolved(allFields: TicketFormFieldDefinition[], visibleFields = allFields): ResolvedTicketForm {
    return {
        template: {
            id: '550e8400-e29b-41d4-a716-446655440001', name: 'Support form', description: null,
            version: 3, isSystemDefault: false, isActive: true, archivedAt: null, fields: visibleFields,
        },
        fields: visibleFields,
        allFields,
        source: 'department',
        queue: { id: '550e8400-e29b-41d4-a716-446655440002', name: 'IT' },
        category: { id: '550e8400-e29b-41d4-a716-446655440003', name: 'Network' },
        role: Role.USER,
    };
}

function validationErrors(form: ResolvedTicketForm, values: Record<string, unknown>) {
    try {
        validateTicketFormSubmission(form, values);
        return {};
    } catch (error) {
        expect(error).toBeInstanceOf(TicketFormValidationError);
        return (error as TicketFormValidationError).errors;
    }
}

describe('resolved ticket form server validation', () => {
    it('enforces required fields on the server', () => {
        const required = field({ required: true });
        expect(validationErrors(resolved([required]), {})).toHaveProperty('custom_text');
    });

    it('rejects unknown fields', () => {
        expect(validationErrors(resolved([field()]), { injected: 'value' })).toEqual({ injected: 'Unknown field' });
    });

    it('rejects fields hidden from the requester role', () => {
        const hidden = field({ fieldKey: 'admin_note', label: 'Admin note', visibleTo: [Role.ADMIN], editableBy: [Role.ADMIN] });
        expect(validationErrors(resolved([hidden], []), { admin_note: 'secret' })).toHaveProperty('admin_note');
    });

    it('validates dropdown options', () => {
        const dropdown = field({ type: FormFieldType.DROPDOWN, options: ['Windows', 'Linux'] });
        expect(validationErrors(resolved([dropdown]), { custom_text: 'macOS' })).toHaveProperty('custom_text');
        expect(validateTicketFormSubmission(resolved([dropdown]), { custom_text: 'Linux' }).customValues).toEqual({ custom_text: 'Linux' });
    });

    it('validates multi-select options and value types', () => {
        const multi = field({ type: FormFieldType.MULTISELECT, options: ['A', 'B'] });
        expect(validationErrors(resolved([multi]), { custom_text: ['A', 'C'] })).toHaveProperty('custom_text');
        expect(validationErrors(resolved([multi]), { custom_text: 'A' })).toHaveProperty('custom_text');
        expect(validateTicketFormSubmission(resolved([multi]), { custom_text: ['A', 'B'] }).customValues).toEqual({ custom_text: ['A', 'B'] });
    });

    it('enforces conditional visibility and conditional required state', () => {
        const controller = field({ fieldKey: 'kind', label: 'Kind', type: FormFieldType.DROPDOWN, options: ['Hardware', 'Software'] });
        const serial = field({ fieldKey: 'serial', label: 'Serial', required: true, conditionalRules: { fieldKey: 'kind', operator: 'equals', value: 'Hardware' } });
        expect(validateTicketFormSubmission(resolved([controller, serial]), { kind: 'Software' }).customValues).toEqual({ kind: 'Software' });
        expect(validationErrors(resolved([controller, serial]), { kind: 'Software', serial: 'hidden injection' })).toHaveProperty('serial');
        expect(validationErrors(resolved([controller, serial]), { kind: 'Hardware' })).toHaveProperty('serial');
    });

    it('applies configured text length and regex validation', () => {
        const code = field({ validationRules: { minLength: 4, maxLength: 8, regex: '^INC-' } });
        expect(validationErrors(resolved([code]), { custom_text: 'bad' })).toHaveProperty('custom_text');
        expect(validateTicketFormSubmission(resolved([code]), { custom_text: 'INC-42' }).customValues).toEqual({ custom_text: 'INC-42' });
    });

    it('generates a deterministic title when the Title field is absent or hidden', () => {
        const result = validateTicketFormSubmission(resolved([field()]), { custom_text: 'Details' });
        expect(result.title).toBe('Network');
    });

    it('maps visible built-in values to ticket columns', () => {
        const title = field({ fieldKey: 'title', label: 'Title', builtIn: BuiltInTicketField.TITLE, required: true });
        const priority = field({ fieldKey: 'priority', label: 'Priority', type: FormFieldType.DROPDOWN, builtIn: BuiltInTicketField.PRIORITY, options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] });
        const result = validateTicketFormSubmission(resolved([title, priority]), { title: 'Router outage', priority: 'URGENT' });
        expect(result).toMatchObject({ title: 'Router outage', priority: 'URGENT' });
    });
});

describe('historical form snapshots', () => {
    it('renders the stored label and value independently of later template edits', () => {
        const snapshot = {
            templateId: 'template-old', templateName: 'Original form', version: 1,
            fields: [field({ id: 'field-old', fieldKey: 'asset', label: 'Original asset label', visibleTo: [Role.USER] })],
        };
        const parsed = parseTicketFormSchemaSnapshot(snapshot);
        expect(parsed?.fields[0].label).toBe('Original asset label');
        expect(fieldsVisibleToRoleFromSnapshot(snapshot, Role.USER)[0].fieldKey).toBe('asset');
    });

    it('keeps historical fields available even when the current category is archived', () => {
        const snapshot = {
            templateId: 'template-old', templateName: 'Archived category form', version: 2,
            fields: [field({ id: 'field-history', fieldKey: 'history', label: 'Historical value', visibleTo: [Role.USER] })],
        };
        const archivedCategory = { name: 'Retired category', archivedAt: new Date() };
        expect(archivedCategory.archivedAt).toBeInstanceOf(Date);
        expect(fieldsVisibleToRoleFromSnapshot(snapshot, Role.USER)).toHaveLength(1);
    });
});