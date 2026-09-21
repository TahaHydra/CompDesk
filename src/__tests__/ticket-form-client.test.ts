import { createBlankTemplateField } from '@/lib/ticket-form/client-field-draft';
import { ticketFormSubmissionValues, missingRequiredTicketFields } from '@/lib/ticket-form/client-submission';
import type { TicketFormFieldDefinition } from '@/lib/ticket-form/types';

function field(key: string, overrides: Partial<TicketFormFieldDefinition> = {}): TicketFormFieldDefinition {
    return { ...createBlankTemplateField(10), fieldKey: key, label: key, ...overrides };
}

test('required readonly fields and their defaults never block or enter a requester submission', () => {
    const fields = [field('title', { required: true }), field('staff_code', { required: true, defaultValue: 'staff default', editableBy: ['AGENT'] })];
    expect(ticketFormSubmissionValues(fields, { title: 'Help', staff_code: 'staff default' }, 'USER')).toEqual({ title: 'Help' });
    expect(missingRequiredTicketFields(fields, { title: 'Help' }, 'USER')).toEqual([]);
    expect(missingRequiredTicketFields(fields, { title: 'Help' }, 'AGENT').map((item) => item.fieldKey)).toEqual(['staff_code']);
});

test('switching a conditional field off retains the draft but omits its value and dependent values', () => {
    const fields = [field('needs_device', { type: 'CHECKBOX' }), field('device', { required: true, conditionalRules: { fieldKey: 'needs_device', operator: 'truthy' } }), field('serial', { required: true, conditionalRules: { fieldKey: 'device', operator: 'equals', value: 'laptop' } })];
    const draft = { needs_device: false, device: 'laptop', serial: '123' };
    expect(ticketFormSubmissionValues(fields, draft, 'USER')).toEqual({ needs_device: false });
    expect(missingRequiredTicketFields(fields, { needs_device: false, device: 'laptop' }, 'USER')).toEqual([]);
    expect(draft).toEqual({ needs_device: false, device: 'laptop', serial: '123' });
    expect(ticketFormSubmissionValues(fields, { ...draft, needs_device: true }, 'USER')).toEqual({ needs_device: true, device: 'laptop', serial: '123' });
});

test('visible required editable fields still block incomplete submissions', () => {
    const fields = [field('title', { required: true }), field('consent', { type: 'CHECKBOX', required: true })];
    expect(missingRequiredTicketFields(fields, { title: 'Help', consent: false }, 'USER').map((item) => item.fieldKey)).toEqual(['consent']);
    expect(missingRequiredTicketFields(fields, { title: '', consent: true }, 'USER').map((item) => item.fieldKey)).toEqual(['title']);
});
