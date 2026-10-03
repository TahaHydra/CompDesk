const fs = require('node:fs');
const path = require('node:path');
const { assertNoLegacyPublicUploads } = require('./public-upload-guard.js');

const root = process.cwd();
const standaloneRoot = path.join(root, '.next', 'standalone');

function replaceDirectory(from, to, filter) {
    if (!fs.existsSync(from)) return;
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true, filter });
}

if (!fs.existsSync(standaloneRoot)) {
    throw new Error('Next.js standalone output was not generated.');
}
assertNoLegacyPublicUploads(path.join(standaloneRoot, 'public'));
replaceDirectory(path.join(root, '.next', 'static'), path.join(standaloneRoot, '.next', 'static'));
const publicRoot = path.join(root, 'public');
replaceDirectory(publicRoot, path.join(standaloneRoot, 'public'), (source) => {
    const parts = path.relative(publicRoot, source).split(path.sep);
    // Keep legacy originals for migration/backup, but never publish ticket files.
    return parts[0] !== 'uploads' || parts.length === 1 || ['branding', 'quick-links'].includes(parts[1]);
});
