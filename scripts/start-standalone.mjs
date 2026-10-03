import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';
import './runtime-network.cjs';
import { PrismaClient } from '@prisma/client';
import { verifyDatabaseSchema } from './database-schema.mjs';
import { runPrivateAttachmentMigration } from './migrate-private-attachments.mjs';

const { loadEnvConfig } = nextEnv;
const root = process.cwd();
loadEnvConfig(root);

const serverPath = path.join(root, '.next', 'standalone', 'server.js');
if (!fs.existsSync(serverPath)) {
    throw new Error('Standalone server not found. Run npm run build first.');
}

// All local launch paths must secure legacy public copies before Next serves files.
await runPrivateAttachmentMigration();
const schemaClient = new PrismaClient();
try {
    await verifyDatabaseSchema(sql => schemaClient.$queryRawUnsafe(sql));
} finally { await schemaClient.$disconnect(); }
await import(pathToFileURL(serverPath).href);
