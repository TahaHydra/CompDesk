import { readFileSync } from 'fs';
import path from 'path';

const schema = readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
const historyMigration = readFileSync(path.join(
    process.cwd(), 'prisma', 'migrations',
    '20260723170000_enforce_ticket_form_history', 'migration.sql'
), 'utf8');
const migration = readFileSync(path.join(
    process.cwd(), 'prisma', 'migrations',
    '20260723150000_add_branding_department_categories_and_ticket_form_templates', 'migration.sql'
), 'utf8');
const localizationMigration = readFileSync(path.join(
    process.cwd(), 'prisma', 'migrations',
    '20260724120000_add_user_language_and_help_center', 'migration.sql'
), 'utf8');

describe('department category and ticket-form migration contract', () => {
    it('allows the same category name in different departments only', () => {
        expect(schema).toContain('@@unique([queueId, name])');
        expect(schema).not.toContain('name        String    @unique');
        expect(migration).toContain('CREATE UNIQUE INDEX "categories_queue_id_name_key"');
    });

    it('copies every global category to every department and remaps by the ticket department', () => {
        expect(migration).toContain('CROSS JOIN "categories" c');
        expect(migration).toContain("md5(t.\"queue_id\" || ':' || t.\"category_id\")");
        expect(migration.indexOf('UPDATE "tickets" t\nSET "category_id"')).toBeLessThan(migration.indexOf('DELETE FROM "categories" WHERE "queue_id" IS NULL'));
    });

    it('migrates legacy department fields before dropping their table', () => {
        expect(migration).toContain('Migrated from the legacy department-owned form fields.');
        expect(migration).toContain('legacy_');
        expect(migration.indexOf('INSERT INTO "ticket_form_template_fields"')).toBeLessThan(migration.indexOf('DROP TABLE "form_fields"'));
    });

    it('stores complete immutable snapshots for existing tickets', () => {
        for (const key of ['templateId', 'templateName', 'fieldKey', 'placeholder', 'helpText', 'validationRules', 'conditionalRules', 'visibleTo', 'editableBy', 'isActive']) {
            expect(migration).toContain(`'${key}'`);
        }
        expect(migration).toContain('"resolved_template_version" = s."version"');
    });

    it('requires complete immutable template history for every ticket', () => {
        expect(schema).toMatch(/resolvedTemplateId\s+String\s+@map\("resolved_template_id"\)/);
        expect(schema).toMatch(/submittedFormValues\s+Json\s+@default\("{}"\)/);
        expect(schema).toMatch(/resolvedTemplate\s+TicketFormTemplate\s+@relation\(fields: \[resolvedTemplateId\], references: \[id\], onDelete: Restrict\)/);
        expect(historyMigration).toContain('Ticket form history backfill is incomplete');
        expect(historyMigration).toContain('ALTER COLUMN "submitted_form_values" SET NOT NULL');
        expect(historyMigration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    });

    it('protects the system default at both schema and database levels', () => {
        expect(migration).toContain('ticket_form_templates_single_system_default_key');
        expect(migration).toContain('protect_system_ticket_form_template_trigger');
        expect(migration).toContain('cannot be demoted or archived');
    });

    it('uses restrict/archival semantics for historical category data', () => {
        expect(schema).toMatch(/category\s+Category\?\s+@relation\(fields: \[categoryId\], references: \[id\], onDelete: Restrict\)/);
        expect(schema).toContain('archivedAt  DateTime? @map("archived_at")');
    });
});

describe('language and help-center migration contract', () => {
    it('adds a constrained per-user language without changing existing accounts', () => {
        expect(schema).toContain('preferredLanguage String');
        expect(localizationMigration).toContain('ADD COLUMN "preferred_language" TEXT NOT NULL DEFAULT \'en\'');
        expect(localizationMigration).toContain("CHECK (\"preferred_language\" IN ('en', 'fr'))");
    });

    it('creates bilingual help collections and articles with restrictive deletion', () => {
        expect(schema).toContain('model HelpCollection');
        expect(schema).toContain('model HelpArticle');
        expect(localizationMigration).toContain('CREATE TABLE "help_collections"');
        expect(localizationMigration).toContain('CREATE TABLE "help_articles"');
        expect(localizationMigration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    });
});