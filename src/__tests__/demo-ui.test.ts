import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { translate } from '@/lib/i18n';

let mockRole = 'SUPER_ADMIN';
let mockLanguage: 'en' | 'fr' = 'en';
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'owner', role: mockRole } } }) }));
jest.mock('@/components/providers/language-provider', () => ({ useLanguage: () => ({ language: mockLanguage, t: (key: string) => translate(mockLanguage, key) }) }));
import { DemoSettings } from '@/components/admin/demo-settings';

function render() {
    const client = new QueryClient();
    client.setQueryData(['demo-data'], { installed: true, managed: true, accounts: 6, tickets: 5, installedAt: null });
    const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client }, React.createElement(DemoSettings)));
    client.clear();
    return html;
}
beforeEach(() => { mockRole = 'SUPER_ADMIN'; mockLanguage = 'en'; });
it.each(['USER', 'AGENT', 'ADMIN'])('does not expose demo management to %s', (role) => {
    mockRole = role;
    expect(render()).toBe('');
});
it('shows counts and confirmed management controls to Super Admin', () => {
    const html = render();
    expect(html).toContain('Demo accounts');
    expect(html).toContain('Show demo account information');
    expect(html).toContain('Example tickets');
    expect(html).toContain('Install demo data');
    expect(html).toContain('Delete demo data');
    expect(html).not.toContain('Rollback');
    expect(html).not.toContain('Password:');
});
it('renders French demo management consistently', () => {
    mockLanguage = 'fr';
    const html = render();
    expect(html).toContain('Données de démonstration');
    expect(html).toContain('Installer les données de démonstration');
    expect(html).toContain('Supprimer les données de démonstration');
    expect(html).toContain('Comptes de démonstration');
});
