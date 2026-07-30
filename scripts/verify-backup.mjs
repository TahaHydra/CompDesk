import fs from 'node:fs/promises';
import path from 'node:path';

const target = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!target) throw new Error('Usage: node scripts/verify-backup.mjs <backup-directory>');
const manifest = JSON.parse(await fs.readFile(path.join(target, 'manifest.json'), 'utf8'));
if (manifest.format !== 'compdesk-backup-v1') throw new Error('Unsupported or missing CompDesk backup manifest.');
for (const key of ['database', 'attachments', 'uploads', 'configuration']) {
    const candidate = path.resolve(target, manifest[key]);
    const relative = path.relative(target, candidate);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Unsafe ${key} path in backup manifest.`);
    const stat = await fs.stat(candidate);
    if (key === 'database' || key === 'configuration') {
        if (!stat.isFile() || stat.size === 0) throw new Error(`${key} backup is missing or empty.`);
    } else if (!stat.isDirectory()) throw new Error(`${key} backup directory is missing.`);
}
console.log('Backup structure is complete. This does not replace an isolated restore rehearsal.');