import { readFileSync } from 'fs';
import path from 'path';
import { dashboardLinksSchema, parseDashboardLinks } from '@/lib/dashboard-links';
import { normalizeLanguage, translate } from '@/lib/i18n';
import { helpArticleInputSchema, helpCollectionInputSchema, helpContentLanguages, localizedHelpFields } from '@/lib/help-center';
import { resolveArticleLink } from '@/lib/help-article-links';
import { isUploadedImageUrl } from '@/lib/uploaded-image-url';

const collectionId = '550e8400-e29b-41d4-a716-446655440000';

describe('language and help-center domain rules', () => {
    it('normalizes unsupported language values to English and translates French labels', () => {
        expect(normalizeLanguage('fr')).toBe('fr');
        expect(normalizeLanguage('de')).toBe('en');
        expect(translate('fr', 'New Ticket')).toBe('Nouveau ticket');
        expect(translate('fr', 'A snapshot of activity across {name}', { name: 'CompDesk' })).toContain('CompDesk');
    });

    it('accepts English-only, French-only, and bilingual help content', () => {
        expect(helpCollectionInputSchema.safeParse({
            slug: 'getting-started', titleEn: 'Getting started', titleFr: 'Bien démarrer',
            icon: 'book', sortOrder: 10, isPublished: true,
        }).success).toBe(true);
        expect(helpCollectionInputSchema.safeParse({
            slug: 'english-only', titleEn: 'English only', titleFr: '',
            icon: 'book', sortOrder: 10, isPublished: true,
        }).success).toBe(true);
        expect(helpCollectionInputSchema.safeParse({
            slug: 'francais', titleEn: '', titleFr: 'Français uniquement',
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
        expect(helpArticleInputSchema.safeParse({
            collectionId, slug: 'english-only', titleEn: 'English article', titleFr: '',
            contentEn: '## Instructions\n\nComplete instructions in English.', contentFr: '',
            sortOrder: 10, isPublished: true,
        }).success).toBe(true);
        expect(helpArticleInputSchema.safeParse({
            collectionId, slug: 'francais', titleEn: '', titleFr: 'Article français',
            contentEn: '', contentFr: '## Instructions\n\nInstructions complètes en français.',
            sortOrder: 10, isPublished: true,
        }).success).toBe(true);
    });

    it('rejects absent and partial language variants', () => {
        expect(helpCollectionInputSchema.safeParse({ slug: 'empty', titleEn: '', titleFr: '' }).success).toBe(false);
        expect(helpArticleInputSchema.safeParse({
            collectionId, slug: 'partial', titleEn: 'Partial article', titleFr: '',
            contentEn: '', contentFr: '', sortOrder: 0, isPublished: true,
        }).success).toBe(false);
        expect(helpArticleInputSchema.safeParse({
            collectionId, slug: 'partial-fr', titleEn: '', titleFr: '',
            contentEn: '', contentFr: '## Contenu\n\nDu contenu sans titre français.', sortOrder: 0, isPublished: true,
        }).success).toBe(false);
    });

    it('falls back to the available help translation', () => {
        expect(localizedHelpFields({
            titleEn: 'English title', titleFr: '', descriptionEn: 'English description', descriptionFr: '',
            contentEn: 'English content', contentFr: '',
        }, 'fr')).toEqual(expect.objectContaining({ title: 'English title', description: 'English description', content: 'English content' }));
        expect(localizedHelpFields({
            titleEn: '', titleFr: 'Titre français', descriptionEn: '', descriptionFr: 'Description française',
            contentEn: '', contentFr: 'Contenu français',
        }, 'en')).toEqual(expect.objectContaining({ title: 'Titre français', description: 'Description française', content: 'Contenu français' }));
        expect(helpContentLanguages({ titleEn: '', titleFr: '' }, 'fr')).toEqual(['fr']);
        expect(helpContentLanguages({ titleEn: 'English', titleFr: '' }, 'fr')).toEqual(['en']);
        expect(helpContentLanguages({ titleEn: 'English', titleFr: 'Français' }, 'en')).toEqual(['en', 'fr']);
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

    it('requires a literal extension separator in uploaded image URLs', () => {
        const uuid = '123e4567-e89b-12d3-a456-426614174000';
        expect(isUploadedImageUrl(`/uploads/quick-links/${uuid}.png`, 'quick-links')).toBe(true);
        expect(isUploadedImageUrl(`/uploads/quick-links/${uuid}xpng`, 'quick-links')).toBe(false);
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

    it('allows only local paths and credential-free HTTPS help links', () => {
        expect(resolveArticleLink('/help/article')).toEqual({ href: '/help/article', external: false });
        expect(resolveArticleLink('https://docs.example.com/guide')).toEqual({ href: 'https://docs.example.com/guide', external: true });
        expect(resolveArticleLink('//evil.example/path')).toBeNull();
        expect(resolveArticleLink('/\\evil.example/path')).toBeNull();
        expect(resolveArticleLink('https://user:secret@docs.example.com')).toBeNull();
        expect(resolveArticleLink('javascript:alert(1)')).toBeNull();
        expect(resolveArticleLink('data:text/html,bad')).toBeNull();
    });
});

describe('language provider boundaries', () => {
    it('wraps unauthenticated routes before the sign-in theme toggle renders', () => {
        const rootLayout = readFileSync(path.join(process.cwd(), 'src', 'app', 'layout.tsx'), 'utf8');
        const signInPage = readFileSync(path.join(process.cwd(), 'src', 'app', 'auth', 'signin', 'page.tsx'), 'utf8');
        expect(signInPage).toContain('<ThemeToggle />');
        expect(rootLayout).toContain('<LanguageProvider initialLanguage="en">');
        expect(rootLayout.indexOf('<LanguageProvider initialLanguage="en">')).toBeLessThan(rootLayout.indexOf('{children}'));
    });
});
