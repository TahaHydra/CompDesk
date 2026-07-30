import { z } from 'zod';
import { isUploadedImageUrl } from '@/lib/uploaded-image-url';

const iconSchema = z.string().max(200).refine(
    (url) => url === '' || isUploadedImageUrl(url, 'quick-links'),
    'Quick-link icons must be uploaded through the icon endpoint'
).default('');

export const externalDashboardLinkSchema = z.object({
    type: z.literal('external'),
    title: z.string().trim().min(1).max(80),
    url: z.string().url().max(1000).refine((url) => /^https?:\/\//i.test(url), 'Quick links must use HTTP or HTTPS'),
    iconUrl: iconSchema,
}).strict();

export const ticketFormDashboardLinkSchema = z.object({
    type: z.literal('ticket_form'),
    title: z.string().trim().min(1).max(80),
    queueId: z.string().uuid(),
    categoryId: z.string().uuid().optional(),
    iconUrl: iconSchema,
}).strict();

export const dashboardLinkSchema = z.discriminatedUnion('type', [
    externalDashboardLinkSchema,
    ticketFormDashboardLinkSchema,
]);

function migrateLegacyLinks(candidate: unknown): unknown {
    if (!Array.isArray(candidate)) return candidate;
    return candidate.map((link) => {
        if (!link || typeof link !== 'object' || Array.isArray(link)) return link;
        const item = link as Record<string, unknown>;
        return item.type ? item : { ...item, type: 'external' };
    });
}

export const dashboardLinksSchema = z.preprocess(migrateLegacyLinks, z.array(dashboardLinkSchema).max(16));
export type DashboardLink = z.infer<typeof dashboardLinkSchema>;

export function parseDashboardLinks(value: unknown): DashboardLink[] {
    try {
        const candidate = typeof value === 'string' ? JSON.parse(value) : value;
        const parsed = dashboardLinksSchema.safeParse(candidate);
        return parsed.success ? parsed.data : [];
    } catch {
        return [];
    }
}

export function normalizeDashboardLinks(value: unknown) {
    return dashboardLinksSchema.safeParse(value);
}
export function filterDashboardLinksForQueueAccess(
    links: DashboardLink[],
    allowedQueueIds: readonly string[] | null
): DashboardLink[] {
    if (allowedQueueIds === null) return links;
    const allowed = new Set(allowedQueueIds);
    return links.filter((link) => link.type === 'external' || allowed.has(link.queueId));
}