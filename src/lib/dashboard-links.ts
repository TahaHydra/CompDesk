import { z } from 'zod';
import { isUploadedImageUrl } from '@/lib/uploaded-image';

export const dashboardLinkSchema = z.object({
    title: z.string().trim().min(1).max(80),
    url: z.string().url().max(1000).refine((url) => /^https?:\/\//i.test(url), 'Quick links must use HTTP or HTTPS'),
    iconUrl: z.string().max(200).refine((url) => url === '' || isUploadedImageUrl(url, 'quick-links'), 'Quick-link icons must be uploaded through the icon endpoint').default(''),
}).strict();

export const dashboardLinksSchema = z.array(dashboardLinkSchema).max(16);
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