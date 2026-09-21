import type { Role } from '@prisma/client';
import { isFieldConditionVisible } from '@/lib/ticket-form/conditions';
import type { TicketFormFieldDefinition } from '@/lib/ticket-form/types';

export function ticketFormSubmissionValues(
    fields: TicketFormFieldDefinition[],
    values: Record<string, unknown>,
    role: Role,
): Record<string, unknown> {
    const editableFields = fields.filter((field) => field.editableBy.includes(role));
    const submitted = Object.fromEntries(editableFields
        .filter((field) => Object.prototype.hasOwnProperty.call(values, field.fieldKey))
        .map((field) => [field.fieldKey, values[field.fieldKey]]));
    // Removing a hidden controlling value can also hide its dependent fields.
    // Work on a copy so showing the field again restores the user's draft.
    let changed: boolean;
    do {
        changed = false;
        for (const field of editableFields) {
            if (Object.prototype.hasOwnProperty.call(submitted, field.fieldKey)
                && !isFieldConditionVisible(field.conditionalRules, submitted)) {
                delete submitted[field.fieldKey];
                changed = true;
            }
        }
    } while (changed);
    return submitted;
}

export function missingRequiredTicketFields(
    fields: TicketFormFieldDefinition[],
    values: Record<string, unknown>,
    role: Role,
): TicketFormFieldDefinition[] {
    const submitted = ticketFormSubmissionValues(fields, values, role);
    return fields.filter((field) => {
        if (!field.required || !field.editableBy.includes(role)
            || !isFieldConditionVisible(field.conditionalRules, submitted)) return false;
        const value = submitted[field.fieldKey];
        return value === undefined || value === null || value === ''
            || (Array.isArray(value) && value.length === 0)
            || (field.type === 'CHECKBOX' && value !== true);
    });
}
