import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { translate } from '@/lib/i18n';
import type { UpdateState } from '@/lib/updates';

let mockLanguage: 'en' | 'fr' = 'en';
jest.mock('@/components/providers/language-provider', () => ({ useLanguage: () => ({ language: mockLanguage, t: (key: string, values?: Record<string, string | number>) => translate(mockLanguage, key, values) }) }));
import { UpdateFooter, UpdateDetails } from '@/components/layout/update-dialog';
import { AboutContent } from '@/components/layout/about-dialog';

const state: UpdateState = {
    installed: '0.9.3', automatic: true, lastChecked: '2026-10-01T12:00:00Z', checkStatus: 'ok', stale: false, refreshLimited: false,
    manifest: { latest: '0.9.4', severity: 'normal', release_url: 'https://github.com/TahaHydra/CompDesk/releases/tag/v0.9.4', summary: 'Small fixes' },
};
const noop = () => undefined;
const footer = (role: string, dismissed: string | null = null, value = state, sidebarCollapsed = false) => renderToStaticMarkup(React.createElement(UpdateFooter, {
    role, version: '0.9.3', state: value, dismissed, sidebarCollapsed, onOpen: noop, onDismiss: noop, onRestore: noop,
}));
const about = (role: string) => renderToStaticMarkup(React.createElement(AboutContent, { role, version: '0.9.3', updateState: state, onOpenUpdates: noop }));

beforeEach(() => { mockLanguage = 'en'; });
describe('administrator update and services UI', () => {
    it.each(['USER', 'AGENT'])('renders neither update controls nor services for %s', (role) => {
        expect(footer(role)).not.toContain('Update available');
        expect(footer(role)).not.toContain('Hide update notification');
        const html = about(role);
        expect(html).not.toContain('CompDesk services');
        expect(html).not.toContain('https://xhydra.fr/compdesk');
        expect(html).not.toContain('Update status');
    });
    it.each(['ADMIN', 'SUPER_ADMIN'])('renders the shared update trigger and services for %s', (role) => {
        expect(footer(role)).toContain('Update available');
        expect(footer(role)).toContain('bg-blue-500');
        const html = about(role);
        expect(html).toContain('CompDesk services');
        expect(html).toContain('href="https://xhydra.fr/compdesk"');
        expect(html).toContain('href="mailto:compdesk@xhydra.fr"');
        expect(html).toContain('v0.9.4 available');
        expect(html).not.toContain('€');
    });
    it('keeps the red indicator with a collapsed critical warning, including in the narrow rail', () => {
        const critical: UpdateState = { ...state, manifest: { ...state.manifest!, severity: 'critical' } };
        for (const rail of [false, true]) {
            const html = footer('ADMIN', '0.9.4', critical, rail);
            expect(html).toContain('bg-red-500');
            expect(html).toContain('Show update notification');
            expect(html).not.toContain('Hide update notification');
        }
    });
    it('renders normal collapsed release as a dot and shows a newly released version', () => {
        expect(footer('ADMIN', '0.9.4')).toContain('Show update notification');
        expect(footer('ADMIN', '0.9.4')).not.toContain('Hide update notification');
        expect(footer('ADMIN', '0.9.4', { ...state, manifest: { ...state.manifest!, latest: '0.9.5' } })).toContain('Hide update notification');
    });
    it('does not warn for the same version', () => {
        expect(footer('ADMIN', null, { ...state, manifest: { ...state.manifest!, latest: '0.9.3' } })).not.toContain('bg-blue-500');
    });
    it.each(['ADMIN', 'SUPER_ADMIN'])('renders privileged instructions accurately for %s', (role) => {
        const html = renderToStaticMarkup(React.createElement(UpdateDetails, { role, state, health: undefined, instructions: undefined, busy: false, message: null, onCheck: noop, onInstructions: noop, onCopy: noop }));
        if (role === 'ADMIN') {
            expect(html).toMatch(/disabled=""[^>]*>Update instructions/);
            expect(html).toContain('Super Admin privileges required');
        } else {
            expect(html).not.toContain('Super Admin privileges required');
            expect(html).toContain('Update instructions');
        }
        expect(html).toContain('No managed recovery point available');
        expect(html).not.toContain('Rollback');
    });
    it('translates new administrator UI into French', () => {
        mockLanguage = 'fr';
        expect(footer('ADMIN')).toContain('Mise à jour disponible');
        const html = about('ADMIN');
        expect(html).toContain('Services CompDesk');
        expect(html).toContain('Contacter XHydra');
        expect(html).toContain('En savoir plus');
        expect(html).toContain('v0.9.4 disponible');
    });
});
