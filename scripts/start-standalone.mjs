import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
const root = process.cwd();
loadEnvConfig(root);

const serverPath = path.join(root, '.next', 'standalone', 'server.js');
if (!fs.existsSync(serverPath)) {
    throw new Error('Standalone server not found. Run npm run build first.');
}

await import(pathToFileURL(serverPath).href);
