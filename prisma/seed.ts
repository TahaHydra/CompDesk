import {
    BuiltInTicketField,
    FormFieldType,
    Prisma,
    PrismaClient,
    Priority,
    Role,
    TicketStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const SYSTEM_TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';
const IT_TEMPLATE_ID = '10000000-0000-0000-0000-000000000001';
const ALL_ROLES = Object.values(Role);

function defaultFields(templateId: string): Prisma.TicketFormTemplateFieldCreateManyInput[] {
    return [
        {
            id: '00000000-0000-0000-0001-000000000001', templateId, fieldKey: 'title', label: 'Title',
            type: FormFieldType.TEXT, builtIn: BuiltInTicketField.TITLE, required: true,
            placeholder: 'Brief summary of your request', validationRules: { minLength: 3, maxLength: 200 },
            visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 10, width: 12,
        },
        {
            id: '00000000-0000-0000-0001-000000000002', templateId, fieldKey: 'description', label: 'Description',
            type: FormFieldType.TEXTAREA, builtIn: BuiltInTicketField.DESCRIPTION,
            placeholder: 'Provide as much detail as possible', validationRules: { maxLength: 10000 },
            visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 20, width: 12,
        },
        {
            id: '00000000-0000-0000-0001-000000000003', templateId, fieldKey: 'priority', label: 'Priority',
            type: FormFieldType.DROPDOWN, builtIn: BuiltInTicketField.PRIORITY, required: true,
            defaultValue: 'NORMAL', options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
            visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 30, width: 6,
        },
        {
            id: '00000000-0000-0000-0001-000000000004', templateId, fieldKey: 'severity', label: 'Severity',
            type: FormFieldType.DROPDOWN, builtIn: BuiltInTicketField.SEVERITY,
            options: ['S1', 'S2', 'S3', 'S4'], visibleTo: [Role.AGENT, Role.ADMIN, Role.SUPER_ADMIN],
            editableBy: [Role.AGENT, Role.ADMIN, Role.SUPER_ADMIN], sortOrder: 40, width: 6,
        },
        {
            id: '00000000-0000-0000-0001-000000000005', templateId, fieldKey: 'attachments', label: 'Attachments',
            type: FormFieldType.FILE, builtIn: BuiltInTicketField.ATTACHMENTS,
            helpText: 'Up to five files, 10 MB each.', visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
            sortOrder: 50, width: 12,
        },
        {
            id: '00000000-0000-0000-0001-000000000006', templateId, fieldKey: 'tags', label: 'Tags',
            type: FormFieldType.MULTISELECT, builtIn: BuiltInTicketField.TAGS,
            visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 60, width: 12,
        },
    ];
}

function customItFields(templateId: string): Prisma.TicketFormTemplateFieldCreateManyInput[] {
    return defaultFields(templateId).map((field) => ({
        ...field,
        id: field.id!.replace('00000000-0000-0000-0001-', '10000000-0000-0000-0001-'),
    })).concat({
        id: '10000000-0000-0000-0001-000000000007', templateId, fieldKey: 'device_type', label: 'Device type',
        type: FormFieldType.DROPDOWN, required: true, options: ['Laptop', 'Desktop', 'Mobile', 'Printer', 'Other'],
        helpText: 'Select the device most closely related to your request.', visibleTo: ALL_ROLES,
        editableBy: ALL_ROLES, sortOrder: 45, width: 6,
    });
}

async function upsertTemplate(
    id: string,
    name: string,
    description: string,
    isSystemDefault: boolean,
    fields: Prisma.TicketFormTemplateFieldCreateManyInput[]
) {
    const template = await prisma.ticketFormTemplate.upsert({
        where: { id },
        update: { name, description, isActive: true, archivedAt: null },
        create: { id, name, description, isSystemDefault, isActive: true },
    });
    for (const field of fields) {
        await prisma.ticketFormTemplateField.upsert({
            where: { id: field.id },
            update: { ...field, templateId: id },
            create: { ...field, templateId: id },
        });
    }
    return prisma.ticketFormTemplate.findUniqueOrThrow({
        where: { id: template.id },
        include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
}

function snapshot(template: Awaited<ReturnType<typeof upsertTemplate>>): Prisma.InputJsonValue {
    return {
        templateId: template.id,
        templateName: template.name,
        version: template.version,
        fields: template.fields.map((field) => ({
            id: field.id,
            fieldKey: field.fieldKey,
            label: field.label,
            type: field.type,
            builtIn: field.builtIn,
            placeholder: field.placeholder,
            helpText: field.helpText,
            required: field.required,
            defaultValue: field.defaultValue,
            options: field.options,
            validationRules: field.validationRules,
            conditionalRules: field.conditionalRules,
            visibleTo: field.visibleTo,
            editableBy: field.editableBy,
            sortOrder: field.sortOrder,
            width: field.width,
            isActive: field.isActive,
        })),
    } as Prisma.InputJsonValue;
}

async function main() {
    console.log('Seeding CompDesk...');
    const password = process.env.SEED_DEFAULT_PASSWORD ?? 'Password123!';
    const passwordHash = await bcrypt.hash(password, 12);
    const accountSpecs = [
        { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com', name: 'Admin User', role: Role.SUPER_ADMIN },
        { email: 'administrator@example.com', name: 'Application Admin', role: Role.ADMIN },
        { email: 'agent1@example.com', name: 'Agent Martin', role: Role.AGENT },
        { email: 'agent2@example.com', name: 'Agent Sophie', role: Role.AGENT },
        { email: 'user1@example.com', name: 'Jean Dupont', role: Role.USER },
        { email: 'user2@example.com', name: 'Marie Curie', role: Role.USER },
    ];
    const users = new Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>();
    for (const spec of accountSpecs) {
        const user = await prisma.user.upsert({
            where: { email: spec.email },
            update: { name: spec.name, role: spec.role, passwordHash, isActive: true },
            create: { ...spec, passwordHash },
        });
        users.set(spec.email, user);
    }
    const applicationAdmin = users.get('administrator@example.com')!;
    const agent1 = users.get('agent1@example.com')!;
    const agent2 = users.get('agent2@example.com')!;
    const user1 = users.get('user1@example.com')!;
    const user2 = users.get('user2@example.com')!;

    const systemTemplate = await upsertTemplate(
        SYSTEM_TEMPLATE_ID,
        'System Default Ticket Form',
        'Protected fallback form used when no active assignment exists.',
        true,
        defaultFields(SYSTEM_TEMPLATE_ID)
    );
    const itTemplate = await upsertTemplate(
        IT_TEMPLATE_ID,
        'IT Support Request',
        'Example department template with an additional required device field.',
        false,
        customItFields(IT_TEMPLATE_ID)
    );

    const itQueue = await prisma.queue.upsert({
        where: { name: 'IT Support' },
        update: { description: 'General IT support requests', isPublic: true, isActive: true, autoAssign: true, defaultTemplateId: itTemplate.id },
        create: { name: 'IT Support', description: 'General IT support requests', isPublic: true, isActive: true, autoAssign: true, defaultTemplateId: itTemplate.id },
    });
    const hrQueue = await prisma.queue.upsert({
        where: { name: 'HR' },
        update: { description: 'Human Resources requests', isPublic: true, isActive: true, defaultTemplateId: null },
        create: { name: 'HR', description: 'Human Resources requests', isPublic: true, isActive: true },
    });
    const financeQueue = await prisma.queue.upsert({
        where: { name: 'Finance' },
        update: { description: 'Finance and billing inquiries', isPublic: false, isActive: true, defaultTemplateId: null },
        create: { name: 'Finance', description: 'Finance and billing inquiries', isPublic: false, isActive: true },
    });

    const itGroup = await prisma.group.upsert({
        where: { entraObjectId: 'it-support-group-id' }, update: { name: 'IT Support' },
        create: { name: 'IT Support', entraObjectId: 'it-support-group-id', description: 'IT support team members' },
    });
    const hrGroup = await prisma.group.upsert({
        where: { entraObjectId: 'hr-group-id' }, update: { name: 'HR Team' },
        create: { name: 'HR Team', entraObjectId: 'hr-group-id', description: 'Human Resources team' },
    });
    for (const [userId, groupId] of [[agent1.id, itGroup.id], [agent2.id, itGroup.id], [agent2.id, hrGroup.id]]) {
        await prisma.groupMember.upsert({
            where: { userId_groupId: { userId, groupId } }, update: {}, create: { userId, groupId },
        });
    }
    for (const [queueId, groupId] of [[itQueue.id, itGroup.id], [hrQueue.id, hrGroup.id]]) {
        await prisma.queueGroup.upsert({
            where: { queueId_groupId_role: { queueId, groupId, role: 'agent' } }, update: {},
            create: { queueId, groupId, role: 'agent' },
        });
    }
    await prisma.queueMember.upsert({
        where: { queueId_userId_role: { queueId: financeQueue.id, userId: agent2.id, role: 'agent' } },
        update: {}, create: { queueId: financeQueue.id, userId: agent2.id, role: 'agent' },
    });

    await prisma.queueMember.upsert({
        where: { queueId_userId_role: { queueId: itQueue.id, userId: applicationAdmin.id, role: 'admin' } },
        update: {}, create: { queueId: itQueue.id, userId: applicationAdmin.id, role: 'admin' },
    });
    const categorySpecs = [
        [itQueue.id, 'Hardware'], [itQueue.id, 'Software'], [itQueue.id, 'Network'], [itQueue.id, 'General'],
        [hrQueue.id, 'General'], [hrQueue.id, 'Onboarding'], [hrQueue.id, 'Payroll'],
        [financeQueue.id, 'General'], [financeQueue.id, 'Expense'], [financeQueue.id, 'Vendor'],
    ] as const;
    const categories = new Map<string, Awaited<ReturnType<typeof prisma.category.upsert>>>();
    for (const [queueId, name] of categorySpecs) {
        const category = await prisma.category.upsert({
            where: { queueId_name: { queueId, name } },
            update: { isActive: true, archivedAt: null },
            create: { queueId, name },
        });
        categories.set(`${queueId}:${name}`, category);
    }

    const tagSpecs = [
        { name: 'urgent', color: '#ef4444' }, { name: 'vpn', color: '#f59e0b' },
        { name: 'email', color: '#3b82f6' }, { name: 'printer', color: '#10b981' },
        { name: 'new-hire', color: '#8b5cf6' }, { name: 'password-reset', color: '#ec4899' },
    ];
    for (const tag of tagSpecs) await prisma.tag.upsert({ where: { name: tag.name }, update: tag, create: tag });

    const slaSpecs = [
        { queueId: itQueue.id, priority: Priority.URGENT, firstResponseMinutes: 15, resolutionMinutes: 60 },
        { queueId: itQueue.id, priority: Priority.HIGH, firstResponseMinutes: 30, resolutionMinutes: 240 },
        { queueId: itQueue.id, priority: Priority.NORMAL, firstResponseMinutes: 120, resolutionMinutes: 1440 },
        { queueId: itQueue.id, priority: Priority.LOW, firstResponseMinutes: 480, resolutionMinutes: 4320 },
        { queueId: hrQueue.id, priority: Priority.NORMAL, firstResponseMinutes: 240, resolutionMinutes: 2880 },
    ];
    for (const policy of slaSpecs) {
        await prisma.slaPolicy.upsert({
            where: { queueId_priority: { queueId: policy.queueId, priority: policy.priority } }, update: policy, create: policy,
        });
    }

    await prisma.ticketCounter.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton', year: new Date().getFullYear(), count: 0 } });
    const tickets = [
        { key: 'TCK-2026-SEED01', title: 'Cannot connect to VPN from home', description: 'The VPN client times out after authentication.', status: TicketStatus.OPEN, priority: Priority.HIGH, queueId: itQueue.id, categoryId: categories.get(`${itQueue.id}:Network`)!.id, requesterId: user1.id, assigneeId: agent1.id, template: itTemplate, values: { title: 'Cannot connect to VPN from home', description: 'The VPN client times out after authentication.', priority: 'HIGH', device_type: 'Laptop' } },
        { key: 'TCK-2026-SEED02', title: 'New laptop setup for new hire', description: 'Please prepare a standard laptop before the start date.', status: TicketStatus.NEW, priority: Priority.NORMAL, queueId: itQueue.id, categoryId: categories.get(`${itQueue.id}:Hardware`)!.id, requesterId: user2.id, assigneeId: null, template: itTemplate, values: { title: 'New laptop setup for new hire', description: 'Please prepare a standard laptop before the start date.', priority: 'NORMAL', device_type: 'Laptop' } },
        { key: 'TCK-2026-SEED03', title: 'PTO process documentation', description: 'Please share the current PTO approval process.', status: TicketStatus.RESOLVED, priority: Priority.LOW, queueId: hrQueue.id, categoryId: categories.get(`${hrQueue.id}:General`)!.id, requesterId: user2.id, assigneeId: agent2.id, template: systemTemplate, values: { title: 'PTO process documentation', description: 'Please share the current PTO approval process.', priority: 'LOW' } },
        { key: 'TCK-2026-SEED04', title: 'Expense reimbursement status', description: 'My expense report is still awaiting reimbursement.', status: TicketStatus.PENDING_AGENT, priority: Priority.NORMAL, queueId: financeQueue.id, categoryId: categories.get(`${financeQueue.id}:Expense`)!.id, requesterId: user1.id, assigneeId: agent2.id, template: systemTemplate, values: { title: 'Expense reimbursement status', description: 'My expense report is still awaiting reimbursement.', priority: 'NORMAL' } },
    ];
    for (const item of tickets) {
        const existing = await prisma.ticket.findUnique({ where: { key: item.key } });
        const ticket = await prisma.ticket.upsert({
            where: { key: item.key }, update: {},
            create: {
                key: item.key, title: item.title, description: item.description, status: item.status,
                priority: item.priority, queueId: item.queueId, categoryId: item.categoryId,
                requesterId: item.requesterId, assigneeId: item.assigneeId,
                resolvedTemplateId: item.template.id, resolvedTemplateVersion: item.template.version,
                formSchemaSnapshot: snapshot(item.template), submittedFormValues: item.values,
                resolvedAt: item.status === TicketStatus.RESOLVED ? new Date() : null,
            },
        });
        await prisma.ticketWatcher.upsert({
            where: { ticketId_userId: { ticketId: ticket.id, userId: item.requesterId } }, update: {},
            create: { ticketId: ticket.id, userId: item.requesterId },
        });
        if (!existing) await prisma.timelineEvent.create({
            data: { ticketId: ticket.id, userId: item.requesterId, type: 'CREATED', content: `Ticket created: ${item.title}` },
        });
    }

    const cannedResponses = [
        { title: 'Password Reset Instructions', content: 'Use your organization password-reset page, then contact support if the issue continues.', category: 'Access' },
        { title: 'Request Received', content: 'Thank you for your request. We have received it and will follow up shortly.', category: 'General' },
    ];
    for (const response of cannedResponses) {
        const existing = await prisma.cannedResponse.findFirst({ where: { title: response.title } });
        if (existing) await prisma.cannedResponse.update({ where: { id: existing.id }, data: response });
        else await prisma.cannedResponse.create({ data: response });
    }

    const brandingConfig = {
        applicationName: 'CompDesk', shortApplicationName: 'CompDesk', subtitle: 'Helpdesk',
        description: 'A secure, customizable helpdesk and ticketing platform.',
        mainLogoUrl: '', compactLogoUrl: '', lightLogoUrl: '', darkLogoUrl: '', faviconUrl: '',
        primaryColor: '#4f46e5', accentColor: '#8b5cf6', loginHeading: 'Welcome to CompDesk',
        loginDescription: 'Sign in to access your helpdesk portal.', loginBackgroundImageUrl: '',
        supportEmail: 'support@example.com', footerText: 'Powered by CompDesk',
        showDemoAccounts: false, demoAccountInfo: '', microsoftButtonText: 'Sign in with Microsoft',
    };
    const brandingSettings = {
        branding_config: JSON.stringify(brandingConfig),
        login_local_enabled: 'true',
        login_microsoft_enabled: 'true',
    };
    for (const [key, value] of Object.entries(brandingSettings)) {
        await prisma.appSetting.upsert({ where: { key }, update: {}, create: { key, value } });
    }
    console.log(`Seed complete. Demo administrator: ${accountSpecs[0].email}`);
    console.log('Set SEED_DEFAULT_PASSWORD and SEED_ADMIN_EMAIL before production seeding.');
}

main()
    .catch((error) => { console.error('Seed failed:', error); process.exitCode = 1; })
    .finally(async () => prisma.$disconnect());