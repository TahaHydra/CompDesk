import { prisma } from '@/lib/prisma';
import {
    brandingConfigSchema,
    type BrandingAssetField,
    type BrandingConfig,
} from '@/lib/branding-schema';

export { brandingConfigSchema } from '@/lib/branding-schema';
export type { BrandingAssetField, BrandingConfig } from '@/lib/branding-schema';

export interface PublicBranding extends BrandingConfig {
    microsoftLoginConfigured: boolean;
}

export const BRANDING_ASSET_FIELDS: readonly BrandingAssetField[] = [
    'mainLogoUrl',
    'compactLogoUrl',
    'lightLogoUrl',
    'darkLogoUrl',
    'faviconUrl',
    'loginBackgroundImageUrl',
] as const;

export const DEFAULT_BRANDING: BrandingConfig = {
    applicationName: 'CompDesk',
    shortApplicationName: 'CompDesk',
    subtitle: 'Helpdesk',
    description: 'A secure, customizable helpdesk and ticketing platform.',
    mainLogoUrl: '',
    compactLogoUrl: '',
    lightLogoUrl: '',
    darkLogoUrl: '',
    faviconUrl: '',
    primaryColor: '#4f46e5',
    accentColor: '#8b5cf6',
    loginHeading: 'Welcome to CompDesk',
    loginDescription: 'Sign in to access your helpdesk portal.',
    loginBackgroundImageUrl: '',
    supportEmail: '',
    footerText: '',
    showDemoAccounts: false,
    demoAccountInfo: '',
    showLocalLogin: true,
    showMicrosoftLogin: true,
    microsoftButtonText: 'Sign in with Microsoft',
};

const BRANDING_SETTING_KEY = 'branding_config';
const LOCAL_LOGIN_SETTING_KEY = 'login_local_enabled';
const MICROSOFT_LOGIN_SETTING_KEY = 'login_microsoft_enabled';

function parseStoredBranding(value?: string): Partial<BrandingConfig> {
    if (!value) return {};
    try {
        const parsed: unknown = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Partial<BrandingConfig>)
            : {};
    } catch {
        return {};
    }
}

export function normalizeBranding(input: Partial<BrandingConfig>): BrandingConfig {
    const parsed = brandingConfigSchema.safeParse({ ...DEFAULT_BRANDING, ...input });
    return parsed.success ? parsed.data : DEFAULT_BRANDING;
}

export function toPublicBranding(config: BrandingConfig): PublicBranding {
    return {
        ...config,
        demoAccountInfo: config.showDemoAccounts ? config.demoAccountInfo : '',
        microsoftLoginConfigured: Boolean(
            process.env.AZURE_AD_CLIENT_ID &&
            process.env.AZURE_AD_CLIENT_SECRET &&
            process.env.AZURE_AD_TENANT_ID
        ),
    };
}

export async function getBrandingConfig(): Promise<BrandingConfig> {
    try {
        const settings = await prisma.appSetting.findMany({
            where: { key: { in: [BRANDING_SETTING_KEY, LOCAL_LOGIN_SETTING_KEY, MICROSOFT_LOGIN_SETTING_KEY] } },
        });
        const map = new Map(settings.map((setting) => [setting.key, setting.value]));
        const stored = parseStoredBranding(map.get(BRANDING_SETTING_KEY));
        return normalizeBranding({
            ...stored,
            showLocalLogin: map.has(LOCAL_LOGIN_SETTING_KEY)
                ? map.get(LOCAL_LOGIN_SETTING_KEY) !== 'false'
                : stored.showLocalLogin,
            showMicrosoftLogin: map.has(MICROSOFT_LOGIN_SETTING_KEY)
                ? map.get(MICROSOFT_LOGIN_SETTING_KEY) !== 'false'
                : stored.showMicrosoftLogin,
        });
    } catch {
        return DEFAULT_BRANDING;
    }
}

export async function getPublicBranding(): Promise<PublicBranding> {
    return toPublicBranding(await getBrandingConfig());
}

export async function saveBrandingConfig(input: BrandingConfig): Promise<BrandingConfig> {
    const config = brandingConfigSchema.parse(input);
    const storedConfig = { ...config };
    delete (storedConfig as Partial<BrandingConfig>).showLocalLogin;
    delete (storedConfig as Partial<BrandingConfig>).showMicrosoftLogin;

    await prisma.$transaction([
        prisma.appSetting.upsert({
            where: { key: BRANDING_SETTING_KEY },
            update: { value: JSON.stringify(storedConfig) },
            create: { key: BRANDING_SETTING_KEY, value: JSON.stringify(storedConfig) },
        }),
        prisma.appSetting.upsert({
            where: { key: LOCAL_LOGIN_SETTING_KEY },
            update: { value: String(config.showLocalLogin) },
            create: { key: LOCAL_LOGIN_SETTING_KEY, value: String(config.showLocalLogin) },
        }),
        prisma.appSetting.upsert({
            where: { key: MICROSOFT_LOGIN_SETTING_KEY },
            update: { value: String(config.showMicrosoftLogin) },
            create: { key: MICROSOFT_LOGIN_SETTING_KEY, value: String(config.showMicrosoftLogin) },
        }),
    ]);

    return config;
}

function hexToHsl(hex: string): string {
    const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
    const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
    const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    let hue = 0;
    let saturation = 0;
    const lightness = (max + min) / 2;

    if (max !== min) {
        const delta = max - min;
        saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
        if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
        if (max === green) hue = (blue - red) / delta + 2;
        if (max === blue) hue = (red - green) / delta + 4;
        hue /= 6;
    }

    return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function darkBrandVariant(hex: string): string {
    const [hue, saturation] = hexToHsl(hex).replaceAll('%', '').split(' ').map(Number);
    return `${hue} ${Math.min(saturation, 58)}% 64%`;
}

function softBrandSurface(hex: string, dark: boolean): string {
    const [hue, saturation] = hexToHsl(hex).replaceAll('%', '').split(' ').map(Number);
    return dark
        ? `${hue} ${Math.min(saturation, 20)}% 17%`
        : `${hue} ${Math.min(saturation, 28)}% 95%`;
}

function readableForeground(hex: string): string {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    return luminance > 0.62 ? '222 47% 11%' : '0 0% 100%';
}

export function getBrandingStyleVariables(branding: BrandingConfig): Record<string, string> {
    const primary = hexToHsl(branding.primaryColor);
    const accent = hexToHsl(branding.accentColor);
    return {
        '--brand-primary': primary,
        '--brand-primary-dark': darkBrandVariant(branding.primaryColor),
        '--brand-primary-foreground': readableForeground(branding.primaryColor),
        '--brand-accent': accent,
        '--brand-accent-dark': darkBrandVariant(branding.accentColor),
        '--brand-accent-surface': softBrandSurface(branding.accentColor, false),
        '--brand-accent-surface-dark': softBrandSurface(branding.accentColor, true),
        '--brand-primary-hex': branding.primaryColor,
        '--brand-accent-hex': branding.accentColor,
        '--brand-login-background-image': branding.loginBackgroundImageUrl
            ? `url("${branding.loginBackgroundImageUrl}")`
            : 'none',
    };
}
