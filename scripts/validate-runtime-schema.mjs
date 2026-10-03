import pg from 'pg';
import { verifyDatabaseSchema } from './database-schema.mjs';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
try {
    await client.connect();
    await verifyDatabaseSchema(async sql => (await client.query(sql)).rows);
    console.log('Database schema matches the generated application client.');
} catch (error) {
    console.error(error.message?.startsWith('Database schema is incompatible') ? error.message
        : 'Database schema verification failed. Check database connectivity and apply all release migrations; refusing to start CompDesk.');
    process.exitCode = 1;
} finally { await client.end().catch(() => {}); }
