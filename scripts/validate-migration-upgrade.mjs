import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { verifyDatabaseSchema } from './database-schema.mjs';

const { Client } = pg;
// Two rehearsals run against throwaway databases:
// - historical: the oldest supported upgrade path, whose backfills (assignment timestamps,
//   ticket versions, installation record) must keep working;
// - latest: the schema of the most recent published release, seeded with the data later
//   releases touch. Bump LATEST_RELEASE_MIGRATION to the newest shipped migration on every release.
const HISTORICAL_RELEASE_MIGRATION = '20260727130000_add_multiple_ticket_assignees';
const LATEST_RELEASE_MIGRATION = '20261031120000_tag_scopes'; // v0.9.0-beta.5.1
const sourcePrisma = path.resolve('prisma');
const suppliedUrl = process.env.MIGRATION_TEST_DATABASE_URL;

if (!suppliedUrl) {
    console.error('MIGRATION_TEST_DATABASE_URL is required; refusing to use the application DATABASE_URL.');
    process.exit(2);
}

const adminUrl = new URL(suppliedUrl);
if (adminUrl.protocol !== 'postgresql:' && adminUrl.protocol !== 'postgres:') {
    console.error('MIGRATION_TEST_DATABASE_URL must use PostgreSQL.');
    process.exit(2);
}

const tempRoot = await mkdtemp(path.join(tmpdir(), 'compdesk-migration-'));
const admin = new Client({ connectionString: adminUrl.toString() });

function scenarioDatabaseUrl(databaseName) {
    const url = new URL(adminUrl);
    url.pathname = `/${databaseName}`;
    url.searchParams.set('schema', 'public');
    return url;
}

function quoteIdentifier(value) {
    return `"${value.replaceAll('"', '""')}"`;
}

function migrate(schemaPath, targetUrl) {
    const result = spawnSync(process.execPath, [path.resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', schemaPath], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: targetUrl },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
        const safeOutput = `${result.error?.code || ''}\n${result.stdout || ''}\n${result.stderr || ''}`
            .replaceAll(targetUrl, '[REDACTED_DATABASE_URL]')
            .replaceAll(adminUrl.toString(), '[REDACTED_DATABASE_URL]');
        throw new Error(`Prisma migration failed:\n${safeOutput.trim()}`);
    }
}

async function preparePreviousReleaseSchema(previousReleaseMigration) {
    const previousPrisma = path.join(tempRoot, previousReleaseMigration, 'prisma');
    await mkdir(path.join(previousPrisma, 'migrations'), { recursive: true });
    await cp(path.join(sourcePrisma, 'schema.prisma'), path.join(previousPrisma, 'schema.prisma'));
    const entries = await readdir(path.join(sourcePrisma, 'migrations'), { withFileTypes: true });
    const selected = entries
        .filter((entry) => entry.isDirectory() && entry.name <= previousReleaseMigration)
        .sort((left, right) => left.name.localeCompare(right.name));
    if (selected.at(-1)?.name !== previousReleaseMigration) {
        throw new Error(`Previous release boundary ${previousReleaseMigration} was not found.`);
    }
    for (const entry of selected) {
        await cp(
            path.join(sourcePrisma, 'migrations', entry.name),
            path.join(previousPrisma, 'migrations', entry.name),
            { recursive: true },
        );
    }
    return path.join(previousPrisma, 'schema.prisma');
}

async function seedRealisticPreviousData(databaseUrl) {
    const client = new Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
        await client.query('BEGIN');
        const now = new Date();
        const users = [
            ['migration-super', 'Owner@Example.com', 'Release Owner', 'SUPER_ADMIN'],
            ['migration-agent', 'Agent@Example.com', 'Support Agent', 'AGENT'],
            ['migration-user', 'Requester@Example.com', 'Ticket Requester', 'USER'],
        ];
        for (const [id, email, name, role] of users) {
            await client.query(
                `INSERT INTO "users" ("id", "email", "name", "role", "is_active", "preferred_language", "created_at", "updated_at")
                 VALUES ($1, $2, $3, $4::"Role", true, 'en', $5, $5)`,
                [id, email, name, role, now],
            );
        }
        await client.query(
            `INSERT INTO "ticket_form_templates" ("id", "name", "description", "version", "is_system_default", "is_active", "created_at", "updated_at")
             VALUES ('migration-template', 'Standard support', 'Upgrade rehearsal template', 1, false, true, $1, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "queues" ("id", "name", "description", "is_public", "is_active", "auto_assign", "default_template_id", "created_at", "updated_at")
             VALUES ('migration-queue', 'IT Support', 'Existing release department', true, true, false, 'migration-template', $1, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "categories" ("id", "queue_id", "template_id", "name", "description", "is_active", "created_at", "updated_at")
             VALUES ('migration-category', 'migration-queue', 'migration-template', 'Access', 'Existing category', true, $1, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "tickets" (
                "id", "key", "title", "description", "status", "priority", "queue_id", "category_id", "requester_id",
                "resolved_template_id", "resolved_template_version", "form_schema_snapshot", "submitted_form_values",
                "created_at", "updated_at", "escalation_level"
             ) VALUES (
                'migration-ticket', 'TCK-2026-000001', 'Existing ticket survives upgrade', 'Realistic previous-release row',
                'OPEN'::"TicketStatus", 'HIGH'::"Priority", 'migration-queue', 'migration-category', 'migration-user',
                'migration-template', 1, '[]'::jsonb, '{}'::jsonb, $1, $1, 0
             )`,
            [now],
        );
        await client.query(
            `INSERT INTO "ticket_assignees" ("id", "ticket_id", "user_id", "assigned_by_id", "assigned_at", "source")
             VALUES ('migration-assignment', 'migration-ticket', 'migration-agent', 'migration-super', $1, 'MANUAL'::"AssignmentSource")`,
            [now],
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await client.end();
    }
}

async function verifyUpgrade(databaseUrl) {
    const client = new Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
        await verifyDatabaseSchema(async sql => (await client.query(sql)).rows);
        const result = await client.query(`
            SELECT
                (SELECT COUNT(*)::int FROM "tickets" WHERE "id" = 'migration-ticket') AS ticket_count,
                (SELECT COUNT(*)::int FROM "ticket_assignees" WHERE "id" = 'migration-assignment') AS assignment_count,
                (SELECT COUNT(*)::int FROM "installation_records" WHERE "id" = 'primary') AS installation_count,
                (SELECT "normalized_email" FROM "users" WHERE "id" = 'migration-super') AS normalized_email,
                (SELECT "version" FROM "tickets" WHERE "id" = 'migration-ticket') AS ticket_version,
                (SELECT "first_assigned_at" IS NOT NULL FROM "tickets" WHERE "id" = 'migration-ticket') AS assignment_timestamp
        `);
        const row = result.rows[0];
        if (
            row.ticket_count !== 1
            || row.assignment_count !== 1
            || row.installation_count !== 1
            || row.normalized_email !== 'owner@example.com'
            || row.ticket_version !== 1
            || row.assignment_timestamp !== true
        ) {
            throw new Error(`Upgrade verification failed: ${JSON.stringify(row)}`);
        }
    } finally {
        await client.end();
    }
}

async function seedLatestReleaseData(databaseUrl) {
    await seedRealisticPreviousData(databaseUrl);
    const client = new Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
        await client.query('BEGIN');
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        await client.query(
            `INSERT INTO "queue_members" ("id", "queue_id", "user_id", "role")
             VALUES ('migration-member-agent', 'migration-queue', 'migration-agent', 'agent')`,
        );
        await client.query(
            `INSERT INTO "timeline_events" ("id", "ticket_id", "user_id", "type", "content", "metadata", "created_at", "deleted_at", "deleted_by_id", "delete_reason") VALUES
                ('migration-reply', 'migration-ticket', 'migration-agent', 'COMMENT'::"TimelineEventType", 'Visible reply', '{}'::jsonb, $1, NULL, NULL, NULL),
                ('migration-deleted', 'migration-ticket', 'migration-user', 'COMMENT'::"TimelineEventType", 'Moderated original text', '{"deleted":true}'::jsonb, $1, $2, 'migration-super', 'user_requested'),
                ('migration-note', 'migration-ticket', 'migration-agent', 'INTERNAL_NOTE'::"TimelineEventType", 'Private note', NULL, $2, NULL, NULL, NULL)`,
            [yesterday, now],
        );
        await client.query(
            `INSERT INTO "attachments" ("id", "ticket_id", "uploader_id", "filename", "mimetype", "detected_mimetype", "size", "path", "sha256", "created_at") VALUES
                ('migration-attachment', 'migration-ticket', 'migration-user', 'screenshot.png', 'image/png', 'image/png', 1024, 'migration-ticket/screenshot.png', $1, $2),
                ('migration-legacy-attachment', 'migration-ticket', NULL, 'legacy.pdf', 'application/pdf', 'application/pdf', 2048, 'migration-ticket/legacy.pdf', $1, $2)`,
            ['0'.repeat(64), now],
        );
        await client.query(
            `INSERT INTO "tags" ("id", "name", "color", "all_departments", "created_at")
             VALUES ('migration-tag', 'vpn', '#6366f1', false, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "tag_scopes" ("id", "tag_id", "queue_id", "category_id")
             VALUES ('migration-tag-scope', 'migration-tag', 'migration-queue', 'migration-category')`,
        );
        await client.query(
            `INSERT INTO "ticket_tags" ("id", "ticket_id", "tag_id")
             VALUES ('migration-ticket-tag', 'migration-ticket', 'migration-tag')`,
        );
        await client.query(
            `INSERT INTO "help_collections" ("id", "slug", "title_en", "title_fr", "is_published", "created_at", "updated_at")
             VALUES ('migration-help-collection', 'accounts', 'Accounts', 'Comptes', true, $1, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "help_articles" ("id", "collection_id", "slug", "title_en", "title_fr", "content_en", "content_fr", "is_published", "created_at", "updated_at")
             VALUES ('migration-help-article', 'migration-help-collection', 'delegate-mailbox', 'Delegate a mailbox', 'Déléguer une boîte aux lettres', 'Steps', 'Étapes', true, $1, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "canned_responses" ("id", "title", "content", "category", "created_at", "updated_at")
             VALUES ('migration-canned', 'Password reset', 'Use the self-service portal.', 'Accounts', $1, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "ticket_reminders" ("id", "ticket_id", "user_id", "scheduled_at", "note", "created_at", "updated_at")
             VALUES ('migration-reminder', 'migration-ticket', 'migration-agent', $1, 'Follow up', $1, $1)`,
            [now],
        );
        await client.query(
            `INSERT INTO "app_settings" ("id", "key", "value", "updated_at")
             VALUES ('migration-setting', 'feature_attachments_enabled', 'true', $1)`,
            [now],
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await client.end();
    }
}

// The historical backfills (installation record, assignment timestamps) ran before this
// baseline, so this scenario checks the schema and that every seeded row survived intact.
async function verifyLatestReleaseUpgrade(databaseUrl) {
    const client = new Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
        await verifyDatabaseSchema(async sql => (await client.query(sql)).rows);
        const { rows: [row] } = await client.query(`
            SELECT
                (SELECT COUNT(*)::int FROM "tickets" WHERE "id" = 'migration-ticket' AND "title" = 'Existing ticket survives upgrade') AS ticket_count,
                (SELECT COUNT(*)::int FROM "ticket_assignees" WHERE "id" = 'migration-assignment') AS assignment_count,
                (SELECT "normalized_email" FROM "users" WHERE "id" = 'migration-super') AS normalized_email,
                (SELECT COUNT(*)::int FROM "timeline_events" WHERE "id" IN ('migration-reply', 'migration-deleted', 'migration-note')) AS timeline_count,
                (SELECT "content" FROM "timeline_events" WHERE "id" = 'migration-deleted') AS deleted_content,
                (SELECT "deleted_by_id" FROM "timeline_events" WHERE "id" = 'migration-deleted') AS deleted_by,
                (SELECT "uploader_id" FROM "attachments" WHERE "id" = 'migration-attachment') AS uploader,
                (SELECT COUNT(*)::int FROM "attachments" WHERE "id" = 'migration-legacy-attachment' AND "uploader_id" IS NULL) AS legacy_attachment,
                (SELECT COUNT(*)::int FROM "ticket_tags" WHERE "id" = 'migration-ticket-tag') AS ticket_tag,
                (SELECT COUNT(*)::int FROM "tag_scopes" WHERE "id" = 'migration-tag-scope') AS tag_scope,
                (SELECT COUNT(*)::int FROM "help_articles" WHERE "id" = 'migration-help-article' AND "is_published") AS help_article,
                (SELECT COUNT(*)::int FROM "canned_responses" WHERE "id" = 'migration-canned') AS canned_response,
                (SELECT COUNT(*)::int FROM "ticket_reminders" WHERE "id" = 'migration-reminder') AS reminder,
                (SELECT "value" FROM "app_settings" WHERE "key" = 'feature_attachments_enabled') AS setting,
                (SELECT COUNT(*)::int FROM "queue_members" WHERE "id" = 'migration-member-agent') AS membership
        `);
        const expected = {
            ticket_count: 1,
            assignment_count: 1,
            normalized_email: 'owner@example.com',
            timeline_count: 3,
            deleted_content: 'Moderated original text',
            deleted_by: 'migration-super',
            uploader: 'migration-user',
            legacy_attachment: 1,
            ticket_tag: 1,
            tag_scope: 1,
            help_article: 1,
            canned_response: 1,
            reminder: 1,
            setting: 'true',
            membership: 1,
        };
        const mismatched = Object.entries(expected).filter(([key, value]) => row[key] !== value).map(([key]) => key);
        if (mismatched.length > 0) {
            throw new Error(`Latest-release upgrade lost or changed data (${mismatched.join(', ')}): ${JSON.stringify(row)}`);
        }
    } finally {
        await client.end();
    }
}

const scenarios = [
    { name: 'historical', boundary: HISTORICAL_RELEASE_MIGRATION, seed: seedRealisticPreviousData, verify: verifyUpgrade },
    { name: 'latest release', boundary: LATEST_RELEASE_MIGRATION, seed: seedLatestReleaseData, verify: verifyLatestReleaseUpgrade },
];

async function rehearse(scenario) {
    const databaseName = `compdesk_upgrade_${randomBytes(8).toString('hex')}`;
    const databaseUrl = scenarioDatabaseUrl(databaseName);
    let created = false;
    try {
        await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
        created = true;
        const previousSchema = await preparePreviousReleaseSchema(scenario.boundary);
        migrate(previousSchema, databaseUrl.toString());
        await scenario.seed(databaseUrl);
        migrate(path.join(sourcePrisma, 'schema.prisma'), databaseUrl.toString());
        await scenario.verify(databaseUrl);
        console.log(`Upgrade rehearsal (${scenario.name}) passed from ${scenario.boundary}.`);
    } finally {
        if (created) {
            await admin.query(
                'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
                [databaseName],
            );
            await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
        }
    }
}

try {
    await admin.connect();
    for (const scenario of scenarios) {
        await rehearse(scenario);
    }
} finally {
    await admin.end().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
}
