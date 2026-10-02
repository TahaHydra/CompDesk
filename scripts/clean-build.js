const fs = require('node:fs');
const path = require('node:path');
const { assertNoLegacyPublicUploads } = require('./public-upload-guard.js');

const nextDirectory = path.resolve(process.cwd(), '.next');
assertNoLegacyPublicUploads(path.join(nextDirectory, 'standalone', 'public'));
fs.rmSync(nextDirectory, { recursive: true, force: true });
console.log('Removed previous .next build output.');
