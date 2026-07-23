'use client';

import { createContext, useContext } from 'react';
import type { PublicBranding } from '@/lib/branding';

const BrandingContext = createContext<PublicBranding | null>(null);

export function BrandingProvider({
    branding,
    children,
}: {
    branding: PublicBranding;
    children: React.ReactNode;
}) {
    return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): PublicBranding {
    const branding = useContext(BrandingContext);
    if (!branding) throw new Error('useBranding must be used within BrandingProvider');
    return branding;
}