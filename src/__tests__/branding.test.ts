jest.mock('@/lib/prisma', () => ({ prisma: { appSetting: { findMany: jest.fn() }, $transaction: jest.fn() } }));

import {
    brandingConfigSchema,
    DEFAULT_BRANDING,
    getBrandingStyleVariables,
    normalizeBranding,
    toPublicBranding,
} from '@/lib/branding';

describe('branding configuration', () => {
    it('normalizes partial branding with safe defaults', () => {
        expect(normalizeBranding({ applicationName: 'Acme Support' })).toMatchObject({
            applicationName: 'Acme Support',
            shortApplicationName: DEFAULT_BRANDING.shortApplicationName,
        });
    });

    it('rejects traversal-like and non-uploaded asset paths', () => {
        expect(brandingConfigSchema.safeParse({ ...DEFAULT_BRANDING, mainLogoUrl: '/uploads/branding/../private.txt' }).success).toBe(false);
        expect(brandingConfigSchema.safeParse({ ...DEFAULT_BRANDING, mainLogoUrl: '/uploads/branding/logo.svg' }).success).toBe(false);
        expect(brandingConfigSchema.safeParse({ ...DEFAULT_BRANDING, mainLogoUrl: '/uploads/branding/123e4567-e89b-12d3-a456-426614174000.png' }).success).toBe(true);
    });

    it('returns only typed public branding values and no administrative secrets', () => {
        const previous = {
            id: process.env.AZURE_AD_CLIENT_ID,
            secret: process.env.AZURE_AD_CLIENT_SECRET,
            tenant: process.env.AZURE_AD_TENANT_ID,
        };
        process.env.AZURE_AD_CLIENT_ID = 'client'; process.env.AZURE_AD_CLIENT_SECRET = 'secret'; process.env.AZURE_AD_TENANT_ID = 'tenant';
        const publicBranding = toPublicBranding(DEFAULT_BRANDING);
        expect(publicBranding.microsoftLoginConfigured).toBe(true);
        const serialized = JSON.stringify(publicBranding);
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('smtp');
        expect(serialized).not.toContain('tenant');
        process.env.AZURE_AD_CLIENT_ID = previous.id;
        process.env.AZURE_AD_CLIENT_SECRET = previous.secret;
        process.env.AZURE_AD_TENANT_ID = previous.tenant;
    });

    it('maps primary and accent colors to global CSS variables', () => {
        const variables = getBrandingStyleVariables({ ...DEFAULT_BRANDING, primaryColor: '#ff0000', accentColor: '#00ff00' });
        expect(variables).toMatchObject({
            '--brand-primary': '0 100% 50%',
            '--brand-primary-dark': '0 58% 64%',
            '--brand-accent': '120 100% 50%',
            '--brand-accent-surface-dark': '120 20% 17%',
        });
    });
});