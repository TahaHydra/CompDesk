// Pure helpers for scripts/release-version.mjs (no file access), kept separate so tests can import them.

export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const RELEASES_URL = 'https://github.com/TahaHydra/CompDesk/releases/tag';
const MIGRATION_CONSTANT = /const LATEST_RELEASE_MIGRATION = '([^']+)';(?: \/\/ [^\n]*)?/;
const SUMMARY_MAX = 2000;

export function assertVersion(version) {
    if (!SEMVER.test(version || '')) throw new Error(`"${version}" is not a version like 0.9.0-beta.7 (no leading "v").`);
}

export function releaseNotePath(version) {
    return `docs/releases/v${version}.md`;
}

/** Sets the version in package.json and in both places package-lock.json records it. */
export function setPackageVersion(pkg, lock, version) {
    assertVersion(version);
    const nextLock = { ...lock, version, packages: { ...lock.packages, '': { ...lock.packages?.[''], version } } };
    return { pkg: { ...pkg, version }, lock: nextLock };
}

export function releaseNoteTemplate(version) {
    return `# CompDesk v${version} — Public Beta (draft)

One paragraph saying what this release brings. It becomes the README summary and the in-app update summary.

## Changes

## API changes

## Upgrade and rollback

## Verification

## Publication checks

To be completed when the release is published.
`;
}

/** The first paragraph after the title: the summary shown in the README and the update dialog. */
export function releaseIntro(markdown) {
    const body = markdown.replace(/\r\n/g, '\n').split('\n').slice(1).join('\n');
    const paragraph = body.split(/\n\s*\n/).map((block) => block.trim()).find((block) => block && !block.startsWith('#'));
    if (!paragraph) throw new Error('The release note needs a summary paragraph under its title.');
    if (paragraph.length > SUMMARY_MAX) throw new Error(`The release note summary is longer than ${SUMMARY_MAX} characters.`);
    return paragraph.replace(/\s*\n\s*/g, ' ');
}

export function upgradeNotes(hasMigrations) {
    return 'Back up PostgreSQL, private attachments, uploaded branding, and the private configuration volume together. '
        + 'Use this release\'s pinned Docker Compose asset, preserve existing volumes and deployment settings, then run docker compose pull and docker compose up -d. '
        + (hasMigrations
            ? 'This release applies additive database migrations automatically on start; an older image alone is not a recovery point.'
            : 'This release has no database migrations; an older image alone is not a recovery point.');
}

/** Production manifest: every field follows the release. Staging keeps its rehearsal notes. */
export function announceManifest(manifest, { version, publishedAt, summary, hasMigrations, staging = false }) {
    return {
        ...manifest,
        latest: version,
        release_url: `${RELEASES_URL}/v${version}`,
        published_at: publishedAt,
        summary,
        ...(staging ? {} : { upgrade_notes: upgradeNotes(hasMigrations) }),
    };
}

/** Rewrites the README "Current release" section and moves the previous release into the list. */
export function announceReadme(original, { version, previousVersion, summary }) {
    const readme = original.replace(/\r\n/g, '\n');
    const current = /## Current release — v[^\n]+\n[\s\S]*?(?=\n<details>)/;
    if (!current.test(readme)) throw new Error('README has no "## Current release — v…" section followed by <details>.');
    const section = `## Current release — v${version}\n\n`
        + `[Release and installation assets](${RELEASES_URL}/v${version}) · [Changes and upgrade notes](${releaseNotePath(version)})\n\n`
        + `${summary}\n`;
    let next = readme.replace(current, section);
    const list = '<summary>Previous public betas</summary>\n\n';
    const previousEntry = `- [v${previousVersion}](${RELEASES_URL}/v${previousVersion}) — [release notes](${releaseNotePath(previousVersion)})\n`;
    if (previousVersion && next.includes(list) && !next.includes(`- [v${previousVersion}]`)) next = next.replace(list, list + previousEntry);
    return next;
}

export function latestMigration(names) {
    return [...names].filter((name) => /^\d{14}_/.test(name)).sort().at(-1);
}

export function setLatestReleaseMigration(scriptText, migration, version) {
    if (!MIGRATION_CONSTANT.test(scriptText)) throw new Error('LATEST_RELEASE_MIGRATION was not found in the rehearsal script.');
    return scriptText.replace(MIGRATION_CONSTANT, `const LATEST_RELEASE_MIGRATION = '${migration}'; // v${version}`);
}

export function currentReleaseMigration(scriptText) {
    return scriptText.match(MIGRATION_CONSTANT)?.[1] ?? null;
}

