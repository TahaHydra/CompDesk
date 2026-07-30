import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const { Client } = pg;
const previousReleaseMigration = '20260727130000_add_multiple_ticket_assignees';
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

const databaseName = `compdesk_upgrade_${randomBytes(8).toString('hex')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;
databaseUrl.searchParams.set('schema', 'public');
const tempRoot = await mkdtemp(path.join(tmpdir(), 'compdesk-migration-'));
const previousPrisma = path.join(tempRoot, 'prisma');
const admin = new Client({ connectionString: adminUrl.toString() });

function quoteIdentifier(value) {
    return `"${value.replaceAll('"', '""')}"`;
}

function migrate(schemaPath, targetUrl) {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(command, ['exec', '--', 'prisma', 'migrate', 'deploy', '--schema', schemaPath], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: targetUrl },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0) {
        const safeOutput = `${result.stdout}\n${result.stderr}`
            .replaceAll(targetUrl, '[REDACTED_DATABASE_URL]')
            .replaceAll(adminUrl.toString(), '[REDACTED_DATABASE_URL]');
        throw new Error(`Prisma migration failed:\n${safeOutput.trim()}`);
    }
}

async function preparePreviousReleaseSchema() {
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
}

async function seedRealisticPreviousData() {
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

async function verifyUpgrade() {
    const client = new Client({ connectionString: databaseUrl.toString() });
    await client.connect();
    try {
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

let created = false;
try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    created = true;
    await preparePreviousReleaseSchema();
    migrate(path.join(previousPrisma, 'schema.prisma'), databaseUrl.toString());
    await seedRealisticPreviousData();
    migrate(path.join(sourcePrisma, 'schema.prisma'), databaseUrl.toString());
    await verifyUpgrade();
    console.log(`Previous-release upgrade rehearsal passed through ${previousReleaseMigration}.`);
} finally {
    if (created) {
        await admin.query(
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
            [databaseName],
        );
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
    }
    await admin.end().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
}