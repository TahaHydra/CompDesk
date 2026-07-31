const mockAuth = jest.fn();

jest.mock('@/lib/auth', () => ({ auth: mockAuth }));
jest.mock('@/lib/audit', () => ({ auditLog: jest.fn() }));
jest.mock('@/lib/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { PATCH as updateBranding } from '@/app/api/branding/admin/route';
import { DEFAULT_BRANDING } from '@/lib/branding';
import { brandingConfigSchema } from '@/lib/branding-schema';
import {
    getBrandingApiFieldErrors,
    getBrandingFieldErrors,
    mergeSavedPublicBranding,
    prepareBrandingForSave,
} from '@/lib/branding-form';
import { submitCredentialsOnce } from '@/lib/signin-submission';

function source(relativePath: string): string {
    return fs.readFileSync(path.join(process.cwd(), ...relativePath.split('/')), 'utf8');
}

function autofilledFormData() {
    const formData = new FormData();
    formData.set('email', 'autofilled@example.com');
    formData.set('password', 'password-manager-secret');
    return formData;
}

describe('Phase 1 sign-in behavior', () => {
    it('submits browser-autofilled DOM values without input or change events', async () => {
        const authenticate = jest.fn().mockResolvedValue({ ok: true });
        const setPending = jest.fn();
        const lock = { current: false };

        await expect(submitCredentialsOnce({
            formData: autofilledFormData(),
            lock,
            authenticate,
            setPending,
        })).resolves.toBe('success');

        expect(authenticate).toHaveBeenCalledTimes(1);
        expect(authenticate).toHaveBeenCalledWith({
            email: 'autofilled@example.com',
            password: 'password-manager-secret',
        });
        expect(setPending).toHaveBeenCalledWith(true);
    });

    it('allows only one authentication action when Sign In is double-clicked', async () => {
        let completeAuthentication: ((result: { ok: boolean }) => void) | undefined;
        const authenticate = jest.fn(() => new Promise<{ ok: boolean }>((resolve) => {
            completeAuthentication = resolve;
        }));
        const lock = { current: false };
        const setPending = jest.fn();

        const first = submitCredentialsOnce({ formData: autofilledFormData(), lock, authenticate, setPending });
        const second = submitCredentialsOnce({ formData: autofilledFormData(), lock, authenticate, setPending });

        await expect(second).resolves.toBe('duplicate');
        expect(authenticate).toHaveBeenCalledTimes(1);
        completeAuthentication?.({ ok: true });
        await expect(first).resolves.toBe('success');
    });

    it('restores the lock and pending state when authentication throws', async () => {
        const lock = { current: false };
        const setPending = jest.fn();

        await expect(submitCredentialsOnce({
            formData: autofilledFormData(),
            lock,
            authenticate: jest.fn().mockRejectedValue(new Error('network failure')),
            setPending,
        })).resolves.toBe('failure');

        expect(lock.current).toBe(false);
        expect(setPending.mock.calls).toEqual([[true], [false]]);
    });

    it('preserves multiline login descriptions as text rather than HTML', () => {
        const signInPage = source('src/app/auth/signin/page.tsx');
        expect(signInPage).toContain('whitespace-pre-line');
        expect(signInPage).toContain('{branding.loginDescription}');
        expect(signInPage).not.toContain('dangerouslySetInnerHTML');
    });
});

describe('Phase 1 branding behavior', () => {
    it('renders query errors before the loading fallback and offers Retry', () => {
        const brandingSettings = source('src/components/admin/branding-settings.tsx');
        expect(brandingSettings.indexOf('if (query.isError)')).toBeLessThan(
            brandingSettings.indexOf('if (query.isLoading || !form)')
        );
        expect(brandingSettings).toContain("query.error instanceof Error ? query.error.message");
        expect(brandingSettings).toContain('query.refetch()');
        expect(brandingSettings).toContain("'Retry'");
    });

    it('does not block a color save when optional demo information is empty', () => {
        const prepared = prepareBrandingForSave({
            ...DEFAULT_BRANDING,
            primaryColor: '#112233',
            accentColor: '#aabbcc',
            showDemoAccounts: true,
            demoAccountInfo: '',
        });

        expect(prepared).toMatchObject({
            primaryColor: '#112233',
            accentColor: '#aabbcc',
            showDemoAccounts: false,
            demoAccountInfo: '',
        });
        expect(brandingConfigSchema.safeParse(prepared).success).toBe(true);
        expect(source('src/components/admin/branding-settings.tsx')).not.toContain('savePending || hasFieldErrors || demoInformationMissing');
    });

    it('shows field-specific errors for incomplete hex colors', () => {
        const invalid = { ...DEFAULT_BRANDING, primaryColor: '#123', accentColor: 'blue' };
        const errors = getBrandingFieldErrors(invalid);

        expect(errors.primaryColor).toContain('#RRGGBB');
        expect(errors.accentColor).toContain('#RRGGBB');
        expect(brandingConfigSchema.safeParse(invalid).success).toBe(false);
    });

    it('rejects invalid hex colors through the server branding endpoint', async () => {
        mockAuth.mockResolvedValue({ user: { id: 'super-1', role: 'SUPER_ADMIN' } });
        const response = await updateBranding(new NextRequest('http://localhost/api/branding/admin', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...DEFAULT_BRANDING, primaryColor: '#123' }),
        }));
        const payload = await response.json();

        expect(response.status).toBe(400);
        expect(payload.error).toBe('Branding validation failed');
        expect(payload.details.fieldErrors.primaryColor[0]).toContain('#RRGGBB');
    });

    it('extracts field-specific Zod errors returned by the branding API', () => {
        expect(getBrandingApiFieldErrors({
            error: 'Branding validation failed',
            details: {
                fieldErrors: {
                    applicationName: ['Application name is required'],
                    supportEmail: ['Enter a valid support email address'],
                },
            },
        })).toEqual({
            applicationName: 'Application name is required',
            supportEmail: 'Enter a valid support email address',
        });
    });

    it('refreshes cached public branding and the App Router after a successful save', () => {
        const saved = { ...DEFAULT_BRANDING, primaryColor: '#123456' };
        const publicBranding = mergeSavedPublicBranding(saved, {
            ...DEFAULT_BRANDING,
            microsoftLoginConfigured: true,
        });
        expect(publicBranding.primaryColor).toBe('#123456');
        expect(publicBranding.microsoftLoginConfigured).toBe(true);

        const brandingSettings = source('src/components/admin/branding-settings.tsx');
        expect(brandingSettings).toContain("queryClient.setQueryData<PublicBranding>(");
        expect(brandingSettings).toContain("queryClient.invalidateQueries({ queryKey: ['branding', 'public'] })");
        expect(brandingSettings).toContain('router.refresh()');
    });
});

describe('runtime branding propagation contract', () => {
    it('re-renders dynamic root branding for both login and authenticated shell without a rebuild', () => {
        const rootLayout = source('src/app/layout.tsx');
        const globals = source('src/app/globals.css');
        const signInPage = source('src/app/auth/signin/page.tsx');
        const appShell = source('src/components/layout/app-shell.tsx');

        expect(rootLayout).toContain("export const dynamic = 'force-dynamic'");
        expect(rootLayout).toContain('await getPublicBranding()');
        expect(rootLayout).toContain('style={brandStyles}');
        expect(rootLayout).toContain('<BrandingProvider branding={branding}>');
        expect(globals).toContain('--primary: var(--brand-primary');
        expect(signInPage).toContain('via-primary/5');
        expect(appShell).toContain('bg-primary/10 text-primary');
    });
});
