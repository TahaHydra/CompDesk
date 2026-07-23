import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { QueryProvider } from '@/components/providers/query-provider';
import { AuthProvider } from '@/components/providers/auth-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';

export const metadata: Metadata = {
    title: 'CompDesk - Helpdesk & Ticketing',
    description: 'Lightweight ticketing system for IT support',
    icons: { icon: '/favicon.ico' },
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

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
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
                <ThemeProvider>
                    <AuthProvider>
                        <QueryProvider>
                            {children}
                            <Toaster />
                        </QueryProvider>
                    </AuthProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
