import { z } from 'zod';
import type { AppLanguage } from '@/lib/i18n';

export const HELP_ICON_KEYS = ['book', 'ticket', 'user', 'agent', 'settings', 'shield'] as const;

const slugSchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens');
const localizedTitle = z.string().trim().max(160).refine((value) => value.length === 0 || value.length >= 2, 'Use at least 2 characters or leave this translation empty');
const localizedDescription = z.string().trim().max(500).nullable().optional();
const localizedContent = z.string().trim().max(100_000).refine((value) => value.length === 0 || value.length >= 20, 'Use at least 20 characters or leave this translation empty');

export const helpCollectionInputSchema = z.object({
    id: z.string().uuid().optional(),
    slug: slugSchema,
    titleEn: localizedTitle,
    titleFr: localizedTitle,
    descriptionEn: localizedDescription,
    descriptionFr: localizedDescription,
    icon: z.enum(HELP_ICON_KEYS).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isPublished: z.boolean().default(true),
}).strict().superRefine((value, context) => {
    if (!value.titleEn && !value.titleFr) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['titleEn'], message: 'Add an English or French title' });
    }
});

export const helpArticleInputSchema = z.object({
    id: z.string().uuid().optional(),
    collectionId: z.string().uuid(),
    slug: slugSchema,
    titleEn: localizedTitle,
    titleFr: localizedTitle,
    summaryEn: localizedDescription,
    summaryFr: localizedDescription,
    contentEn: localizedContent,
    contentFr: localizedContent,
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isPublished: z.boolean().default(true),
}).strict().superRefine((value, context) => {
    const variants = [
        { language: 'English', titleKey: 'titleEn' as const, contentKey: 'contentEn' as const, summaryKey: 'summaryEn' as const },
        { language: 'French', titleKey: 'titleFr' as const, contentKey: 'contentFr' as const, summaryKey: 'summaryFr' as const },
    ];
    let complete = 0;
    for (const variant of variants) {
        const title = value[variant.titleKey];
        const content = value[variant.contentKey];
        const summary = value[variant.summaryKey] || '';
        const hasAnything = Boolean(title || content || summary);
        if (title && content) complete += 1;
        else if (hasAnything) {
            if (!title) context.addIssue({ code: z.ZodIssueCode.custom, path: [variant.titleKey], message: `${variant.language} title is required for this translation` });
            if (!content) context.addIssue({ code: z.ZodIssueCode.custom, path: [variant.contentKey], message: `${variant.language} content is required for this translation` });
        }
    }
    if (complete === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['titleEn'], message: 'Add one complete English or French translation' });
});

export interface LocalizedHelpCollection {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    articleCount: number;
}

export interface LocalizedHelpArticle {
    id: string;
    collectionId: string;
    slug: string;
    title: string;
    summary: string | null;
    content?: string;
    sortOrder: number;
    collection?: { slug: string; title: string };
}

interface LocalizedFields {
    titleEn: string;
    titleFr: string;
    descriptionEn?: string | null;
    descriptionFr?: string | null;
    summaryEn?: string | null;
    summaryFr?: string | null;
    contentEn?: string;
    contentFr?: string;
}

export function localizedHelpFields(value: LocalizedFields, language: AppLanguage) {
    const primary = language === 'fr' ? 'Fr' : 'En';
    const fallback = language === 'fr' ? 'En' : 'Fr';
    const localized = (field: 'title' | 'description' | 'summary' | 'content') => {
        const preferred = value[`${field}${primary}` as keyof LocalizedFields];
        const alternative = value[`${field}${fallback}` as keyof LocalizedFields];
        return preferred || alternative || null;
    };
    return {
        title: localized('title') || '',
        description: localized('description'),
        summary: localized('summary'),
        content: localized('content') || undefined,
    };
}

export function localizedHelpTitle(value: Pick<LocalizedFields, 'titleEn' | 'titleFr'>, language: AppLanguage) {
    return localizedHelpFields(value, language).title;
}

export function helpContentLanguages(value: Pick<LocalizedFields, 'titleEn' | 'titleFr'>, defaultLanguage: AppLanguage): AppLanguage[] {
    const languages: AppLanguage[] = [];
    if (value.titleEn) languages.push('en');
    if (value.titleFr) languages.push('fr');
    return languages.length ? languages : [defaultLanguage];
}
