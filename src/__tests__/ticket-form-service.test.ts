const mockPrisma = {
    queue: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    category: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    ticket: { count: jest.fn() },
    ticketFormTemplate: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn(), create: jest.fn() },
    ticketFormTemplateField: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
};

jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { Role } from '@prisma/client';
import {
    chooseEffectiveTemplate,
    hardDeleteTicketFormTemplate,
    resolveTicketFormTemplate,
    setTemplateArchived,
    TemplateResolutionError,
    updateTicketFormTemplate,
} from '@/lib/ticket-form/service';

const active = (id: string) => ({ id, isActive: true, archivedAt: null as Date | null });

describe('template resolution precedence', () => {
    it('uses category override before department and system', () => {
        const result = chooseEffectiveTemplate({ category: active('category'), department: active('department'), system: active('system') });
        expect(result).toMatchObject({ source: 'category', template: { id: 'category' } });
    });

    it('uses department default before system fallback', () => {
        const result = chooseEffectiveTemplate({ category: null, department: active('department'), system: active('system') });
        expect(result).toMatchObject({ source: 'department', template: { id: 'department' } });
    });

    it('uses system default when assignments are absent or inactive', () => {
        const result = chooseEffectiveTemplate({
            category: { ...active('category'), isActive: false },
            department: { ...active('department'), archivedAt: new Date() },
            system: active('system'),
        });
        expect(result).toMatchObject({ source: 'system', template: { id: 'system' } });
    });

    it('rejects a category submitted with another department', async () => {
        mockPrisma.queue.findUnique.mockResolvedValue({ id: 'queue-b', name: 'B', isActive: true, defaultTemplateId: null });
        mockPrisma.category.findUnique.mockResolvedValue({
            id: 'category-a', name: 'Category A', queueId: 'queue-a', isActive: true, archivedAt: null, templateId: null,
        });
        await expect(resolveTicketFormTemplate('queue-b', 'category-a', Role.USER)).rejects.toMatchObject({
            code: 'CATEGORY_QUEUE_MISMATCH',
        });
    });
});

describe('protected template lifecycle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.queue.findMany.mockResolvedValue([]);
        mockPrisma.category.findMany.mockResolvedValue([]);
        mockPrisma.ticket.count.mockResolvedValue(0);
    });

    it('cannot archive the system default template', async () => {
        mockPrisma.ticketFormTemplate.findUnique.mockResolvedValue({ id: 'system', isSystemDefault: true });
        await expect(setTemplateArchived('system', true)).rejects.toMatchObject({ code: 'SYSTEM_TEMPLATE_PROTECTED' });
        expect(mockPrisma.ticketFormTemplate.update).not.toHaveBeenCalled();
    });

    it('cannot delete the system default template', async () => {
        mockPrisma.ticketFormTemplate.findUnique.mockResolvedValue({ id: 'system', isSystemDefault: true });
        await expect(hardDeleteTicketFormTemplate('system')).rejects.toBeInstanceOf(TemplateResolutionError);
        expect(mockPrisma.ticketFormTemplate.delete).not.toHaveBeenCalled();
    });

    it('cannot destructively delete an assigned template without reassignment', async () => {
        mockPrisma.ticketFormTemplate.findUnique.mockResolvedValue({ id: 'assigned', isSystemDefault: false });
        mockPrisma.queue.findMany.mockResolvedValue([{ id: 'queue', name: 'IT' }]);
        await expect(hardDeleteTicketFormTemplate('assigned')).rejects.toMatchObject({ code: 'TEMPLATE_ASSIGNED' });
        expect(mockPrisma.ticketFormTemplate.delete).not.toHaveBeenCalled();
    });

    it('cannot destructively delete a template with historical tickets', async () => {
        mockPrisma.ticketFormTemplate.findUnique.mockResolvedValue({ id: 'historical', isSystemDefault: false });
        mockPrisma.ticket.count.mockResolvedValue(2);
        await expect(hardDeleteTicketFormTemplate('historical')).rejects.toMatchObject({ code: 'TEMPLATE_HAS_HISTORY' });
    });

    it('increments the template version when editing fields', async () => {
        const tx = {
            ticketFormTemplateField: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
            ticketFormTemplate: { update: jest.fn().mockResolvedValue({
                id: 'template', name: 'Edited', description: null, version: 5, isSystemDefault: false,
                isActive: true, archivedAt: null, createdAt: new Date(), updatedAt: new Date(), fields: [],
            }) },
        };
        mockPrisma.ticketFormTemplate.findUnique.mockResolvedValue({ id: 'template', isSystemDefault: false });
        mockPrisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
        await updateTicketFormTemplate('template', {
            name: 'Edited', description: null,
            fields: [{
                fieldKey: 'details', label: 'Details', type: 'TEXT', builtIn: null, required: false,
                defaultValue: null, options: [], validationRules: null, conditionalRules: null,
                visibleTo: [Role.USER], editableBy: [Role.USER], sortOrder: 1, width: 12, isActive: true,
            }],
        });
        expect(tx.ticketFormTemplate.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ version: { increment: 1 } }),
        }));
    });
});