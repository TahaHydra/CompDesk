import fs from 'node:fs';
import path from 'node:path';
import {
    ADMIN_USER_SELECT,
    assertApiResponseSafe,
    findForbiddenApiResponseKey,
    toPublicRequesterDto,
    toStaffUserDto,
} from '@/lib/api-dto';

describe('central API DTO security', () => {
    it('recursively rejects forbidden keys at any depth', () => {
        for (const key of [
            'passwordHash', 'password_hash', 'access_token', 'refresh_token', 'id_token',
            'sessionToken', 'session_token', 'keyHash', 'key_hash', 'smtp_password',
            'azure_ad_client_secret', 'webhook_secret', 'encryption_key',
        ]) {
            expect(findForbiddenApiResponseKey({ ticket: { requester: [{ profile: { [key]: 'secret' } }] } })).toBe(key);
        }
        expect(() => assertApiResponseSafe({ user: { passwordHash: 'secret' } })).toThrow('passwordHash');
        expect(assertApiResponseSafe({ user: { id: 'safe', email: 'user@example.com' } })).toEqual({
            user: { id: 'safe', email: 'user@example.com' },
        });
    });

    it('serializes requester and staff users by explicit allowlist', () => {
        const raw = {
            id: 'user-1', name: 'User', email: 'user@example.com', image: null,
            role: 'AGENT' as const, isActive: true, passwordHash: 'must-not-escape',
        };
        expect(toPublicRequesterDto(raw)).toEqual({
            id: 'user-1', name: 'User', email: 'user@example.com', image: null,
        });
        expect(toStaffUserDto(raw)).toEqual({
            id: 'user-1', name: 'User', email: 'user@example.com', image: null,
            role: 'AGENT', isActive: true,
        });
    });

    it('keeps administrative selectors free of authentication secrets', () => {
        expect(ADMIN_USER_SELECT).not.toHaveProperty('passwordHash');
        expect(ADMIN_USER_SELECT).not.toHaveProperty('accounts');
        expect(ADMIN_USER_SELECT).not.toHaveProperty('sessions');
    });

    it('forbids raw secret-bearing relation includes in API and ticket services', () => {
        const roots = [
            path.join(process.cwd(), 'src', 'app', 'api'),
            path.join(process.cwd(), 'src', 'lib', 'tickets'),
        ];
        const files: string[] = [];
        const visit = (directory: string) => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const target = path.join(directory, entry.name);
                if (entry.isDirectory()) visit(target);
                else if (entry.name.endsWith('.ts')) files.push(target);
            }
        };
        roots.forEach(visit);
        for (const file of files) {
            const source = fs.readFileSync(file, 'utf8');
            expect(source).not.toMatch(/\b(?:requester|user|escalatedTo):\s*true\b/);
            expect(source).not.toMatch(/\b(?:accounts|sessions):\s*true\b/);
        }
    });
});
