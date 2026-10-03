import { projectTicketFormForRole } from '@/lib/api-dto';
import { ticketAttachmentVisibleToRole, ticketPublicTitle, projectTicketTimelineEvent } from '@/lib/ticket-form/privacy';

const field = (fieldKey: string, type: 'TEXT' | 'TEXTAREA' | 'FILE', builtIn: string | null = null) => ({
    id: fieldKey, fieldKey, label: fieldKey, type, builtIn, visibleTo: ['ADMIN', 'SUPER_ADMIN'], editableBy: ['ADMIN', 'SUPER_ADMIN'], isActive: true,
});
const ticket = () => ({
    title: 'Private title', description: 'Private description', severity: 'S1', priority: 'URGENT', tags: [{ tag: { name: 'private-tag' } }],
    formSchemaSnapshot: { templateId: 't', templateName: 'Form', version: 1, fields: [field('title', 'TEXT', 'TITLE'), field('description', 'TEXTAREA', 'DESCRIPTION'), field('severity', 'TEXT', 'SEVERITY'), field('priority', 'TEXT', 'PRIORITY'), field('tags', 'TEXT', 'TAGS')] },
    submittedFormValues: { title: 'Private title', description: 'Private description', severity: 'S1', priority: 'URGENT', tags: ['private-tag'] },
});

test('role projection hides built-in column aliases alongside historical values', () => {
    const projected = projectTicketFormForRole(ticket(), 'AGENT');
    expect(projected.title).toBe('Support request');
    expect(projected.description).toBeNull();
    expect(projected.severity).toBeNull();
    expect(projected.priority).toBeNull();
    expect(projected.tags).toEqual([]);
    expect(projected.submittedFormValues).toEqual({});
});

test('authorized roles and legacy tickets keep their existing column values', () => {
    expect(projectTicketFormForRole(ticket(), 'ADMIN').description).toBe('Private description');
    const legacy = { title: 'Old title', description: 'Old description', formSchemaSnapshot: undefined };
    expect(projectTicketFormForRole(legacy, 'USER')).toMatchObject({ title: legacy.title, description: legacy.description });
});

test('restricted titles are removed from fanout and old creation events while public titles stay intact', () => {
    expect(ticketPublicTitle(ticket())).toBe('Support request');
    expect(projectTicketTimelineEvent(ticket(), { type: 'CREATED', content: 'Ticket created: Private title' }, 'AGENT').content).toBe('Ticket created');
    expect(ticketPublicTitle({ title: 'Normal title', formSchemaSnapshot: null })).toBe('Normal title');
    expect(projectTicketTimelineEvent(ticket(), { type: 'COMMENT', content: 'An ordinary reply' }, 'AGENT').content).toBe('An ordinary reply');
    const duplicate = ticket();
    duplicate.formSchemaSnapshot.fields.unshift({ ...field('legacy_title', 'TEXT', 'TITLE'), visibleTo: ['USER', 'AGENT', 'ADMIN', 'SUPER_ADMIN'] });
    expect(ticketPublicTitle(duplicate)).toBe('Support request');
});

test('the public historical file value cannot reveal a file also referenced by a restricted field', () => {
    const file = { url: '/api/upload/shared', filename: 'shared.txt', size: 5 };
    const mixed = { formSchemaSnapshot: { templateId: 't', templateName: 'Form', version: 1, fields: [field('private', 'FILE'), { ...field('public', 'FILE'), visibleTo: ['AGENT', 'ADMIN'] }] }, submittedFormValues: { private: [file], public: [file] } };
    expect(projectTicketFormForRole(mixed, 'AGENT').submittedFormValues).toEqual({ public: [] });
    expect(ticketAttachmentVisibleToRole(mixed, { id: 'shared' }, 'AGENT')).toBe(false);
    expect(ticketAttachmentVisibleToRole(mixed, { id: 'shared' }, 'ADMIN')).toBe(true);
    expect(ticketAttachmentVisibleToRole(mixed, { id: 'separate-composer-file', filename: 'shared.txt', size: 5 }, 'AGENT')).toBe(true);
});

test('legacy storage references retain field permissions and ordinary public form files remain usable', () => {
    const historical = { formSchemaSnapshot: { templateId: 't', templateName: 'Form', version: 1, fields: [field('private', 'FILE')] }, submittedFormValues: { private: [{ url: '/uploads/t/old.txt', filename: 'old.txt', size: 5 }] } };
    expect(ticketAttachmentVisibleToRole(historical, { id: 'old', path: '/uploads/t/old.txt', filename: 'old.txt', size: 5 }, 'AGENT')).toBe(false);
    expect(ticketAttachmentVisibleToRole(historical, { id: 'old', path: '/uploads/t/old.txt', filename: 'old.txt', size: 5 }, 'ADMIN')).toBe(true);
    const publicFile = { ...historical, formSchemaSnapshot: { ...historical.formSchemaSnapshot, fields: [{ ...field('private', 'FILE'), visibleTo: ['AGENT', 'ADMIN'] }] } };
    expect(ticketAttachmentVisibleToRole(publicFile, { id: 'old', path: '/uploads/t/old.txt' }, 'AGENT')).toBe(true);
});
