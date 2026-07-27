import { brandingConfigSchema, type BrandingConfig } from '@/lib/branding-schema';
import type { PublicBranding } from '@/lib/branding';

export type BrandingFieldErrors = Partial<Record<keyof BrandingConfig, string>>;

export function getBrandingFieldErrors(input: unknown): BrandingFieldErrors {
    const parsed = brandingConfigSchema.safeParse(input);
    if (parsed.success) return {};

    const errors: BrandingFieldErrors = {};
    for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === 'string' && !(field in errors)) {
            errors[field as keyof BrandingConfig] = issue.message;
        }
    }
    return errors;
}

export function getBrandingApiFieldErrors(payload: unknown): BrandingFieldErrors {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
    const details = (payload as { details?: unknown }).details;
    if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
    const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
    if (!fieldErrors || typeof fieldErrors !== 'object' || Array.isArray(fieldErrors)) return {};

    const errors: BrandingFieldErrors = {};
    for (const [field, messages] of Object.entries(fieldErrors)) {
        if (Array.isArray(messages) && typeof messages[0] === 'string') {
            errors[field as keyof BrandingConfig] = messages[0];
        }
    }
    return errors;
}

export function prepareBrandingForSave(form: BrandingConfig): BrandingConfig {
    if (form.showDemoAccounts && !form.demoAccountInfo.trim()) {
        return { ...form, showDemoAccounts: false };
    }
    return form;
}

export function mergeSavedPublicBranding(
    branding: BrandingConfig,
    current: PublicBranding | undefined
): PublicBranding {
    return {
        ...branding,
        demoAccountInfo: branding.showDemoAccounts ? branding.demoAccountInfo : '',
        microsoftLoginConfigured: current?.microsoftLoginConfigured ?? false,
    };
}
