import {
    createTicketSchema,
    createCommentSchema,
    createQueueSchema,
    createTagSchema,
    createFormFieldSchema,
    updateTagSchema,
} from '@/lib/validations';

describe('Ticket Validation', () => {
    test('valid ticket creation', () => {
        const result = createTicketSchema.safeParse({
            title: 'Test ticket',
            queueId: '550e8400-e29b-41d4-a716-446655440000',
            priority: 'NORMAL',
        });
        expect(result.success).toBe(true);
    });

    test('rejects empty title', () => {
        const result = createTicketSchema.safeParse({
            title: '',
            queueId: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(false);
    });

    test('rejects title too short', () => {
        const result = createTicketSchema.safeParse({
            title: 'ab',
            queueId: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(false);
    });

    test('rejects invalid UUID for queueId', () => {
        const result = createTicketSchema.safeParse({
            title: 'Test ticket',
            queueId: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
    });

    test('rejects invalid priority', () => {
        const result = createTicketSchema.safeParse({
            title: 'Test ticket',
            queueId: '550e8400-e29b-41d4-a716-446655440000',
            priority: 'SUPER_URGENT',
        });
        expect(result.success).toBe(false);
    });
});

describe('Comment Validation', () => {
    test('valid comment', () => {
        const result = createCommentSchema.safeParse({
            content: 'This is a comment',
            isInternal: false,
        });
        expect(result.success).toBe(true);
    });

    test('rejects empty comment', () => {
        const result = createCommentSchema.safeParse({
            content: '',
            isInternal: false,
        });
        expect(result.success).toBe(false);
    });
});

describe('Queue Validation', () => {
    test('valid queue', () => {
        const result = createQueueSchema.safeParse({ name: 'IT Support' });
        expect(result.success).toBe(true);
    });

    test('rejects empty name', () => {
        const result = createQueueSchema.safeParse({ name: '' });
        expect(result.success).toBe(false);
    });
});

describe('Tag Validation', () => {
    test('valid tag with default color', () => {
        const result = createTagSchema.safeParse({ name: 'urgent' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.color).toBe('#6366f1');
    });

    test('valid tag with custom color', () => {
        const result = createTagSchema.safeParse({ name: 'bug', color: '#ff0000' });
        expect(result.success).toBe(true);
    });

    test('rejects invalid color format', () => {
        const result = createTagSchema.safeParse({ name: 'bug', color: 'red' });
        expect(result.success).toBe(false);
    });
});

describe('Form Field Validation', () => {
    test('requires options for dropdown fields', () => {
        const result = createFormFieldSchema.safeParse({
            queueId: '550e8400-e29b-41d4-a716-446655440000',
            label: 'Environment',
            fieldKey: 'environment',
            type: 'DROPDOWN',
            required: false,
        });
        expect(result.success).toBe(false);
    });

    test('accepts dropdown fields when options exist', () => {
        const result = createFormFieldSchema.safeParse({
            queueId: '550e8400-e29b-41d4-a716-446655440000',
            label: 'Environment',
            fieldKey: 'environment',
            type: 'DROPDOWN',
            required: false,
            options: ['Prod', 'Staging'],
        });
        expect(result.success).toBe(true);
    });
});

describe('Tag Update Validation', () => {
    test('requires at least one field to update', () => {
        const result = updateTagSchema.safeParse({
            id: '550e8400-e29b-41d4-a716-446655440000',
        });
        expect(result.success).toBe(false);
    });

    test('accepts update with name change', () => {
        const result = updateTagSchema.safeParse({
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'critical',
        });
        expect(result.success).toBe(true);
    });
});
