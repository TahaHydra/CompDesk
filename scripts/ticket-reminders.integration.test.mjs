import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';

// Explicit test connection only. All rows live in a uniquely owned disposable schema.
const url = process.env.REMINDER_TEST_DATABASE_URL;
if (!url) throw new Error('REMINDER_TEST_DATABASE_URL is required; application DATABASE_URL is never used implicitly');
const source = await fs.readFile(process.env.REMINDER_TEST_CLAIM_SOURCE || 'src/lib/ticket-reminders.ts', 'utf8');
const match = source.match(/const claimed = await prisma\.\$queryRaw[\s\S]*?`([\s\S]*?)`;/);
if (!match) throw new Error('Reminder claim query was not found');
const query = match[1].replaceAll('${leaseToken}', '$1');
const schema = `compdesk_reminder_test_${randomBytes(8).toString('hex')}`;
assert.match(schema, /^compdesk_reminder_test_[a-f0-9]{16}$/);

test('real PostgreSQL claims obey UTC schedules, replica leases and restart expiry', async () => {
    const first = new pg.Client({ connectionString: url }), second = new pg.Client({ connectionString: url });
    await first.connect();
    let created = false;
    try {
        await first.query(`CREATE SCHEMA "${schema}"`); created = true;
        await first.query(`SET search_path TO "${schema}"`);
        await first.query("SET TIME ZONE 'Europe/Paris'");
        await first.query(`CREATE TABLE ticket_reminders (id text PRIMARY KEY, status text DEFAULT 'PENDING', scheduled_at timestamp(3), next_attempt_at timestamp(3), lease_token text, lease_until timestamp(3), attempts int DEFAULT 0)`);
        const now = Date.now(), due = new Date(now - 60000).toISOString(), future = new Date(now + 3600000).toISOString();
        for (const [id, scheduled, lease] of [['due', due, null], ['future', future, null], ['leased', due, future]]) {
            await first.query('INSERT INTO ticket_reminders(id, scheduled_at, next_attempt_at, lease_until) VALUES ($1, $2, $2, $3)', [id, scheduled, lease]);
        }
        await second.connect(); await second.query(`SET search_path TO "${schema}"`); await second.query("SET TIME ZONE 'America/New_York'");
        const tokens = [randomUUID(), randomUUID()];
        const claims = await Promise.all([first.query(query, [tokens[0]]), second.query(query, [tokens[1]])]);
        assert.deepEqual(claims.flatMap((claim) => claim.rows.map((row) => row.id)), ['due']);
        const state = await first.query("SELECT EXTRACT(EPOCH FROM (lease_until - timezone('UTC', NOW()))) AS remaining, attempts FROM ticket_reminders WHERE id='due'");
        assert.ok(Number(state.rows[0].remaining) > 290 && Number(state.rows[0].remaining) <= 300);
        assert.equal(state.rows[0].attempts, 1);
        assert.equal((await first.query(query, [randomUUID()])).rowCount, 0);
        // Simulate crash/restart after the durable lease expires.
        await first.query("UPDATE ticket_reminders SET lease_until=timezone('UTC', NOW())-INTERVAL '1 minute' WHERE id='due'");
        assert.deepEqual((await second.query(query, [randomUUID()])).rows.map((row) => row.id), ['due']);
        assert.equal((await first.query("SELECT attempts FROM ticket_reminders WHERE id='due'")).rows[0].attempts, 2);
    } finally {
        await second.end();
        if (created) await first.query(`DROP SCHEMA "${schema}" CASCADE`);
        await first.end();
    }
});
