const fs = require('fs');
const path = require('path');

const root = process.cwd();
const standaloneRoot = path.join(root, '.next', 'standalone');

function copyIfExists(from, to) {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(to, { recursive: true });
    fs.cpSync(from, to, { recursive: true, force: true });
}

copyIfExists(path.join(root, '.next', 'static'), path.join(standaloneRoot, '.next', 'static'));
copyIfExists(path.join(root, 'public'), path.join(standaloneRoot, 'public'));
