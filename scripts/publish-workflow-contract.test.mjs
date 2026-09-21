import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// Plain string/regex checks against the workflow YAML — matching the same
// convention scripts/docker-infrastructure.test.mjs already uses for
// Dockerfile/Compose contracts — rather than pulling in a YAML parser as a
// new dependency (js-yaml is only ever an incidental transitive dependency
// today, not something this repo can rely on staying resolvable).
const source = fs.readFileSync(path.join(process.cwd(), '.github', 'workflows', 'publish-image.yml'), 'utf8').replace(/\r\n/g, '\n');

function countOccurrences(text, pattern) {
    return (text.match(new RegExp(pattern, 'g')) || []).length;
}

test('the image is built exactly once: a single docker/build-push-action step in the publish job', () => {
    assert.equal(countOccurrences(source, 'uses: docker/build-push-action'), 1, 'expected exactly one build/push action invocation');
    assert.match(source, /uses: docker\/build-push-action@[^\s]+[\s\S]*?push: true/, 'the one build step must push so its digest is scannable by reference');
});

test('the build step does not push directly to a release tag (version, commit-SHA, or latest)', () => {
    const buildStepMatch = /id: build[\s\S]*?tags: (.+)\n/.exec(source);
    assert.ok(buildStepMatch, 'expected the build step to declare its tags');
    const buildTags = buildStepMatch[1];
    assert.doesNotMatch(buildTags, /compdesk:\$\{\{\s*steps\.version\.outputs\.version/, 'must not tag the initial push with the release version');
    assert.doesNotMatch(buildTags, /compdesk:sha-/, 'must not tag the initial push with the commit-SHA release tag');
    assert.doesNotMatch(buildTags, /compdesk:latest/, 'must not tag the initial push as latest');
    assert.match(buildTags, /scan-candidate/, 'the initial push should go to a non-release staging tag');
});

test('the build step has an id so its digest output can be shared with later steps', () => {
    assert.match(source, /id: build\s*\n\s*uses: docker\/build-push-action/);
});

test('the scanned artifact and the published artifact are the exact same digest', () => {
    const buildIndex = source.indexOf('id: build');
    const scanIndex = source.indexOf('aquasecurity/trivy-action');
    // Anchor on the step's unique name, not the "imagetools create" phrase
    // (which the header comment above also mentions in prose).
    const promoteIndex = source.indexOf('Promote the scanned digest', scanIndex);

    assert.ok(buildIndex >= 0, 'expected a build step');
    assert.ok(scanIndex > buildIndex, 'the scan must run after the build');
    assert.ok(promoteIndex > scanIndex, 'promotion to release tags must run after the scan, never before');

    const scanStep = source.slice(scanIndex, promoteIndex);
    const promoteStep = source.slice(promoteIndex);
    // Both steps read the exact same GitHub Actions expression
    // (steps.build.outputs.digest), so they can never diverge: whatever
    // digest the single build step actually produced is what gets scanned
    // and, later, what gets promoted — there is no second value either could
    // read instead.
    assert.match(scanStep, /image-ref:.*steps\.build\.outputs\.digest/, "the scan must reference the build step's digest output");
    assert.match(promoteStep, /steps\.build\.outputs\.digest/, 'promotion must reference the exact same digest output that was scanned');
});

test('the promotion step never rebuilds — it only invokes imagetools create, not another build-push-action', () => {
    // Search from the actual step (its unique name), not the header comment
    // above, which also mentions "imagetools create" in prose.
    const promoteStep = source.slice(source.indexOf('Promote the scanned digest'));
    assert.equal(countOccurrences(source, 'uses: docker/build-push-action'), 1, 'no second build-push-action anywhere in the workflow');
    // Word-boundary matches only: "docker buildx imagetools create" must not
    // false-positive against a bare substring match for "docker build".
    assert.doesNotMatch(promoteStep, /\bdocker build\b|\bbuildx build\b/, 'promotion must not invoke a build');
});

test('the scan enforces HIGH/CRITICAL, ignore-unfixed, and a hard exit-code gate', () => {
    const scanIndex = source.indexOf('aquasecurity/trivy-action');
    const scanStep = source.slice(scanIndex, source.indexOf('Promote the scanned digest', scanIndex));
    assert.match(scanStep, /severity: HIGH,CRITICAL/);
    assert.match(scanStep, /ignore-unfixed: true/);
    assert.match(scanStep, /exit-code: '1'/);
});

test('provenance and SBOM are requested on the one real build', () => {
    const buildStep = source.slice(source.indexOf('id: build'), source.indexOf('aquasecurity/trivy-action'));
    assert.match(buildStep, /provenance: true/);
    assert.match(buildStep, /sbom: true/);
});

test('publishing triggers only on version tags, never on branch pushes or pull requests', () => {
    const triggerSection = source.slice(source.indexOf('\non:'), source.indexOf('\npermissions:'));
    assert.doesNotMatch(triggerSection, /pull_request/, 'must never trigger on pull_request');
    assert.doesNotMatch(triggerSection, /branches:/, 'must never trigger on a branch push');
    assert.match(triggerSection, /tags:\s*\n\s*- 'v/, 'must trigger on tag patterns');
});

test('latest is only ever applied for a stable (non-prerelease) version', () => {
    const promoteStep = source.slice(source.indexOf('Promote the scanned digest'));
    assert.match(promoteStep, /steps\.version\.outputs\.stable/);
    assert.match(promoteStep, /if \[ "\$\{\{ steps\.version\.outputs\.stable \}\}" = "true" \]/);
    assert.match(promoteStep, /\$image:latest/);
});

test('the publish job requests only the minimum permissions it needs', () => {
    // Workflow-level default stays read-only; only the job itself escalates,
    // and only to what it concretely uses: packages:write to publish the
    // image, contents:write only to attach the release Compose asset (a
    // GitHub Release upload requires it — image publishing alone would not).
    assert.match(source, /^permissions:\n\s+contents: read\n/m);
    assert.match(source, /permissions:\n\s+contents: write # needed only to attach the release Compose asset below\n\s+packages: write/);
});

test('a fork cannot publish into the upstream GHCR namespace', () => {
    assert.match(source, /if: github\.repository == 'TahaHydra\/CompDesk'/);
});

test('the release Compose asset is generated and attached only after the image is promoted, using the exact same version', () => {
    // Header comment prose also mentions the script name and gh command —
    // search only from the actual promotion step onward for the real steps.
    const promoteIndex = source.indexOf('Promote the scanned digest');
    const generateIndex = source.indexOf('generate-release-compose.mjs', promoteIndex);
    const attachIndex = source.indexOf('gh release upload', promoteIndex);
    assert.ok(promoteIndex > 0 && generateIndex > promoteIndex && attachIndex > generateIndex, 'generate and attach must run after promotion, in that order');
    assert.match(source, /generate-release-compose\.mjs "\$\{\{ steps\.version\.outputs\.version \}\}"/, 'the release asset must be pinned to the same resolved version as the published image');
    // A missing GitHub Release must not fail the whole (already-succeeded) publish job.
    assert.match(source, /gh release view.*&&|if gh release view/s);
});
