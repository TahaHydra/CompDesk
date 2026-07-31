import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const stateDirectory = path.join(root, '.compdesk');
const receiptPath = path.join(stateDirectory, 'installation.json');
const statePath = path.join(stateDirectory, 'setup-state.json');
const confirmation = process.argv.find((argument) => argument.startsWith('--confirm='))?.slice('--confirm='.length);

if (confirmation !== 'RESET-INCOMPLETE-SETUP') {
    console.error('Refusing recovery. Run locally with --confirm=RESET-INCOMPLETE-SETUP.');
    process.exit(2);
}
if (fs.existsSync(receiptPath)) {
    console.error('CompDesk is installed. Recovery will not reopen first-run setup or erase the database.');
    process.exit(3);
}
if (fs.existsSync(statePath)) {
    fs.renameSync(statePath, `${statePath}.recovered-${new Date().toISOString().replaceAll(':', '-')}`);
}
console.log('Incomplete non-secret setup state was archived. Restart npm start to issue a new bootstrap token.');
