import fs from 'fs';
import path from 'path';

const destructiveUiFiles = [
    'src/app/(dashboard)/tickets/[id]/page.tsx',
    'src/app/(dashboard)/admin/categories/page.tsx',
    'src/app/(dashboard)/admin/departments/page.tsx',
    'src/app/(dashboard)/admin/settings/page.tsx',
    'src/app/(dashboard)/admin/tags/page.tsx',
    'src/app/(dashboard)/admin/templates/page.tsx',
    'src/components/admin/branding-settings.tsx',
    'src/components/admin/help-center-manager.tsx',
];

function source(relativePath: string): string {
    return fs.readFileSync(path.join(process.cwd(), ...relativePath.split('/')), 'utf8');
}

describe('destructive action confirmation contract', () => {
    it.each(destructiveUiFiles)('%s uses the shared confirmation dialog', (file) => {
        const content = source(file);
        expect(content).toContain('ConfirmDestructiveAction');
        expect(content).not.toMatch(/(?:window\.)?confirm\([^)]*(?:delete|remove)/i);
    });

    it('requires an explicit affirmative label for shared destructive actions', () => {
        const confirmation = source('src/components/ui/confirm-destructive-action.tsx');
        expect(confirmation).toContain("confirmLabel = 'Yes, delete'");
        expect(confirmation).toContain('<AlertDialogCancel');
    });

    it('keeps user deletion behind an explicit alert dialog', () => {
        const users = source('src/app/(dashboard)/admin/users/page.tsx');
        expect(users).toContain('<AlertDialog open={!!deleteUser}');
        expect(users).toContain("'Yes, deactivate'");
        expect(users).toContain('existing sessions will be revoked');
    });

    it('uses the centralized hard-delete permission in both API and UI', () => {
        const route = source('src/app/api/tickets/[id]/route.ts');
        const page = source('src/app/(dashboard)/tickets/[id]/page.tsx');
        expect(route).toContain('canDeleteTicket(session.user.id, session.user.role, { requesterId: ticket.requesterId, assignmentCount: ticket._count.assignments })');
        expect(page).toContain("session?.user?.role === 'SUPER_ADMIN' || (isRequester && assignments.length === 0)");
    });
});
