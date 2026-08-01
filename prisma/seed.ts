import {
    AssignmentSource,
    BuiltInTicketField,
    FormFieldType,
    Prisma,
    PrismaClient,
    Priority,
    Role,
    TicketStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();
const normalizeEmail = (value: string) => value.trim().toLowerCase();
const productionSeedOverride = 'I_UNDERSTAND_THIS_CREATES_DEMO_DATA';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_DEMO_SEED !== productionSeedOverride) {
    throw new Error('Demo seeding is disabled in production. Set ALLOW_PRODUCTION_DEMO_SEED=I_UNDERSTAND_THIS_CREATES_DEMO_DATA only for an intentional disposable demonstration.');
}
const SYSTEM_TEMPLATE_ID = '00000000-0000-0000-0000-000000000001';
const IT_TEMPLATE_ID = '10000000-0000-0000-0000-000000000001';
const ACCESS_TEMPLATE_ID = '20000000-0000-0000-0000-000000000001';
const HR_TEMPLATE_ID = '30000000-0000-0000-0000-000000000001';
const FINANCE_TEMPLATE_ID = '40000000-0000-0000-0000-000000000001';
const ALL_ROLES = Object.values(Role);
const STAFF_ROLES = [Role.AGENT, Role.ADMIN, Role.SUPER_ADMIN];

type SeedField = Prisma.TicketFormTemplateFieldCreateManyInput;

function fieldId(prefix: string, index: number) {
    return `${prefix}-0000-0000-0001-${String(index).padStart(12, '0')}`;
}

function standardFields(templateId: string, prefix: string): SeedField[] {
    return [
        {
            id: fieldId(prefix, 1), templateId, fieldKey: 'title', label: 'Short summary',
            type: FormFieldType.TEXT, builtIn: BuiltInTicketField.TITLE, required: true,
            placeholder: 'What do you need help with?', helpText: 'Use a short, specific title.',
            validationRules: { minLength: 5, maxLength: 160 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
            sortOrder: 10, width: 12,
        },
        {
            id: fieldId(prefix, 2), templateId, fieldKey: 'description', label: 'Details',
            type: FormFieldType.TEXTAREA, builtIn: BuiltInTicketField.DESCRIPTION, required: true,
            placeholder: 'Describe the request, what you expected, and any relevant context.',
            validationRules: { minLength: 10, maxLength: 10000 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
            sortOrder: 20, width: 12,
        },
        {
            id: fieldId(prefix, 3), templateId, fieldKey: 'priority', label: 'Business priority',
            type: FormFieldType.DROPDOWN, builtIn: BuiltInTicketField.PRIORITY, required: true,
            defaultValue: 'NORMAL', options: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
            helpText: 'Urgent should be reserved for work-stopping issues.', visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
            sortOrder: 30, width: 6,
        },
        {
            id: fieldId(prefix, 4), templateId, fieldKey: 'severity', label: 'Support severity',
            type: FormFieldType.DROPDOWN, builtIn: BuiltInTicketField.SEVERITY,
            options: ['S1', 'S2', 'S3', 'S4'], visibleTo: STAFF_ROLES, editableBy: STAFF_ROLES,
            helpText: 'Internal support classification.', sortOrder: 80, width: 6,
        },
        {
            id: fieldId(prefix, 5), templateId, fieldKey: 'attachments', label: 'Supporting files',
            type: FormFieldType.FILE, builtIn: BuiltInTicketField.ATTACHMENTS,
            helpText: 'Attach screenshots or documents when they help explain the request.',
            validationRules: { allowedFileTypes: ['image/png', 'image/jpeg', 'application/pdf', 'text/plain'] },
            visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 90, width: 12,
        },
        {
            id: fieldId(prefix, 6), templateId, fieldKey: 'tags', label: 'Internal tags',
            type: FormFieldType.MULTISELECT, builtIn: BuiltInTicketField.TAGS,
            visibleTo: STAFF_ROLES, editableBy: STAFF_ROLES, sortOrder: 100, width: 12,
        },
    ];
}

function withCustomFields(templateId: string, prefix: string, custom: SeedField[]): SeedField[] {
    return [...standardFields(templateId, prefix), ...custom].sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
}

async function upsertTemplate(id: string, name: string, description: string, isSystemDefault: boolean, version: number, fields: SeedField[]) {
    const template = await prisma.ticketFormTemplate.upsert({
        where: { id },
        update: { name, description, version, isSystemDefault, isActive: true, archivedAt: null },
        create: { id, name, description, version, isSystemDefault, isActive: true },
    });
    const fieldIds = fields.map((field) => field.id as string);
    await prisma.ticketFormTemplateField.deleteMany({ where: { templateId: id, id: { notIn: fieldIds } } });
    for (const field of fields) {
        await prisma.ticketFormTemplateField.upsert({
            where: { id: field.id as string },
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
            id: field.id, fieldKey: field.fieldKey, label: field.label, type: field.type, builtIn: field.builtIn,
            placeholder: field.placeholder, helpText: field.helpText, required: field.required,
            defaultValue: field.defaultValue, options: field.options, validationRules: field.validationRules,
            conditionalRules: field.conditionalRules, visibleTo: field.visibleTo, editableBy: field.editableBy,
            sortOrder: field.sortOrder, width: field.width, isActive: field.isActive,
        })),
    } as Prisma.InputJsonValue;
}

async function upsertCategory(queueId: string, name: string, description: string, templateId: string | null, aliases: string[] = []) {
    const matches = await prisma.category.findMany({
        where: { queueId, name: { in: [name, ...aliases] } },
        include: { _count: { select: { tickets: true } } },
        orderBy: { createdAt: 'asc' },
    });
    let category = matches.find((item) => item.name === name) ?? matches[0];
    if (!category) {
        category = await prisma.category.create({
            data: { queueId, name, description, templateId, isActive: true },
            include: { _count: { select: { tickets: true } } },
        });
    } else {
        if (category.name !== name && !matches.some((item) => item.name === name)) {
            category = await prisma.category.update({
                where: { id: category.id }, data: { name },
                include: { _count: { select: { tickets: true } } },
            });
        }
        category = await prisma.category.update({
            where: { id: category.id },
            data: { description, templateId, isActive: true, archivedAt: null },
            include: { _count: { select: { tickets: true } } },
        });
    }
    for (const duplicate of matches.filter((item) => item.id !== category.id)) {
        if (duplicate._count.tickets === 0) await prisma.category.delete({ where: { id: duplicate.id } });
        else await prisma.category.update({ where: { id: duplicate.id }, data: { isActive: false, archivedAt: duplicate.archivedAt ?? new Date() } });
    }
    return category;
}

async function removeLegacyCategoryCopies(queueId: string, names: string[]) {
    const categories = await prisma.category.findMany({ where: { queueId, name: { in: names } }, include: { _count: { select: { tickets: true } } } });
    for (const category of categories) {
        if (category._count.tickets === 0) await prisma.category.delete({ where: { id: category.id } });
        else await prisma.category.update({ where: { id: category.id }, data: { isActive: false, archivedAt: category.archivedAt ?? new Date() } });
    }
}

async function seedHelpCenter() {
    const collections = [
        { id: '51000000-0000-0000-0000-000000000001', slug: 'getting-started', titleEn: 'Getting started', titleFr: 'Bien démarrer', descriptionEn: 'Learn the essentials of CompDesk.', descriptionFr: 'Découvrez les bases de CompDesk.', icon: 'book', sortOrder: 10 },
        { id: '51000000-0000-0000-0000-000000000002', slug: 'tickets', titleEn: 'Tickets and requests', titleFr: 'Tickets et demandes', descriptionEn: 'Create, follow, and update support requests.', descriptionFr: 'Créez, suivez et mettez à jour vos demandes.', icon: 'ticket', sortOrder: 20 },
        { id: '51000000-0000-0000-0000-000000000003', slug: 'account', titleEn: 'Account and preferences', titleFr: 'Compte et préférences', descriptionEn: 'Manage your profile, language, and sign-in.', descriptionFr: 'Gérez votre profil, votre langue et votre connexion.', icon: 'user', sortOrder: 30 },
        { id: '51000000-0000-0000-0000-000000000004', slug: 'agents', titleEn: 'For agents', titleFr: 'Pour les agents', descriptionEn: 'Practical guidance for handling the support queue.', descriptionFr: 'Conseils pratiques pour traiter la file d’assistance.', icon: 'agent', sortOrder: 40 },
    ];
    for (const collection of collections) await prisma.helpCollection.upsert({ where: { id: collection.id }, update: { ...collection, isPublished: true }, create: { ...collection, isPublished: true } });
    const articles = [
        {
            id: '52000000-0000-0000-0000-000000000001', collectionId: collections[0].id, slug: 'welcome-to-compdesk', sortOrder: 10,
            titleEn: 'Welcome to CompDesk', titleFr: 'Bienvenue dans CompDesk',
            summaryEn: 'A quick tour of the workspace and where to find what you need.', summaryFr: 'Un aperçu rapide de l’espace de travail et de ses fonctions.',
            contentEn: '## What you can do\n\nCompDesk gives you one place to request help and follow progress. Use the left navigation to open your dashboard, review your tickets, create a request, or search this Help Center.\n\n## Start with the dashboard\n\nThe dashboard shows your recent tickets and useful company links. Select any ticket to open its full history.\n\n## Get help\n\n1. Search the Help Center for an answer.\n2. If you still need assistance, select **New Ticket**.\n3. Choose the department and category that best match your request.',
            contentFr: '## Ce que vous pouvez faire\n\nCompDesk centralise vos demandes d’aide et leur suivi. Utilisez la navigation à gauche pour ouvrir le tableau de bord, consulter vos tickets, créer une demande ou rechercher dans ce centre d’aide.\n\n## Commencer par le tableau de bord\n\nLe tableau de bord affiche vos tickets récents et les liens utiles de l’entreprise. Sélectionnez un ticket pour consulter son historique complet.\n\n## Obtenir de l’aide\n\n1. Recherchez d’abord une réponse dans le centre d’aide.\n2. Si vous avez encore besoin d’assistance, sélectionnez **Nouveau ticket**.\n3. Choisissez le département et la catégorie correspondant à votre demande.',
        },
        {
            id: '52000000-0000-0000-0000-000000000002', collectionId: collections[1].id, slug: 'create-a-clear-ticket', sortOrder: 10,
            titleEn: 'Create a clear support ticket', titleFr: 'Créer un ticket clair',
            summaryEn: 'Choose the right route and include the details agents need.', summaryFr: 'Choisissez le bon routage et ajoutez les informations utiles aux agents.',
            contentEn: '## Choose the department first\n\nThe department controls which categories and form fields are available. Pick **IT Support**, **HR**, or **Finance** according to the team that owns the request.\n\n## Write a useful summary\n\nUse a short title that describes the result you need. Include:\n\n- what happened or what you are requesting;\n- who or what is affected;\n- when the issue started or when the request is needed;\n- any error message or reference number.\n\n## Attach evidence\n\nScreenshots, invoices, and error files can reduce follow-up questions. Never upload passwords.',
            contentFr: '## Choisir d’abord le département\n\nLe département détermine les catégories et les champs disponibles. Sélectionnez **Support informatique**, **RH** ou **Finance** selon l’équipe responsable.\n\n## Rédiger un résumé utile\n\nUtilisez un titre court décrivant le résultat attendu. Indiquez :\n\n- ce qui s’est produit ou ce que vous demandez ;\n- les personnes ou équipements concernés ;\n- la date de début du problème ou l’échéance souhaitée ;\n- tout message d’erreur ou numéro de référence.\n\n## Joindre des éléments utiles\n\nLes captures d’écran, factures et fichiers d’erreur réduisent les échanges. Ne joignez jamais de mots de passe.',
        },
        {
            id: '52000000-0000-0000-0000-000000000003', collectionId: collections[1].id, slug: 'track-and-reply-to-a-ticket', sortOrder: 20,
            titleEn: 'Track and reply to a ticket', titleFr: 'Suivre et répondre à un ticket',
            summaryEn: 'Understand statuses, replies, and the ticket timeline.', summaryFr: 'Comprendre les statuts, les réponses et l’historique du ticket.',
            contentEn: '## Follow progress\n\nOpen **My Tickets** and select a ticket. The timeline records replies and important changes in chronological order.\n\n## Common statuses\n\n- **New:** the request has been received.\n- **Open:** the support team is working on it.\n- **Pending user:** the team needs information from you.\n- **Pending agent:** the request is waiting on support.\n- **Resolved:** a solution has been provided.\n\n## Add a reply\n\nWrite your response in the conversation area and attach additional evidence if needed.',
            contentFr: '## Suivre l’avancement\n\nOuvrez **Mes tickets** puis sélectionnez un ticket. L’historique rassemble les réponses et les changements importants.\n\n## Statuts courants\n\n- **Nouveau :** la demande a été reçue.\n- **Ouvert :** l’équipe travaille dessus.\n- **En attente de l’utilisateur :** une information vous est demandée.\n- **En attente de l’agent :** l’équipe doit intervenir.\n- **Résolu :** une solution a été apportée.\n\n## Ajouter une réponse\n\nRédigez votre réponse dans la zone de conversation et joignez des éléments supplémentaires si nécessaire.',
        },
        {
            id: '52000000-0000-0000-0000-000000000004', collectionId: collections[1].id, slug: 'choose-the-right-priority', sortOrder: 30,
            titleEn: 'Choose the right priority', titleFr: 'Choisir la bonne priorité',
            summaryEn: 'Use priority consistently so urgent work is visible.', summaryFr: 'Utilisez les priorités de manière cohérente pour identifier les urgences.',
            contentEn: '## Priority guide\n\n- **Low:** information request or improvement with no deadline.\n- **Normal:** standard request affecting routine work.\n- **High:** significant impact or a fixed near-term deadline.\n- **Urgent:** work-stopping incident or critical business deadline.\n\n> Urgent does not make routine requests faster. The support team may correct an inaccurate priority.',
            contentFr: '## Guide des priorités\n\n- **Faible :** demande d’information ou amélioration sans échéance.\n- **Normale :** demande standard liée au travail quotidien.\n- **Haute :** impact important ou échéance proche et fixe.\n- **Urgente :** incident bloquant le travail ou échéance métier critique.\n\n> Le niveau urgent n’accélère pas les demandes courantes. L’équipe peut corriger une priorité inadaptée.',
        },
        {
            id: '52000000-0000-0000-0000-000000000005', collectionId: collections[2].id, slug: 'change-your-language', sortOrder: 10,
            titleEn: 'Change your interface language', titleFr: 'Changer la langue de l’interface',
            summaryEn: 'Switch your personal workspace between English and French.', summaryFr: 'Basculez votre espace personnel entre le français et l’anglais.',
            contentEn: '## Update the preference\n\n1. Open your profile from the account menu in the top-right corner.\n2. In **Interface language**, select English or Français.\n3. Select **Save preference**.\n\nThe setting belongs to your account and follows you on other browsers after you sign in.',
            contentFr: '## Modifier la préférence\n\n1. Ouvrez votre profil depuis le menu du compte en haut à droite.\n2. Dans **Langue de l’interface**, sélectionnez English ou Français.\n3. Sélectionnez **Enregistrer**.\n\nCe paramètre est lié à votre compte et vous suit sur les autres navigateurs après connexion.',
        },
        {
            id: '52000000-0000-0000-0000-000000000006', collectionId: collections[2].id, slug: 'sign-in-troubleshooting', sortOrder: 20,
            titleEn: 'Troubleshoot sign-in problems', titleFr: 'Résoudre les problèmes de connexion',
            summaryEn: 'Simple checks for local and Microsoft sign-in.', summaryFr: 'Vérifications simples pour la connexion locale et Microsoft.',
            contentEn: '## Check the sign-in method\n\nYour organization may enable local email/password sign-in, Microsoft sign-in, or both.\n\n## Try these checks\n\n- Confirm the email address is correct.\n- Check Caps Lock before entering a password.\n- For Microsoft, use the expected work account.\n- Open a private window to rule out an old browser session.\n\nIf the problem continues, contact your CompDesk administrator.',
            contentFr: '## Vérifier la méthode de connexion\n\nVotre organisation peut activer la connexion locale, Microsoft ou les deux.\n\n## Effectuer ces vérifications\n\n- Confirmez l’adresse e-mail.\n- Vérifiez la touche Verr. Maj.\n- Pour Microsoft, utilisez le compte professionnel attendu.\n- Ouvrez une fenêtre privée pour écarter une ancienne session.\n\nSi le problème persiste, contactez votre administrateur CompDesk.',
        },
        {
            id: '52000000-0000-0000-0000-000000000007', collectionId: collections[3].id, slug: 'work-the-department-inbox', sortOrder: 10,
            titleEn: 'Work the department inbox', titleFr: 'Traiter la boîte du département',
            summaryEn: 'Review, assign, and progress incoming tickets.', summaryFr: 'Consultez, assignez et faites avancer les tickets entrants.',
            contentEn: '## Review new work\n\nOpen **Department Inbox** to see tickets for departments assigned to you. Start with urgent items, then review unassigned requests.\n\n## Take ownership\n\nAssign the ticket to yourself or the appropriate agent. Update the status as work progresses.\n\n## Communicate clearly\n\nUse public replies for requester-facing updates. Use internal notes only for support-team information.',
            contentFr: '## Examiner les nouvelles demandes\n\nOuvrez la **Boîte de réception** pour voir les tickets de vos départements. Commencez par les urgences, puis les tickets non assignés.\n\n## Prendre en charge\n\nAssignez le ticket à vous-même ou à l’agent compétent. Mettez à jour son statut.\n\n## Communiquer clairement\n\nUtilisez les réponses publiques pour le demandeur et les notes internes pour l’équipe.',
        },
        {
            id: '52000000-0000-0000-0000-000000000008', collectionId: collections[3].id, slug: 'resolve-a-ticket-well', sortOrder: 20,
            titleEn: 'Resolve a ticket well', titleFr: 'Bien résoudre un ticket',
            summaryEn: 'Close the loop with a useful resolution and accurate status.', summaryFr: 'Concluez la demande avec une solution utile et un statut exact.',
            contentEn: '## Before resolving\n\nConfirm that the requested action is complete or that a tested solution has been provided. Summarize what changed.\n\n## Set the status\n\nUse **Resolved** when work is complete but may need confirmation. Use **Closed** only when no further interaction is expected.\n\n## Preserve context\n\nRecord important reference numbers, affected systems, and the final action.',
            contentFr: '## Avant de résoudre\n\nConfirmez que l’action est terminée ou qu’une solution testée a été fournie. Résumez les changements.\n\n## Définir le statut\n\nUtilisez **Résolu** lorsque le travail est terminé mais peut nécessiter une confirmation. Utilisez **Fermé** si aucun échange n’est attendu.\n\n## Conserver le contexte\n\nNotez les références, les systèmes concernés et l’action finale.',
        },
    ];
    for (const article of articles) await prisma.helpArticle.upsert({ where: { id: article.id }, update: { ...article, isPublished: true }, create: { ...article, isPublished: true } });
}

async function main() {
    console.log('Seeding CompDesk demo data...');
    const suppliedPassword = process.env.SEED_DEFAULT_PASSWORD;
    let generatedPassword: string | undefined;
    let password: string;
    if (suppliedPassword) {
        password = suppliedPassword;
    } else {
        generatedPassword = `${crypto.randomBytes(12).toString('base64url')}aA1!`;
        password = generatedPassword;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const domain = process.env.SEED_DEMO_DOMAIN ?? 'example.com';
    const accountSpecs = [
        { email: process.env.SEED_ADMIN_EMAIL ?? `admin@${domain}`, name: 'Admin User', role: Role.SUPER_ADMIN },
        { email: process.env.SEED_DEPARTMENT_ADMIN_EMAIL ?? `administrator@${domain}`, name: 'Department Admin', role: Role.ADMIN },
        { email: process.env.SEED_AGENT1_EMAIL ?? `agent1@${domain}`, name: 'Martin Bernard', role: Role.AGENT },
        { email: process.env.SEED_AGENT2_EMAIL ?? `agent2@${domain}`, name: 'Sophie Laurent', role: Role.AGENT },
        { email: process.env.SEED_USER1_EMAIL ?? `user1@${domain}`, name: 'Jean Dupont', role: Role.USER },
        { email: process.env.SEED_USER2_EMAIL ?? `user2@${domain}`, name: 'Marie Curie', role: Role.USER },
    ];
    const users = new Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>();
    for (const spec of accountSpecs) {
        const user = await prisma.user.upsert({
            where: { normalizedEmail: normalizeEmail(spec.email) },
            update: { name: spec.name, role: spec.role, passwordHash, isActive: true, isDemo: true },
            create: { ...spec, email: normalizeEmail(spec.email), normalizedEmail: normalizeEmail(spec.email), passwordHash, isDemo: true, preferredLanguage: 'en' },
        });
        users.set(normalizeEmail(spec.email), user);
    }
    const applicationAdmin = users.get(normalizeEmail(accountSpecs[1].email))!;
    const agent1 = users.get(normalizeEmail(accountSpecs[2].email))!;
    const agent2 = users.get(normalizeEmail(accountSpecs[3].email))!;
    const user1 = users.get(normalizeEmail(accountSpecs[4].email))!;
    const user2 = users.get(normalizeEmail(accountSpecs[5].email))!;
    await upsertTemplate(
        SYSTEM_TEMPLATE_ID,
        'Standard Request',
        'A clean general-purpose form used when no department-specific template is assigned.',
        true,
        2,
        standardFields(SYSTEM_TEMPLATE_ID, '00000000')
    );
    const itTemplate = await upsertTemplate(
        IT_TEMPLATE_ID,
        'IT Support Request',
        'Captures device, location, impact, and troubleshooting information for technical support.',
        false,
        2,
        withCustomFields(IT_TEMPLATE_ID, '10000000', [
            {
                id: fieldId('10000000', 7), templateId: IT_TEMPLATE_ID, fieldKey: 'device_type', label: 'Device or service',
                type: FormFieldType.DROPDOWN, required: true,
                options: ['Laptop', 'Desktop', 'Mobile device', 'Printer', 'Email', 'Business application', 'Network or VPN', 'Other'],
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 35, width: 6,
            },
            {
                id: fieldId('10000000', 8), templateId: IT_TEMPLATE_ID, fieldKey: 'work_location', label: 'Work location',
                type: FormFieldType.TEXT, required: true, placeholder: 'Office, site, or remote',
                validationRules: { minLength: 2, maxLength: 100 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
                sortOrder: 36, width: 6,
            },
            {
                id: fieldId('10000000', 9), templateId: IT_TEMPLATE_ID, fieldKey: 'business_impact', label: 'Who is affected?',
                type: FormFieldType.DROPDOWN, required: true,
                options: ['One person', 'Several people', 'A department', 'A whole site', 'Company-wide'],
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 37, width: 6,
            },
            {
                id: fieldId('10000000', 10), templateId: IT_TEMPLATE_ID, fieldKey: 'error_message', label: 'Error message or troubleshooting',
                type: FormFieldType.TEXTAREA, placeholder: 'Copy the error message and note what you already tried.',
                validationRules: { maxLength: 3000 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
                sortOrder: 45, width: 12,
            },
        ])
    );
    const accessTemplate = await upsertTemplate(
        ACCESS_TEMPLATE_ID,
        'Access & Permission Request',
        'Structured access request with business justification, approver, and time limit.',
        false,
        1,
        withCustomFields(ACCESS_TEMPLATE_ID, '20000000', [
            {
                id: fieldId('20000000', 7), templateId: ACCESS_TEMPLATE_ID, fieldKey: 'application_name', label: 'Application or resource',
                type: FormFieldType.TEXT, required: true, placeholder: 'Microsoft 365, ERP, shared folder…',
                validationRules: { minLength: 2, maxLength: 150 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
                sortOrder: 35, width: 6,
            },
            {
                id: fieldId('20000000', 8), templateId: ACCESS_TEMPLATE_ID, fieldKey: 'access_action', label: 'Requested action',
                type: FormFieldType.DROPDOWN, required: true,
                options: ['Grant access', 'Change access', 'Remove access', 'Temporary access'],
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 36, width: 6,
            },
            {
                id: fieldId('20000000', 9), templateId: ACCESS_TEMPLATE_ID, fieldKey: 'access_level', label: 'Role or permission level',
                type: FormFieldType.TEXT, required: true, placeholder: 'Read-only, contributor, named role…',
                validationRules: { maxLength: 200 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
                sortOrder: 37, width: 6,
            },
            {
                id: fieldId('20000000', 10), templateId: ACCESS_TEMPLATE_ID, fieldKey: 'approver', label: 'Manager or approver',
                type: FormFieldType.TEXT, required: true, placeholder: 'Name or email',
                validationRules: { minLength: 3, maxLength: 150 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
                sortOrder: 38, width: 6,
            },
            {
                id: fieldId('20000000', 11), templateId: ACCESS_TEMPLATE_ID, fieldKey: 'business_justification', label: 'Business justification',
                type: FormFieldType.TEXTAREA, required: true, validationRules: { minLength: 15, maxLength: 3000 },
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 45, width: 12,
            },
            {
                id: fieldId('20000000', 12), templateId: ACCESS_TEMPLATE_ID, fieldKey: 'access_end_date', label: 'Access end date',
                type: FormFieldType.DATE,
                conditionalRules: { fieldKey: 'access_action', operator: 'equals', value: 'Temporary access' },
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 46, width: 6,
            },
        ])
    );
    const hrTemplate = await upsertTemplate(
        HR_TEMPLATE_ID,
        'HR Request',
        'A discreet form for employee services, documents, leave, payroll, and workplace requests.',
        false,
        1,
        withCustomFields(HR_TEMPLATE_ID, '30000000', [
            {
                id: fieldId('30000000', 7), templateId: HR_TEMPLATE_ID, fieldKey: 'hr_request_type', label: 'HR request type',
                type: FormFieldType.DROPDOWN, required: true,
                options: ['Leave or absence', 'Payroll or benefits', 'Employee document', 'Personal information change', 'Onboarding or offboarding', 'Workplace concern', 'Other'],
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 35, width: 6,
            },
            {
                id: fieldId('30000000', 8), templateId: HR_TEMPLATE_ID, fieldKey: 'effective_date', label: 'Effective or required date',
                type: FormFieldType.DATE, helpText: 'Use the relevant effective date or the date you need a response by.',
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 36, width: 6,
            },
            {
                id: fieldId('30000000', 9), templateId: HR_TEMPLATE_ID, fieldKey: 'employee_reference', label: 'Employee reference (optional)',
                type: FormFieldType.TEXT, placeholder: 'Employee number, if applicable', validationRules: { maxLength: 80 },
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 37, width: 6,
            },
            {
                id: fieldId('30000000', 10), templateId: HR_TEMPLATE_ID, fieldKey: 'confidential', label: 'Contains sensitive information',
                type: FormFieldType.CHECKBOX, helpText: 'Select this to alert the HR team to handle the request discreetly.',
                defaultValue: false, visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 38, width: 6,
            },
        ])
    );
    const financeTemplate = await upsertTemplate(
        FINANCE_TEMPLATE_ID,
        'Finance Request',
        'Collects the references Finance needs for expenses, invoices, purchasing, vendors, and budgets.',
        false,
        1,
        withCustomFields(FINANCE_TEMPLATE_ID, '40000000', [
            {
                id: fieldId('40000000', 7), templateId: FINANCE_TEMPLATE_ID, fieldKey: 'finance_request_type', label: 'Finance request type',
                type: FormFieldType.DROPDOWN, required: true,
                options: ['Expense reimbursement', 'Invoice or payment', 'Purchase approval', 'Vendor setup or change', 'Budget or cost center', 'Other'],
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 35, width: 6,
            },
            {
                id: fieldId('40000000', 8), templateId: FINANCE_TEMPLATE_ID, fieldKey: 'reference_number', label: 'Reference number',
                type: FormFieldType.TEXT, placeholder: 'Invoice, purchase order, or expense report number',
                validationRules: { maxLength: 120 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 36, width: 6,
            },
            {
                id: fieldId('40000000', 9), templateId: FINANCE_TEMPLATE_ID, fieldKey: 'amount', label: 'Amount',
                type: FormFieldType.TEXT, placeholder: '0.00', validationRules: { regex: '^\\d+(?:[.,]\\d{1,2})?$', maxLength: 20 },
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 37, width: 6,
            },
            {
                id: fieldId('40000000', 10), templateId: FINANCE_TEMPLATE_ID, fieldKey: 'currency', label: 'Currency',
                type: FormFieldType.DROPDOWN, options: ['EUR', 'USD', 'GBP', 'Other'], defaultValue: 'EUR',
                visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 38, width: 6,
            },
            {
                id: fieldId('40000000', 11), templateId: FINANCE_TEMPLATE_ID, fieldKey: 'cost_center', label: 'Cost center',
                type: FormFieldType.TEXT, validationRules: { maxLength: 80 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES,
                sortOrder: 39, width: 6,
            },
            {
                id: fieldId('40000000', 12), templateId: FINANCE_TEMPLATE_ID, fieldKey: 'vendor_name', label: 'Vendor name',
                type: FormFieldType.TEXT,
                conditionalRules: { fieldKey: 'finance_request_type', operator: 'in', value: ['Invoice or payment', 'Vendor setup or change'] },
                validationRules: { maxLength: 160 }, visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 40, width: 6,
            },
            {
                id: fieldId('40000000', 13), templateId: FINANCE_TEMPLATE_ID, fieldKey: 'required_by', label: 'Required by',
                type: FormFieldType.DATE, visibleTo: ALL_ROLES, editableBy: ALL_ROLES, sortOrder: 41, width: 6,
            },
        ])
    );

    const itQueue = await prisma.queue.upsert({
        where: { name: 'IT Support' },
        update: { description: 'Devices, software, access, email, and connectivity support.', isPublic: true, isActive: true, autoAssign: true, defaultTemplateId: itTemplate.id },
        create: { name: 'IT Support', description: 'Devices, software, access, email, and connectivity support.', isPublic: true, isActive: true, autoAssign: true, defaultTemplateId: itTemplate.id },
    });
    const hrQueue = await prisma.queue.upsert({
        where: { name: 'HR' },
        update: { description: 'Employee services, documents, leave, payroll, and workplace support.', isPublic: true, isActive: true, autoAssign: false, defaultTemplateId: hrTemplate.id },
        create: { name: 'HR', description: 'Employee services, documents, leave, payroll, and workplace support.', isPublic: true, isActive: true, defaultTemplateId: hrTemplate.id },
    });
    const financeQueue = await prisma.queue.upsert({
        where: { name: 'Finance' },
        update: { description: 'Expenses, invoices, purchasing, vendors, payments, and budgets.', isPublic: true, isActive: true, autoAssign: false, defaultTemplateId: financeTemplate.id },
        create: { name: 'Finance', description: 'Expenses, invoices, purchasing, vendors, payments, and budgets.', isPublic: true, isActive: true, defaultTemplateId: financeTemplate.id },
    });

    const itGroup = await prisma.group.upsert({
        where: { entraObjectId: 'it-support-group-id' }, update: { name: 'IT Support Team' },
        create: { name: 'IT Support Team', entraObjectId: 'it-support-group-id', description: 'Technical support agents' },
    });
    const hrGroup = await prisma.group.upsert({
        where: { entraObjectId: 'hr-group-id' }, update: { name: 'HR Team' },
        create: { name: 'HR Team', entraObjectId: 'hr-group-id', description: 'Human Resources agents' },
    });
    for (const [userId, groupId] of [[agent1.id, itGroup.id], [agent2.id, hrGroup.id]] as const) {
        await prisma.groupMember.upsert({ where: { userId_groupId: { userId, groupId } }, update: {}, create: { userId, groupId } });
    }
    for (const [queueId, groupId] of [[itQueue.id, itGroup.id], [hrQueue.id, hrGroup.id]] as const) {
        await prisma.queueGroup.upsert({ where: { queueId_groupId_role: { queueId, groupId, role: 'agent' } }, update: {}, create: { queueId, groupId, role: 'agent' } });
    }
    await prisma.queueMember.upsert({ where: { queueId_userId_role: { queueId: financeQueue.id, userId: agent2.id, role: 'agent' } }, update: {}, create: { queueId: financeQueue.id, userId: agent2.id, role: 'agent' } });
    for (const queue of [itQueue, hrQueue, financeQueue]) {
        await prisma.queueMember.upsert({ where: { queueId_userId_role: { queueId: queue.id, userId: applicationAdmin.id, role: 'admin' } }, update: {}, create: { queueId: queue.id, userId: applicationAdmin.id, role: 'admin' } });
    }

    await removeLegacyCategoryCopies(itQueue.id, ['Onboarding', 'Payroll']);
    await removeLegacyCategoryCopies(hrQueue.id, ['Access', 'Hardware', 'Network', 'Software']);
    await removeLegacyCategoryCopies(financeQueue.id, ['Access', 'Hardware', 'Network', 'Onboarding', 'Payroll', 'Software']);

    const categories = new Map<string, Awaited<ReturnType<typeof upsertCategory>>>();
    const categorySpecs: Array<[typeof itQueue, string, string, string | null, string[]]> = [
        [itQueue, 'Hardware & devices', 'Computers, phones, printers, and peripherals.', null, ['Hardware']],
        [itQueue, 'Software & applications', 'Application installation, errors, and configuration.', null, ['Software']],
        [itQueue, 'Network & connectivity', 'Office network, Wi-Fi, internet, and VPN.', null, ['Network']],
        [itQueue, 'Access & permissions', 'New, changed, temporary, or removed system access.', accessTemplate.id, ['Access']],
        [itQueue, 'Email & collaboration', 'Email, calendar, Teams, and shared workspaces.', null, []],
        [itQueue, 'Other IT request', 'Technical requests that do not fit another category.', null, ['General']],
        [hrQueue, 'Leave & absence', 'Leave, absence, and return-to-work questions.', null, []],
        [hrQueue, 'Payroll & benefits', 'Payslips, salary, benefits, and deductions.', null, ['Payroll']],
        [hrQueue, 'Employee documents', 'Certificates, letters, and employment documents.', null, []],
        [hrQueue, 'Onboarding & offboarding', 'Employee arrival, internal moves, and departures.', null, ['Onboarding']],
        [hrQueue, 'Workplace concern', 'Confidential workplace and employee-relations support.', null, []],
        [hrQueue, 'Other HR request', 'HR requests that do not fit another category.', null, ['General']],
        [financeQueue, 'Expenses & reimbursements', 'Expense reports, receipts, and reimbursement.', null, ['Expense']],
        [financeQueue, 'Invoices & payments', 'Supplier invoices, payment status, and remittance.', null, []],
        [financeQueue, 'Purchasing & approvals', 'Purchase requests and approval questions.', null, []],
        [financeQueue, 'Vendors', 'Vendor creation and master-data changes.', null, ['Vendor']],
        [financeQueue, 'Budget & cost centers', 'Budget availability, coding, and cost-center changes.', null, []],
        [financeQueue, 'Other Finance request', 'Finance requests that do not fit another category.', null, ['General']],
    ];
    for (const [queue, name, description, templateId, aliases] of categorySpecs) {
        const category = await upsertCategory(queue.id, name, description, templateId, aliases);
        categories.set(`${queue.id}:${name}`, category);
    }
    const tagSpecs = [
        { name: 'urgent', color: '#dc2626' }, { name: 'access', color: '#7c3aed' },
        { name: 'vpn', color: '#2563eb' }, { name: 'hardware', color: '#475569' },
        { name: 'new-hire', color: '#059669' }, { name: 'invoice', color: '#d97706' },
    ];
    for (const tag of tagSpecs) await prisma.tag.upsert({ where: { name: tag.name }, update: tag, create: tag });

    const slaSpecs = [
        { queueId: itQueue.id, priority: Priority.URGENT, firstResponseMinutes: 15, resolutionMinutes: 120 },
        { queueId: itQueue.id, priority: Priority.HIGH, firstResponseMinutes: 30, resolutionMinutes: 480 },
        { queueId: itQueue.id, priority: Priority.NORMAL, firstResponseMinutes: 120, resolutionMinutes: 1440 },
        { queueId: itQueue.id, priority: Priority.LOW, firstResponseMinutes: 480, resolutionMinutes: 4320 },
        { queueId: hrQueue.id, priority: Priority.NORMAL, firstResponseMinutes: 240, resolutionMinutes: 2880 },
        { queueId: financeQueue.id, priority: Priority.NORMAL, firstResponseMinutes: 240, resolutionMinutes: 2880 },
    ];
    for (const policy of slaSpecs) {
        await prisma.slaPolicy.upsert({ where: { queueId_priority: { queueId: policy.queueId, priority: policy.priority } }, update: policy, create: policy });
    }

    await prisma.ticketCounter.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton', year: new Date().getFullYear(), count: 0 } });
    const tickets = [
        {
            key: 'TCK-2026-DEMO01', title: 'VPN disconnects after authentication',
            description: 'The VPN connects for a few seconds, then disconnects with error 812.',
            status: TicketStatus.OPEN, priority: Priority.HIGH, queueId: itQueue.id,
            categoryId: categories.get(`${itQueue.id}:Network & connectivity`)!.id,
            requesterId: user1.id, assigneeUserId: agent1.id, template: itTemplate,
            values: { title: 'VPN disconnects after authentication', description: 'The VPN connects for a few seconds, then disconnects with error 812.', priority: 'HIGH', device_type: 'Laptop', work_location: 'Remote', business_impact: 'One person', error_message: 'Error 812 after authentication.' },
        },
        {
            key: 'TCK-2026-DEMO02', title: 'Access to Finance reporting workspace',
            description: 'Read-only access is required for monthly management reporting.',
            status: TicketStatus.NEW, priority: Priority.NORMAL, queueId: itQueue.id,
            categoryId: categories.get(`${itQueue.id}:Access & permissions`)!.id,
            requesterId: user2.id, assigneeUserId: null, template: accessTemplate,
            values: { title: 'Access to Finance reporting workspace', description: 'Read-only access is required for monthly management reporting.', priority: 'NORMAL', application_name: 'Finance reporting workspace', access_action: 'Grant access', access_level: 'Read-only', approver: 'Nadia Admin', business_justification: 'Required to prepare the monthly reporting pack.' },
        },
        {
            key: 'TCK-2026-DEMO03', title: 'Employment certificate for rental application',
            description: 'Please provide an employment certificate showing my position and start date.',
            status: TicketStatus.PENDING_AGENT, priority: Priority.NORMAL, queueId: hrQueue.id,
            categoryId: categories.get(`${hrQueue.id}:Employee documents`)!.id,
            requesterId: user1.id, assigneeUserId: agent2.id, template: hrTemplate,
            values: { title: 'Employment certificate for rental application', description: 'Please provide an employment certificate showing my position and start date.', priority: 'NORMAL', hr_request_type: 'Employee document', confidential: false },
        },
        {
            key: 'TCK-2026-DEMO04', title: 'Expense report ER-1048 reimbursement',
            description: 'The approved report has not yet appeared in this month’s payment.',
            status: TicketStatus.PENDING_AGENT, priority: Priority.NORMAL, queueId: financeQueue.id,
            categoryId: categories.get(`${financeQueue.id}:Expenses & reimbursements`)!.id,
            requesterId: user2.id, assigneeUserId: agent2.id, template: financeTemplate,
            values: { title: 'Expense report ER-1048 reimbursement', description: 'The approved report has not yet appeared in this month’s payment.', priority: 'NORMAL', finance_request_type: 'Expense reimbursement', reference_number: 'ER-1048', amount: '284.50', currency: 'EUR', cost_center: 'CONSULTING' },
        },
        {
            key: 'TCK-2026-DEMO05', title: 'Teams meeting room microphone not detected',
            description: 'The microphone in meeting room Atlas is not available in Teams.',
            status: TicketStatus.RESOLVED, priority: Priority.HIGH, queueId: itQueue.id,
            categoryId: categories.get(`${itQueue.id}:Hardware & devices`)!.id,
            requesterId: user1.id, assigneeUserId: agent1.id, template: itTemplate,
            values: { title: 'Teams meeting room microphone not detected', description: 'The microphone in meeting room Atlas is not available in Teams.', priority: 'HIGH', device_type: 'Other', work_location: 'Paris office - Atlas', business_impact: 'Several people', error_message: 'USB conference device was not listed in Teams.' },
        },
    ];
    for (const item of tickets) {
        const existing = await prisma.ticket.findUnique({ where: { key: item.key } });
        const ticket = await prisma.ticket.upsert({
            where: { key: item.key }, update: {},
            create: {
                key: item.key, title: item.title, description: item.description, status: item.status,
                priority: item.priority, queueId: item.queueId, categoryId: item.categoryId,
                requesterId: item.requesterId,
                resolvedTemplateId: item.template.id, resolvedTemplateVersion: item.template.version,
                formSchemaSnapshot: snapshot(item.template), submittedFormValues: item.values,
                resolvedAt: item.status === TicketStatus.RESOLVED ? new Date() : null,
            },
        });
        if (item.assigneeUserId) {
            await prisma.ticketAssignee.upsert({
                where: { ticketId_userId: { ticketId: ticket.id, userId: item.assigneeUserId } },
                update: {},
                create: {
                    ticketId: ticket.id,
                    userId: item.assigneeUserId,
                    assignedById: item.assigneeUserId,
                    source: AssignmentSource.AUTOMATION,
                },
            });
        }
        await prisma.ticketWatcher.upsert({
            where: { ticketId_userId: { ticketId: ticket.id, userId: item.requesterId } },
            update: {}, create: { ticketId: ticket.id, userId: item.requesterId },
        });
        if (!existing) await prisma.timelineEvent.create({
            data: { ticketId: ticket.id, userId: item.requesterId, type: 'CREATED', content: `Ticket created: ${item.title}` },
        });
    }

    const cannedResponses = [
        { title: 'Request received', content: 'Thank you. Your request has been received and is being reviewed. We will update this ticket if we need more information.', category: 'General' },
        { title: 'More information required', content: 'To continue, please provide the missing details requested above. You can reply directly to this ticket and attach supporting files.', category: 'General' },
        { title: 'Resolution confirmation', content: 'The requested action has been completed. Please confirm that everything is working as expected, or reply with any remaining issue.', category: 'Resolution' },
    ];
    for (const response of cannedResponses) {
        const existing = await prisma.cannedResponse.findFirst({ where: { title: response.title } });
        if (existing) await prisma.cannedResponse.update({ where: { id: existing.id }, data: response });
        else await prisma.cannedResponse.create({ data: response });
    }

    await seedHelpCenter();
    const brandingConfig = {
        applicationName: 'CompDesk', shortApplicationName: 'CompDesk', subtitle: 'Helpdesk',
        description: 'CompDesk is a lightweight, privacy-first, self-hosted ticketing and help desk platform built by xHydra.',
        mainLogoUrl: '', compactLogoUrl: '', lightLogoUrl: '', darkLogoUrl: '', faviconUrl: '',
        primaryColor: '#4f46e5', accentColor: '#64748b', loginHeading: 'Welcome to CompDesk',
        loginDescription: 'Sign in to access your support workspace.', loginBackgroundImageUrl: '',
        supportEmail: 'support@example.com', footerText: 'CompDesk', showDemoAccounts: false,
        demoAccountInfo: '', microsoftButtonText: 'Sign in with Microsoft',
    };
    for (const [key, value] of Object.entries({
        branding_config: JSON.stringify(brandingConfig), login_local_enabled: 'true', login_microsoft_enabled: 'true',
    })) {
        await prisma.appSetting.upsert({ where: { key }, update: {}, create: { key, value } });
    }
    console.log(`Seed complete. Demo super administrator: ${accountSpecs[0].email}`);
    if (generatedPassword) console.log(`Generated demo password (shown once): ${generatedPassword}`);
    console.log('Demo data is for disposable evaluation only. Remove or deactivate demo accounts before real use.');
}

main()
    .catch((error) => { console.error('Seed failed:', error); process.exitCode = 1; })
    .finally(async () => prisma.$disconnect());