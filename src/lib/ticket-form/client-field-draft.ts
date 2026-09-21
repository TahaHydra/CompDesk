import { createBrowserUuid } from '@/lib/browser-uuid';
import type { TicketFormFieldDefinition } from '@/lib/ticket-form/types';
import type { Role } from '@prisma/client';

const ALL_ROLES: Role[] = ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'];

export function createBlankTemplateField(sortOrder: number): TicketFormFieldDefinition {
    return {
        id: createBrowserUuid(), fieldKey: '', label: '', type: 'TEXT', builtIn: null,
        placeholder: null, helpText: null, required: false, defaultValue: null, options: [],
        validationRules: null, conditionalRules: null, visibleTo: [...ALL_ROLES], editableBy: [...ALL_ROLES],
        sortOrder, width: 12, isActive: true,
    };
}

export function copyTemplateFieldForEditing(field: TicketFormFieldDefinition): TicketFormFieldDefinition {
    return { ...field, visibleTo: [...field.visibleTo], editableBy: [...field.editableBy] };
}
