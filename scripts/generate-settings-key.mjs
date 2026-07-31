import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const target = path.resolve(process.argv[2] || '.env');
const settingName = 'APP_SETTINGS_ENCRYPTION_KEY';
const assignmentPattern = new RegExp(`^${settingName}=(.*)$`, 'm');
const existingContent = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
const match = existingContent.match(assignmentPattern);

function unquote(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1);
    return trimmed;
}

function isValidKey(value) {
    if (/^[0-9a-f]{64}$/i.test(value)) return true;
    try { return Buffer.from(value, 'base64').length === 32; } catch { return false; }
}

const existingValue = match ? unquote(match[1]) : '';
if (existingValue) {
    if (!isValidKey(existingValue)) {
        throw new Error(`${settingName} already has a non-empty invalid value in ${target}. Correct or remove it explicitly; it was not overwritten.`);
    }
    console.log(`${settingName} is already configured in ${target}; no changes made.`);
    process.exit(0);
}

const generated = crypto.randomBytes(32).toString('base64');
const assignment = `${settingName}="${generated}"`;
let updated;
if (match) {
    updated = existingContent.replace(assignmentPattern, assignment);
} else {
    const separator = existingContent && !existingContent.endsWith('\n') ? '\n' : '';
    updated = `${existingContent}${separator}${assignment}\n`;
}
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, updated, { encoding: 'utf8', mode: 0o600 });
console.log(`Generated and persisted ${settingName} in ${target}. The key value was not printed.`);
