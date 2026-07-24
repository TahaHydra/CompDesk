import { dashboardLinksSchema, parseDashboardLinks } from '@/lib/dashboard-links';
import { normalizeLanguage, translate } from '@/lib/i18n';
import { helpArticleInputSchema, helpCollectionInputSchema } from '@/lib/help-center';

const collectionId = '550e8400-e29b-41d4-a716-446655440000';

describe('language and help-center domain rules', () => {
    it('normalizes unsupported language values to English and translates French labels', () => {
        expect(normalizeLanguage('fr')).toBe('fr');
        expect(normalizeLanguage('de')).toBe('en');
        expect(translate('fr', 'New Ticket')).toBe('Nouveau ticket');
        expect(translate('fr', 'A snapshot of activity across {name}', { name: 'CompDesk' })).toContain('CompDesk');
    });

    it('requires safe slugs and complete bilingual help content', () => {
        expect(helpCollectionInputSchema.safeParse({
            slug: 'getting-started', titleEn: 'Getting started', titleFr: 'Bien démarrer',
            icon: 'book', sortOrder: 10, isPublished: true,
        }).success).toBe(true);
        expect(helpCollectionInputSchema.safeParse({
            slug: '../private', titleEn: 'Getting started', titleFr: 'Bien démarrer',
        }).success).toBe(false);
        expect(helpArticleInputSchema.safeParse({
            collectionId, slug: 'create-a-ticket', titleEn: 'Create a ticket', titleFr: 'Créer un ticket',
            contentEn: '## Instructions\n\nCreate a clear support request.',
            contentFr: '## Instructions\n\nCréez une demande claire.',
            sortOrder: 10, isPublished: true,
        }).success).toBe(true);
    });
});

describe('dashboard quick-link validation', () => {
    it('accepts uploaded icons and applies an empty icon default', () => {
        const result = dashboardLinksSchema.safeParse([
            { title: 'Intranet', url: 'https://intranet.example.com' },
            { title: 'HR', url: 'https://hr.example.com', iconUrl: '/uploads/quick-links/123e4567-e89b-12d3-a456-426614174000.png' },
        ]);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data[0].iconUrl).toBe('');
    });

    it('rejects script URLs, SVGs, traversal, and excessive links', () => {
        expect(dashboardLinksSchema.safeParse([{ title: 'Bad', url: 'javascript:alert(1)' }]).success).toBe(false);
        expect(dashboardLinksSchema.safeParse([{ title: 'Bad', url: 'https://example.com', iconUrl: '/uploads/quick-links/logo.svg' }]).success).toBe(false);
        expect(dashboardLinksSchema.safeParse([{ title: 'Bad', url: 'https://example.com', iconUrl: '/uploads/quick-links/../logo.png' }]).success).toBe(false);
        expect(dashboardLinksSchema.safeParse(Array.from({ length: 17 }, (_, index) => ({ title: `Link ${index}`, url: `https://example.com/${index}` }))).success).toBe(false);
    });

    it('fails closed when stored JSON is malformed', () => {
        expect(parseDashboardLinks('{broken')).toEqual([]);
    });
});