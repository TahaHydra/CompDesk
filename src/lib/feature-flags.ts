import { prisma } from '@/lib/prisma';

export const FEATURE_FLAGS = {
    feature_attachments_enabled: true,
    feature_dashboard_links_enabled: true,
    feature_external_api_enabled: false,
    feature_webhooks_enabled: true,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

export async function getFeatureFlag(key: FeatureFlagKey): Promise<boolean> {
    const setting = await prisma.appSetting.findUnique({ where: { key } });
    if (!setting) return FEATURE_FLAGS[key];
    return setting.value !== 'false';
}

export async function getAllFeatureFlags(): Promise<Record<FeatureFlagKey, boolean>> {
    const settings = await prisma.appSetting.findMany({
        where: { key: { in: Object.keys(FEATURE_FLAGS) } },
    });
    const map = Object.fromEntries(settings.map((setting) => [setting.key, setting.value !== 'false']));

    return Object.fromEntries(
        Object.entries(FEATURE_FLAGS).map(([key, defaultValue]) => [
            key,
            map[key] ?? defaultValue,
        ])
    ) as Record<FeatureFlagKey, boolean>;
}
