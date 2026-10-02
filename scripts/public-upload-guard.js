const fs = require('node:fs');
const path = require('node:path');

function containsFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).some((entry) =>
        !entry.isDirectory() || containsFiles(path.join(directory, entry.name)));
}

function assertNoLegacyPublicUploads(publicRoot) {
    const uploads = path.join(publicRoot, 'uploads');
    if (!fs.existsSync(uploads)) return;
    for (const entry of fs.readdirSync(uploads, { withFileTypes: true })) {
        if (entry.name === '.gitkeep' && entry.isFile() && fs.lstatSync(path.join(uploads, entry.name)).size === 0) continue;
        if (['branding', 'quick-links'].includes(entry.name) && entry.isDirectory()) continue;
        if (entry.name === '.gitkeep' || !entry.isDirectory() || containsFiles(path.join(uploads, entry.name))) {
            throw new Error('Legacy standalone uploads must be secured before replacing build output. Back up the installation, then run node scripts/migrate-private-attachments.mjs.');
        }
    }
}

module.exports = { assertNoLegacyPublicUploads };
