import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const forbiddenTerms = [
    String.fromCharCode(101, 120, 99, 111),
    String.fromCharCode(101, 120, 99, 111, 100, 101, 115, 107),
    String.fromCharCode(111, 112, 101, 110, 97, 105),
    String.fromCharCode(99, 108, 97, 117, 100, 101),
    String.fromCharCode(97, 110, 116, 104, 114, 111, 112, 105, 99),
];

function trackedFiles() {
    return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean);
}

describe('public repository hygiene', () => {
    it('contains no known customer or model-vendor references in tracked text', () => {
        const findings: string[] = [];
        for (const relative of trackedFiles()) {
            const absolute = path.resolve(relative);
            const contents = fs.readFileSync(absolute);
            if (contents.includes(0)) continue;
            const text = contents.toString('utf8').toLowerCase();
            for (const term of forbiddenTerms) {
                if (text.includes(term)) findings.push(`${relative}: ${term}`);
            }
        }
        expect(findings).toEqual([]);
    });

    it('does not track local secrets, dumps, logs, or uploaded content', () => {
        const unsafe = trackedFiles().filter((relative) => {
            const normalized = relative.replaceAll('\\', '/').toLowerCase();
            return normalized === '.env'
                || normalized.startsWith('.compdesk/')
                || (normalized.startsWith('public/uploads/') && !normalized.endsWith('/.gitkeep'))
                || normalized.startsWith('storage/attachments/')
                || /\.(?:dump|log|sqlite|sqlite3)$/.test(normalized);
        });
        expect(unsafe).toEqual([]);
    });
});