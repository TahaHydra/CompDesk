import fs from 'node:fs';
import path from 'node:path';
import { compareVersions, parseUpdateManifest } from '@/lib/updates';
import { APP_VERSION } from '@/lib/version';
import {
    announceManifest,
    announceReadme,
    currentReleaseMigration,
    latestMigration,
    releaseIntro,
    releaseNotePath,
    setLatestReleaseMigration,
    setPackageVersion,
    upgradeNotes,
} from '../../scripts/release-version-core.mjs';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = (relative: string) => JSON.parse(read(relative));
const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const manifest = readJson('updates/manifest.json');
const staging = readJson('updates/manifest.staging.json');
const readme = read('README.md').replace(/\r\n/g, '\n');
const rehearsal = read('scripts/validate-migration-upgrade.mjs');
const migrations = fs.readdirSync(path.join(root, 'prisma', 'migrations'));

// package.json is the only place the version is typed; everything else must follow it.
describe('one release version across the repository', () => {
    it('lets the application report exactly the package version', () => {
        expect(APP_VERSION).toBe(pkg.version);
    });

    it('keeps the lockfile on the same version', () => {
        expect(lock.version).toBe(pkg.version);
        expect(lock.packages[''].version).toBe(pkg.version);
    });

    it('has release notes for the version being released', () => {
        expect(fs.existsSync(path.join(root, releaseNotePath(pkg.version)))).toBe(true);
    });

    it('never announces a version ahead of the code (announce only after publication)', () => {
        for (const file of [manifest, staging]) {
            expect(parseUpdateManifest(file)).not.toBeNull();
            expect(compareVersions(file.latest, pkg.version)).toBeLessThanOrEqual(0);
        }
    });

    it('keeps the README current release in step with the update manifest', () => {
        expect(readme).toContain(`## Current release — v${manifest.latest}\n`);
        expect(staging.latest).toBe(manifest.latest);
    });

    it('rehearses upgrades from a migration that exists', () => {
        expect(migrations).toContain(currentReleaseMigration(rehearsal));
    });
});

describe('release:prepare and release:announce', () => {
    it('sets the version in package.json and both lockfile entries', () => {
        const next = setPackageVersion(pkg, lock, '0.9.0-beta.7');
        expect(next.pkg.version).toBe('0.9.0-beta.7');
        expect(next.lock.version).toBe('0.9.0-beta.7');
        expect(next.lock.packages[''].version).toBe('0.9.0-beta.7');
        expect(next.lock.packages[''].dependencies).toEqual(lock.packages[''].dependencies);
        expect(() => setPackageVersion(pkg, lock, 'v1.0.0')).toThrow();
    });

    it('takes the summary from the first paragraph of the release note', () => {
        expect(releaseIntro('# Title (draft)\n\nFirst line\nwraps here.\n\n## Changes\n\nMore')).toBe('First line wraps here.');
        expect(releaseIntro(read(releaseNotePath(pkg.version))).length).toBeGreaterThan(20);
    });

    it('produces manifests the update checker accepts', () => {
        const summary = releaseIntro(read(releaseNotePath(pkg.version)));
        const announced = announceManifest(manifest, { version: '0.9.0-beta.7', publishedAt: '2026-12-01T10:00:00Z', summary, hasMigrations: true });
        expect(parseUpdateManifest(announced)).toMatchObject({ latest: '0.9.0-beta.7', release_url: 'https://github.com/TahaHydra/CompDesk/releases/tag/v0.9.0-beta.7' });
        expect(announced.upgrade_notes).toBe(upgradeNotes(true));
        const announcedStaging = announceManifest(staging, { version: '0.9.0-beta.7', publishedAt: '2026-12-01T10:00:00Z', summary, hasMigrations: true, staging: true });
        expect(announcedStaging.upgrade_notes).toBe(staging.upgrade_notes);
    });

    it('rewrites the README current release and keeps the previous one in the list', () => {
        const next = announceReadme(readme, { version: '0.9.0-beta.7', previousVersion: manifest.latest, summary: 'New summary.' });
        expect(next).toContain('## Current release — v0.9.0-beta.7\n');
        expect(next).toContain('New summary.\n\n<details>');
        expect(next).toContain(`- [v${manifest.latest}](https://github.com/TahaHydra/CompDesk/releases/tag/v${manifest.latest})`);
        expect(next.split('## Current release').length).toBe(2);
    });

    it('moves the upgrade-rehearsal boundary to the newest migration', () => {
        const newest = latestMigration(migrations);
        expect(currentReleaseMigration(setLatestReleaseMigration(rehearsal, newest, '0.9.0-beta.7'))).toBe(newest);
    });
});
