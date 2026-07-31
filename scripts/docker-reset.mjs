import path from 'node:path';
import readline from 'node:readline/promises';
import { executeDockerReset, planDockerReset } from './docker-project.mjs';

const root = process.cwd();
const stateDirectory = path.join(root, '.compdesk');
const autoConfirm = process.argv.includes('--yes') || process.argv.includes('-y');
const plan = planDockerReset({ stateDirectory });

console.log('CompDesk Docker reset');
console.log('======================');
console.log(plan.warning);
console.log('');

async function confirmedByUser() {
    if (autoConfirm) return true;
    if (!process.stdin.isTTY) {
        console.error('Refusing to reset: no interactive terminal is attached. Re-run with --yes to skip confirmation.');
        return false;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await rl.question('Type "delete" to permanently remove these resources, or anything else to cancel: ');
        return answer.trim().toLowerCase() === 'delete';
    } finally {
        rl.close();
    }
}

if (!(await confirmedByUser())) {
    console.log('Reset cancelled. No CompDesk resources were removed.');
    process.exit(1);
}

console.log('Removing CompDesk Docker resources...');
executeDockerReset(plan, { log: console.log });
console.log('Done. CompDesk containers, networks, volumes, and generated configuration have been removed.');
