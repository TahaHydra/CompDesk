const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const standaloneRoot = path.join(root, '.next', 'standalone');

function replaceDirectory(from, to) {
    if (!fs.existsSync(from)) return;
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true });
}

if (!fs.existsSync(standaloneRoot)) {
    throw new Error('Next.js standalone output was not generated.');
}
replaceDirectory(path.join(root, '.next', 'static'), path.join(standaloneRoot, '.next', 'static'));
replaceDirectory(path.join(root, 'public'), path.join(standaloneRoot, 'public'));
