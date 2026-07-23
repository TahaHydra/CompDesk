import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
    title: string;
    description?: string;
    icon?: LucideIcon;
    /** Optional short label rendered above the title */
    eyebrow?: string;
    /** Right-aligned actions (buttons, etc.) */
    children?: React.ReactNode;
    className?: string;
}

/**
 * Consistent page header used across the app. Stacks vertically on mobile and
 * sits actions to the right from `sm` up. Titles use the display face.
 */
export function PageHeader({ title, description, icon: Icon, eyebrow, children, className }: PageHeaderProps) {
    return (
        <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)}>
            <div className="min-w-0 space-y-1">
                {eyebrow && (
                    <p className="text-xs font-semibold uppercase tracking-widest text-primary">{eyebrow}</p>
                )}
                <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight sm:text-3xl">
                    {Icon && (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:h-10 sm:w-10">
                            <Icon className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
                        </span>
                    )}
                    <span className="truncate">{title}</span>
                </h1>
                {description && <p className="text-sm text-muted-foreground sm:text-[15px]">{description}</p>}
            </div>
            {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
        </div>
    );
}
