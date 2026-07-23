/* eslint-disable @next/next/no-img-element */
'use client';

import { Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBranding } from '@/components/providers/branding-provider';

export function BrandLogo({
    compact = false,
    className,
}: {
    compact?: boolean;
    className?: string;
}) {
    const branding = useBranding();
    const fallback = compact ? branding.compactLogoUrl : branding.mainLogoUrl;
    const lightLogo = compact ? branding.compactLogoUrl : (branding.lightLogoUrl || fallback || branding.darkLogoUrl);
    const darkLogo = compact ? branding.compactLogoUrl : (branding.darkLogoUrl || fallback || branding.lightLogoUrl);

    if (lightLogo || darkLogo) {
        return (
            <span className={cn('inline-flex items-center justify-center overflow-hidden', className)}>
                {lightLogo ? <img src={lightLogo} alt={`${branding.applicationName} logo`} className="h-full w-full object-contain dark:hidden" /> : null}
                {darkLogo ? <img src={darkLogo} alt={`${branding.applicationName} logo`} className="hidden h-full w-full object-contain dark:block" /> : null}
            </span>
        );
    }

    return (
        <span className={cn('brand-gradient inline-flex items-center justify-center text-white', className)}>
            <Shield className="h-1/2 w-1/2" aria-hidden="true" />
            <span className="sr-only">{branding.applicationName}</span>
        </span>
    );
}