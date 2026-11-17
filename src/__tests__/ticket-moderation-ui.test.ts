import fs from 'node:fs';
import path from 'node:path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const ticketPage = read('src/app/(dashboard)/tickets/[id]/page.tsx');

describe('ticket page moderation and tag layout contract', () => {
    it('takes edit/delete rights from the server instead of the global role', () => {
        expect(ticketPage).toContain('event.permissions?.canEdit');
        expect(ticketPage).toContain('event.permissions?.canDelete');
        expect(ticketPage).not.toMatch(/isAdministrator/);
    });

    it('only offers attachment removal the server allows', () => {
        expect(ticketPage).toContain('att.canDelete ?');
    });

    it('describes deletion honestly', () => {
        expect(ticketPage).not.toContain('authorized administrators');
        expect(ticketPage).not.toContain('Removed · history retained');
        expect(ticketPage).toContain('Super Admins can still read the original text');
        expect(ticketPage).toContain('will be deleted from CompDesk');
        expect(ticketPage).toContain('copies may remain in your backups');
    });

    it('keeps a gap between every Details label and its value, even when the value wraps', () => {
        const details = ticketPage.slice(ticketPage.indexOf('{t("Details")}'), ticketPage.indexOf('</CardContent>', ticketPage.indexOf('{t("Details")}')));
        expect(details).not.toContain('className="flex justify-between text-sm"');
        expect(details).toContain('<span className="shrink-0 text-muted-foreground">{t("Category")}</span>');
    });

    it('stacks the Tags label above a full-width picker like the other action fields', () => {
        expect(ticketPage).toMatch(/htmlFor="ticket-tags" className="block /);
        expect(ticketPage).toMatch(/<TagPicker id="ticket-tags" className="w-full"/);
        expect(read('src/components/tags/tag-picker.tsx')).toContain("cn('h-9 justify-between gap-2 font-normal', className)");
    });

    it('never shows a cached person card: contact details are fetched again on every opening', () => {
        const card = read('src/components/people/person-name.tsx');
        expect(card).toContain('gcTime: 0');
        expect(card).toContain("refetchOnMount: 'always'");
    });
});
