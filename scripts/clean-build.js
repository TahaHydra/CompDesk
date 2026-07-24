const fs = require('node:fs');
const path = require('node:path');

const nextDirectory = path.resolve(process.cwd(), '.next');
fs.rmSync(nextDirectory, { recursive: true, force: true });
console.log('Removed previous .next build output.');
