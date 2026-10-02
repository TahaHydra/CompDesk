import { compareVersions, parseUpdateManifest, updatePresentation, dismissalKey } from '@/lib/updates';

const manifest = { latest: '0.9.4', severity: 'normal', release_url: 'https://github.com/TahaHydra/CompDesk/releases/tag/v0.9.4', published_at: '2026-09-29T12:00:00Z', summary: 'Fixes and improvements.' };

describe('release metadata and version precedence', () => {
    it.each([
        ['0.9.4', '0.9.4', 0], ['0.9.4', '0.9.3', 1], ['0.9.3', '0.9.4', -1],
        ['0.9.0', '0.9.0-beta.2', 1], ['0.9.0-beta.10', '0.9.0-beta.2', 1],
        ['0.9.0-beta.2', '0.9.0-beta.2+build.4', 0], ['0.9.0-alpha', '0.9.0-beta', -1],
        ['0.9.0-1', '0.9.0-alpha', -1], ['1.0.0', '0.99.99', 1],
    ])('compares %s against %s', (a, b, expected) => expect(compareVersions(a, b)).toBe(expected));

    it.each([null, {}, { ...manifest, latest: 'garbage' }, { ...manifest, latest: '01.9.4' },
        { ...manifest, latest: '0.9.4-beta.01' }, { ...manifest, severity: 'urgent' },
        { ...manifest, release_url: 'javascript:alert(1)' }, { ...manifest, release_url: 'https://user:secret@example.com' },
        { ...manifest, published_at: 'yesterday' }, { ...manifest, minimum_supported: 'oops' },
        { ...manifest, summary: 'x'.repeat(2001) },
    ])('rejects malformed or unsafe manifests', (input) => expect(parseUpdateManifest(input)).toBeNull());

    it('uses explicit severity and retains supported-version metadata', () => {
        expect(parseUpdateManifest({ ...manifest, severity: 'critical', minimum_supported: '0.9.0-beta.2' }))
            .toMatchObject({ severity: 'critical', minimum_supported: '0.9.0-beta.2' });
    });
});

describe('per-user and per-release update visibility', () => {
    const normal = parseUpdateManifest(manifest)!;
    it.each(['USER', 'AGENT'])('does not offer controls to %s', (role) => {
        expect(updatePresentation(role, '0.9.3', normal, null)).toEqual({ visible: false, expanded: false, tone: null, privileged: false });
    });
    it.each(['ADMIN', 'SUPER_ADMIN'])('shows normal blue updates to %s', (role) => {
        expect(updatePresentation(role, '0.9.3', normal, null)).toMatchObject({ visible: true, expanded: true, tone: 'blue' });
    });
    it('does not warn when installed is equal or newer', () => {
        expect(updatePresentation('ADMIN', '0.9.4', normal, null).visible).toBe(false);
        expect(updatePresentation('ADMIN', '1.0.0', normal, null).visible).toBe(false);
    });
    it('keeps an indicator after a release is collapsed and expands the next release', () => {
        expect(updatePresentation('ADMIN', '0.9.3', normal, '0.9.4')).toMatchObject({ visible: true, expanded: false, tone: 'blue' });
        expect(updatePresentation('ADMIN', '0.9.3', { ...normal, latest: '0.9.5' }, '0.9.4').expanded).toBe(true);
    });
    it('isolates users in persistent dismissal storage', () => {
        const storage = new Map([[dismissalKey('alice'), '0.9.4']]);
        expect(updatePresentation('ADMIN', '0.9.3', normal, storage.get(dismissalKey('alice')) ?? null).expanded).toBe(false);
        expect(updatePresentation('ADMIN', '0.9.3', normal, storage.get(dismissalKey('bob')) ?? null).expanded).toBe(true);
    });
    it('never removes the red indicator for a collapsed critical release', () => {
        expect(updatePresentation('ADMIN', '0.9.3', { ...normal, severity: 'critical' }, '0.9.4'))
            .toMatchObject({ visible: true, expanded: false, tone: 'red' });
    });
    it('only grants privileged instructions to Super Admin', () => {
        expect(updatePresentation('ADMIN', '0.9.3', normal, null).privileged).toBe(false);
        expect(updatePresentation('SUPER_ADMIN', '0.9.3', normal, null).privileged).toBe(true);
    });
});
