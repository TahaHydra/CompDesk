import { z } from 'zod';
import type { AppLanguage } from '@/lib/i18n';

export const HELP_ICON_KEYS = ['book', 'ticket', 'user', 'agent', 'settings', 'shield'] as const;

const slugSchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens');
const localizedTitle = z.string().trim().min(2).max(160);
const localizedDescription = z.string().trim().max(500).nullable().optional();

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
}).strict();

export const helpArticleInputSchema = z.object({
    id: z.string().uuid().optional(),
    collectionId: z.string().uuid(),
    slug: slugSchema,
    titleEn: localizedTitle,
    titleFr: localizedTitle,
    summaryEn: localizedDescription,
    summaryFr: localizedDescription,
    contentEn: z.string().trim().min(20).max(100_000),
    contentFr: z.string().trim().min(20).max(100_000),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    isPublished: z.boolean().default(true),
}).strict();

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
    return {
        title: language === 'fr' ? value.titleFr : value.titleEn,
        description: language === 'fr' ? value.descriptionFr ?? null : value.descriptionEn ?? null,
        summary: language === 'fr' ? value.summaryFr ?? null : value.summaryEn ?? null,
        content: language === 'fr' ? value.contentFr : value.contentEn,
    };
}