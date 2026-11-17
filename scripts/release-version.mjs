// One command for the version-dependent parts of a release. package.json is the single source
// of truth: the application, update checks and image verification read it (src/lib/version.ts),
// and src/__tests__/release-version.test.ts fails CI when anything else drifts from it.
//
//   npm run release:prepare -- 0.9.0-beta.7   before review: package.json + lockfile, release note stub
//   npm run release:announce -- 0.9.0-beta.7  after the image is public: update manifests, README,
//                                              upgrade-rehearsal boundary, release note title
//
// The manifest on main is read by every installation, so `announce` must only run once the
// release, image and Compose asset are publicly available (docs/PUBLIC_RELEASE_CHECKLIST.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    announceManifest,
    announceReadme,
    assertVersion,
    currentReleaseMigration,
    latestMigration,
    releaseIntro,
    releaseNotePath,
    releaseNoteTemplate,
    setLatestReleaseMigration,
    setPackageVersion,
} from './release-version-core.mjs';

function run(command, version, options, root = process.cwd()) {
    assertVersion(version);
    const file = (relative) => path.join(root, relative);
    const read = (relative) => fs.readFileSync(file(relative), 'utf8');
    const readJson = (relative) => JSON.parse(read(relative));
    const write = (relative, text) => fs.writeFileSync(file(relative), text);
    const writeJson = (relative, value) => write(relative, `${JSON.stringify(value, null, 2)}\n`);

    if (command === 'prepare') {
        const { pkg, lock } = setPackageVersion(readJson('package.json'), readJson('package-lock.json'), version);
        writeJson('package.json', pkg);
        writeJson('package-lock.json', lock);
        const note = releaseNotePath(version);
        if (!fs.existsSync(file(note))) write(note, releaseNoteTemplate(version));
        console.log(`Version set to ${version} in package.json and package-lock.json.`);
        console.log(`Release note: ${note}. Its first paragraph becomes the README and update-dialog summary.`);
        return;
    }

    if (command === 'announce') {
        const packageVersion = readJson('package.json').version;
        if (packageVersion !== version) throw new Error(`package.json says ${packageVersion}; run release:prepare first.`);
        const note = releaseNotePath(version);
        if (!fs.existsSync(file(note))) throw new Error(`${note} is missing.`);
        const manifest = readJson('updates/manifest.json');
        const previousVersion = manifest.latest === version ? null : manifest.latest;
        const summary = releaseIntro(read(note));
        const rehearsal = read('scripts/validate-migration-upgrade.mjs');
        const previousMigration = currentReleaseMigration(rehearsal);
        const migration = latestMigration(fs.readdirSync(file('prisma/migrations')));
        const hasMigrations = Boolean(migration && previousMigration && migration > previousMigration);
        const publishedAt = options.publishedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

        writeJson('updates/manifest.json', announceManifest(manifest, { version, publishedAt, summary, hasMigrations }));
        writeJson('updates/manifest.staging.json', announceManifest(readJson('updates/manifest.staging.json'), { version, publishedAt, summary, hasMigrations, staging: true }));
        write('README.md', announceReadme(read('README.md'), { version, previousVersion, summary }));
        if (migration) write('scripts/validate-migration-upgrade.mjs', setLatestReleaseMigration(rehearsal, migration, version));
        write(note, read(note).replace(/^(# [^\n]*?) \(draft\)/, '$1'));
        console.log(`Announced ${version}: update manifests, README, release note title${migration ? ` and LATEST_RELEASE_MIGRATION (${migration})` : ''}.`);
        console.log('Fill in "Publication checks" in the release note, then commit to main.');
        return;
    }

    throw new Error('Usage: node scripts/release-version.mjs <prepare|announce> <version> [--published-at=ISO-8601]');
}

const isMain = (() => {
    try {
        return fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '');
    } catch {
        return false;
    }
})();

if (isMain) {
    const [command, version, ...rest] = process.argv.slice(2);
    const publishedAt = rest.find((arg) => arg.startsWith('--published-at='))?.split('=')[1];
    try {
        run(command, version, { publishedAt });
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}
