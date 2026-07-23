import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { BrandingProvider } from '@/components/providers/branding-provider';
import { getBrandingStyleVariables, getPublicBranding } from '@/lib/branding';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const branding = await getPublicBranding();
    return {
        title: {
            default: `${branding.applicationName} — ${branding.subtitle}`,
            template: `%s — ${branding.shortApplicationName}`,
        },
        applicationName: branding.applicationName,
        description: branding.description,
        icons: { icon: branding.faviconUrl || '/favicon.ico' },
    };
}

const themeInitScript = `
(() => {
  try {
    const key = 'compdesk-theme';
    const legacyKey = 'excodesk-theme';
    const saved = localStorage.getItem(key) || localStorage.getItem(legacyKey) || 'system';
    if (!localStorage.getItem(key) && localStorage.getItem(legacyKey)) localStorage.setItem(key, saved);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const resolved = saved === 'system' ? (prefersDark ? 'dark' : 'light') : saved;
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  } catch {}
})();
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
    const branding = await getPublicBranding();
    const brandStyles = getBrandingStyleVariables(branding) as CSSProperties;
    return (
        <html lang="en" suppressHydrationWarning style={brandStyles}>
            <head>
                <link rel="preconnect" href="https://fonts.googleapis.com" />
                <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap"
                    rel="stylesheet"
                />
                <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
            </head>
            <body className="min-h-screen transition-theme">
                <BrandingProvider branding={branding}>
                    <ThemeProvider>
                        <QueryProvider>
                            {children}
                            <Toaster />
                        </QueryProvider>
                    </ThemeProvider>
                </BrandingProvider>
            </body>
        </html>
    );
}