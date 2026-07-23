import type { BuiltInTicketField, FormFieldType, Role } from '@prisma/client';

export interface FieldValidationRules {
    minLength?: number;
    maxLength?: number;
    regex?: string;
    allowedFileTypes?: string[];
}

export type ConditionalOperator = 'equals' | 'notEquals' | 'contains' | 'in' | 'truthy';

export interface FieldConditionalRules {
    fieldKey?: string;
    operator?: ConditionalOperator;
    value?: unknown;
    dependsOn?: string;
    showWhen?: unknown;
}

export interface TicketFormFieldDefinition {
    id: string;
    fieldKey: string;
    label: string;
    type: FormFieldType;
    builtIn: BuiltInTicketField | null;
    placeholder: string | null;
    helpText: string | null;
    required: boolean;
    defaultValue: unknown;
    options: string[];
    validationRules: FieldValidationRules | null;
    conditionalRules: FieldConditionalRules | null;
    visibleTo: Role[];
    editableBy: Role[];
    sortOrder: number;
    width: number;
    isActive: boolean;
}

export interface TicketFormTemplateDefinition {
    id: string;
    name: string;
    description: string | null;
    version: number;
    isSystemDefault: boolean;
    isActive: boolean;
    archivedAt: string | null;
    fields: TicketFormFieldDefinition[];
}

export type TemplateResolutionSource = 'category' | 'department' | 'system';

export interface ResolvedTicketForm {
    template: TicketFormTemplateDefinition;
    fields: TicketFormFieldDefinition[];
    allFields: TicketFormFieldDefinition[];
    source: TemplateResolutionSource;
    queue: { id: string; name: string };
    category: { id: string; name: string } | null;
    role: Role;
}

export interface TicketFormSchemaSnapshot {
    templateId: string;
    templateName: string;
    version: number;
    fields: TicketFormFieldDefinition[];
}

export interface UploadedFieldFile {
    url: string;
    filename: string;
    mimetype: string;
    size: number;
}

export interface ValidatedTicketSubmission {
    title: string;
    description: string | null;
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    severity: 'S1' | 'S2' | 'S3' | 'S4' | null;
    tagIds: string[];
    attachments: UploadedFieldFile[];
    customValues: Record<string, unknown>;
    submittedValues: Record<string, unknown>;
}