import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(root)) {
    console.error('Usage: node scripts/check-sarif.mjs <SARIF file or directory>');
    process.exit(2);
}

function sarifFiles(target) {
    const stat = fs.statSync(target);
    if (stat.isFile()) return target.endsWith('.sarif') ? [target] : [];
    return fs.readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
        const child = path.join(target, entry.name);
        return entry.isDirectory() ? sarifFiles(child) : (entry.isFile() && entry.name.endsWith('.sarif') ? [child] : []);
    });
}

const files = sarifFiles(root);
if (files.length === 0) {
    console.error('No SARIF result files were produced.');
    process.exit(2);
}

const findings = [];
for (const file of files) {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const run of document.runs || []) {
        const rules = new Map((run.tool?.driver?.rules || []).map((rule) => [rule.id, rule]));
        for (const result of run.results || []) {
            const rule = rules.get(result.ruleId);
            const level = result.level || rule?.defaultConfiguration?.level || 'warning';
            if (!['warning', 'error'].includes(level)) continue;
            const physical = result.locations?.[0]?.physicalLocation;
            const uri = physical?.artifactLocation?.uri;
            const line = physical?.region?.startLine;
            findings.push({
                ruleId: result.ruleId || 'unknown',
                level,
                location: uri ? `${uri}${line ? `:${line}` : ''}` : 'unknown location',
                message: String(result.message?.text || 'Static-analysis finding').replaceAll(/\s+/g, ' ').slice(0, 240),
            });
        }
    }
}

if (findings.length > 0) {
    console.error(`Static analysis reported ${findings.length} blocking finding(s).`);
    for (const finding of findings.slice(0, 50)) {
        console.error(`${finding.level}: ${finding.ruleId}: ${finding.location}: ${finding.message}`);
    }
    process.exit(1);
}

console.log(`Static analysis passed across ${files.length} SARIF file(s) with no warning/error findings.`);