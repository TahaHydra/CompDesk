import { readFileSync } from 'fs';
import path from 'path';
import { formatSmtpError } from '@/lib/email';

const read = (...segments: string[]) => readFileSync(path.join(process.cwd(), ...segments), 'utf8');

describe('settings control wiring', () => {
    it('uses the dedicated new-comment preference for public comment email', () => {
        const comments = read('src', 'app', 'api', 'tickets', '[id]', 'comments', 'route.ts');
        const email = read('src', 'lib', 'email.ts');
        expect(comments).toContain('sendNewCommentEmail');
        expect(email).toContain("isEmailEventEnabled('email_on_new_comment')");
    });

    it('serves runtime uploaded images through an application route', () => {
        const route = read('src', 'app', 'uploads', '[folder]', '[filename]', 'route.ts');
        expect(route).toContain('resolveUploadRoots()');
        expect(route).toContain("'Cache-Control': 'public, max-age=31536000, immutable'");
    });

    it('does not present hard-coded security status claims', () => {
        const settings = read('src', 'app', '(dashboard)', 'admin', 'settings', 'page.tsx');
        expect(settings).not.toContain('CSP Headers: Active');
        expect(settings).not.toContain('Rate Limiting: Active');
        expect(settings).toContain('azure_ad_runtime_configured');
    });

    it('explains operating-system SMTP connection denials', () => {
        const error = Object.assign(new Error('connect EACCES'), { code: 'EACCES' });
        expect(formatSmtpError(error, { host: 'smtp.example.com', port: 465 })).toContain('operating system or container network policy');
        expect(formatSmtpError(error, { host: 'smtp.example.com', port: 465 })).toContain('smtp.example.com:465');
    });
});
