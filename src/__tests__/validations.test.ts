import {
    createCommentSchema,
    createQueueSchema,
    createTagSchema,
    createTicketSchema,
    updateTagSchema,
    updateTicketSchema,
} from '@/lib/validations';

const queueId = '550e8400-e29b-41d4-a716-446655440000';

describe('Ticket routing payload validation', () => {
    test('rejects empty ticket updates', () => {
        expect(updateTicketSchema.safeParse({}).success).toBe(false);
        expect(updateTicketSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    });

    test('requires the ticket version for a valid update', () => {
        expect(updateTicketSchema.safeParse({ status: 'OPEN' }).success).toBe(false);
        expect(updateTicketSchema.safeParse({ expectedVersion: 1, status: 'OPEN' }).success).toBe(true);
    });

    test('accepts template-driven values', () => {
        const result = createTicketSchema.safeParse({
            queueId,
            values: { title: 'Test ticket', priority: 'NORMAL' },
        });
        expect(result.success).toBe(true);
    });

    test('allows the template validator to decide whether title is required', () => {
        const result = createTicketSchema.safeParse({ queueId, values: {} });
        expect(result.success).toBe(true);
    });

    test('rejects an invalid department id', () => {
        const result = createTicketSchema.safeParse({ queueId: 'not-a-uuid', values: {} });
        expect(result.success).toBe(false);
    });

    test('rejects unsupported top-level properties', () => {
        const result = createTicketSchema.safeParse({ queueId, values: {}, templateId: queueId });
        expect(result.success).toBe(false);
    });

    test('rejects an invalid compatibility priority', () => {
        const result = createTicketSchema.safeParse({ queueId, priority: 'SUPER_URGENT' });
        expect(result.success).toBe(false);
    });
});

describe('Comment validation', () => {
    test('accepts a valid comment', () => {
        expect(createCommentSchema.safeParse({ content: 'This is a comment', isInternal: false }).success).toBe(true);
    });

    test('rejects an empty comment', () => {
        expect(createCommentSchema.safeParse({ content: '', isInternal: false }).success).toBe(false);
    });
});

describe('Department validation', () => {
    test('accepts a valid department', () => {
        expect(createQueueSchema.safeParse({ name: 'IT Support' }).success).toBe(true);
    });

    test('rejects an empty name', () => {
        expect(createQueueSchema.safeParse({ name: '' }).success).toBe(false);
    });
});

describe('Tag validation', () => {
    test('applies the default color', () => {
        const result = createTagSchema.safeParse({ name: 'urgent' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.color).toBe('#6366f1');
    });

    test('accepts a custom hex color', () => {
        expect(createTagSchema.safeParse({ name: 'bug', color: '#ff0000' }).success).toBe(true);
    });

    test('rejects an invalid color', () => {
        expect(createTagSchema.safeParse({ name: 'bug', color: 'red' }).success).toBe(false);
    });

    test('requires a tag update value', () => {
        expect(updateTagSchema.safeParse({ id: queueId }).success).toBe(false);
    });

    test('accepts a tag name update', () => {
        expect(updateTagSchema.safeParse({ id: queueId, name: 'critical' }).success).toBe(true);
    });
});