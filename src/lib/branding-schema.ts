import { z } from 'zod';

const assetPathSchema = z.string().max(500, 'Brand asset paths must be 500 characters or fewer').refine(
    (value) => value === '' || /^\/uploads\/branding\/[0-9a-f-]{36}\.(?:png|jpg|webp|gif|ico)$/.test(value),
    'Brand assets must be uploaded through the branding asset endpoint'
);

const optionalEmailSchema = z.string()
    .max(254, 'Support email must be 254 characters or fewer')
    .refine(
        (value) => value === '' || z.string().email().safeParse(value).success,
        'Enter a valid support email address'
    );

export const brandingConfigSchema = z.object({
    applicationName: z.string().trim().min(1, 'Application name is required').max(80, 'Application name must be 80 characters or fewer'),
    shortApplicationName: z.string().trim().min(1, 'Short application name is required').max(24, 'Short application name must be 24 characters or fewer'),
    subtitle: z.string().trim().max(120, 'Subtitle must be 120 characters or fewer'),
    description: z.string().trim().max(500, 'Description must be 500 characters or fewer'),
    mainLogoUrl: assetPathSchema,
    compactLogoUrl: assetPathSchema,
    lightLogoUrl: assetPathSchema,
    darkLogoUrl: assetPathSchema,
    faviconUrl: assetPathSchema,
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a complete color in #RRGGBB format'),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a complete color in #RRGGBB format'),
    loginHeading: z.string().trim().min(1, 'Login heading is required').max(120, 'Login heading must be 120 characters or fewer'),
    loginDescription: z.string().trim().max(300, 'Login description must be 300 characters or fewer'),
    loginBackgroundImageUrl: assetPathSchema,
    supportEmail: optionalEmailSchema,
    footerText: z.string().trim().max(300, 'Footer text must be 300 characters or fewer'),
    showDemoAccounts: z.boolean(),
    demoAccountInfo: z.string().trim().max(1000, 'Demo account information must be 1000 characters or fewer'),
    showLocalLogin: z.boolean(),
    showMicrosoftLogin: z.boolean(),
    microsoftButtonText: z.string().trim().min(1, 'Microsoft button text is required').max(80, 'Microsoft button text must be 80 characters or fewer'),
});

export type BrandingConfig = z.infer<typeof brandingConfigSchema>;
export type BrandingAssetField =
    | 'mainLogoUrl'
    | 'compactLogoUrl'
    | 'lightLogoUrl'
    | 'darkLogoUrl'
    | 'faviconUrl'
    | 'loginBackgroundImageUrl';
