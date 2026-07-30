import fs from 'fs';
import path from 'path';
import { ROLE_PERMISSION_MATRIX } from '@/lib/role-permission-matrix';

function source(relativePath: string) { return fs.readFileSync(path.join(process.cwd(), ...relativePath.split('/')), 'utf8'); }

describe('central role permission matrix', () => {
    it('documents department ADMIN as scoped and SUPER_ADMIN as global', () => {
        expect(ROLE_PERMISSION_MATRIX.ADMIN.ticketScope).toBe('administered_or_assigned_departments');
        expect(ROLE_PERMISSION_MATRIX.ADMIN.globalSettings).toBe(false);
        expect(ROLE_PERMISSION_MATRIX.ADMIN.permanentTicketDeletion).toBe(false);
        expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN.ticketScope).toBe('global');
        expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN.globalSettings).toBe(true);
        expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN.permanentTicketDeletion).toBe(true);
        expect(source('docs/PERMISSIONS.md')).toContain('“ADMIN” never means global access');
    });

    it('stays aligned with centralized ticket and queue authorization', () => {
        const permissions = source('src/lib/permissions.ts');
        expect(permissions).toContain("if (role === 'SUPER_ADMIN') return null");
        expect(permissions).toContain("if (role === 'ADMIN')");
        expect(permissions).toContain('getAdministeredQueueIds(userId)');
        expect(permissions).toContain("if (role === 'USER') return ticket.requesterId === userId");
        expect(permissions).toContain("if (role === 'SUPER_ADMIN') return true");
    });
});