import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const PLACEHOLDER_IMAGE_REFERENCE = /\$\{COMPDESK_IMAGE:-([^}]+)\}:\$\{COMPDESK_VERSION:-0\.0\.0-local\}/g;

// Produces the exact Compose file a GitHub Release asset ships: every
// ${COMPDESK_IMAGE:-...}:${COMPDESK_VERSION:-0.0.0-local} reference in the
// source docker-compose.yml is replaced with a literal, immutable
// "<image>:<version>" — so a downloaded release asset runs with a plain
// `docker compose up -d` and zero environment variables, and can never
// silently resolve to a different version later. The source-tree file is
// never modified; this always returns a new string.
export function pinReleaseCompose(sourceText, version) {
    if (!SEMVER_PATTERN.test(version)) {
        throw new Error(`"${version}" is not a valid semantic version (expected MAJOR.MINOR.PATCH[-prerelease], no leading "v").`);
    }
    let count = 0;
    const pinned = sourceText.replace(PLACEHOLDER_IMAGE_REFERENCE, (_match, image) => {
        count += 1;
        return `${image}:${version}`;
    });
    if (count === 0) {
        throw new Error('No ${COMPDESK_IMAGE:-...}:${COMPDESK_VERSION:-0.0.0-local} reference found to pin — is the source docker-compose.yml unchanged?');
    }
    return pinned;
}

const isMain = (() => {
    try {
        return fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '');
    } catch {
        return false;
    }
})();

if (isMain) {
    const version = process.argv[2];
    if (!version) {
        console.error('Usage: node scripts/generate-release-compose.mjs <version> [output-path]');
        console.error('Example: node scripts/generate-release-compose.mjs 1.2.3 dist/docker-compose.yml');
        process.exit(1);
    }
    const outputPath = process.argv[3] || null;
    const sourcePath = path.join(process.cwd(), 'docker-compose.yml');
    try {
        const pinned = pinReleaseCompose(fs.readFileSync(sourcePath, 'utf8'), version);
        if (outputPath) {
            fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
            fs.writeFileSync(outputPath, pinned);
            console.log(`Wrote a version-pinned release Compose file to ${outputPath}.`);
        } else {
            process.stdout.write(pinned);
        }
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
