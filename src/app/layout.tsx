import type { CSSProperties } from 'react';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { QueryProvider } from '@/components/providers/query-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { BrandingProvider } from '@/components/providers/branding-provider';
import { LanguageProvider } from '@/components/providers/language-provider';
import { getBrandingStyleVariables, getPublicBranding } from '@/lib/branding';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const branding = await getPublicBranding();
    const title = `${branding.applicationName} — ${branding.subtitle}`;

    // Reuses the application's own required public-origin variable rather than
    // hard-coding a deployment URL; left unset (relative URLs) when absent.
    const configuredOrigin = process.env.AUTH_URL || process.env.NEXTAUTH_URL || '';
    let metadataBase: URL | undefined;
    try {
        metadataBase = configuredOrigin ? new URL(configuredOrigin) : undefined;
    } catch {
        metadataBase = undefined;
    }

    return {
        ...(metadataBase ? { metadataBase } : {}),
        title: {
            default: title,
            template: `%s — ${branding.shortApplicationName}`,
        },
        applicationName: branding.applicationName,
        description: branding.description,
        manifest: '/site.webmanifest',
        icons: {
            icon: branding.faviconUrl
                ? [{ url: branding.faviconUrl }]
                : [
                    { url: '/favicon.ico' },
                    { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                    { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
                ],
            apple: branding.faviconUrl || '/apple-touch-icon.png',
        },
        openGraph: {
            type: 'website',
            title,
            description: branding.description,
            siteName: branding.applicationName,
            images: [{ url: '/og-image.png', width: 1200, height: 630 }],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description: branding.description,
            images: ['/og-image.png'],
        },
    };
}

export const viewport: Viewport = {
    themeColor: '#4f46e5',
};

const themeInitScript = `
(() => {
  try {
    const key = 'compdesk-theme';
    const saved = localStorage.getItem(key) || 'system';
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
                    <LanguageProvider initialLanguage="en">
                        <ThemeProvider>
                            <QueryProvider>
                                {children}
                                <Toaster />
                            </QueryProvider>
                        </ThemeProvider>
                    </LanguageProvider>
                </BrandingProvider>
            </body>
        </html>
    );
}