import fs from 'fs';
import path from 'path';

function source(relativePath: string) {
    return fs.readFileSync(path.join(process.cwd(), ...relativePath.split('/')), 'utf8');
}

describe('public release UI accessibility contracts', () => {
    it('uses real focusable links instead of clickable ticket table rows', () => {
        for (const relativePath of [
            'src/app/(dashboard)/dashboard/page.tsx',
            'src/app/(dashboard)/queue/page.tsx',
            'src/app/(dashboard)/tickets/page.tsx',
        ]) {
            const contents = source(relativePath);
            expect(contents).not.toMatch(/<tr[^>]+(?:onClick|cursor-pointer)/);
            expect(contents).toContain('focus-visible:ring-2');
            expect(contents).toContain('href={`/tickets/${ticket.id}`}');
        }
    });

    it('respects reduced motion and exposes labelled mobile navigation controls', () => {
        const css = source('src/app/globals.css');
        const shell = source('src/components/layout/app-shell.tsx');
        expect(css).toContain('@media (prefers-reduced-motion: reduce)');
        expect(css).toContain('transition-duration: 0.001ms !important');
        expect(shell).toContain("aria-label={t('Open menu')}");
        expect(shell).toContain("aria-label={t(collapsed ? 'Expand sidebar' : 'Collapse sidebar')}");
    });

    it('renders actionable SMTP diagnostic details and never claims final delivery', () => {
        const settings = source('src/app/(dashboard)/admin/settings/page.tsx');
        expect(settings).toContain('Accepted recipients:');
        expect(settings).toContain('Rejected recipients:');
        expect(settings).toContain('Message ID:');
        expect(settings).toContain('it cannot prove final mailbox delivery');
    });
});