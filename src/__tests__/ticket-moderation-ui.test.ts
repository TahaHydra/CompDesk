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
        expect(ticketPage).toContain('will be permanently deleted and cannot be recovered');
    });

    it('stacks the Tags label above a full-width picker like the other action fields', () => {
        expect(ticketPage).toMatch(/htmlFor="ticket-tags" className="block /);
        expect(ticketPage).toMatch(/<TagPicker id="ticket-tags" className="w-full"/);
        expect(read('src/components/tags/tag-picker.tsx')).toContain("cn('h-9 justify-between gap-2 font-normal', className)");
    });
});
