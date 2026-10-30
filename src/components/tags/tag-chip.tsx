'use client';

import { X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface TagChipTag { id: string; name: string; color?: string | null }

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_TAG_COLOR = '#6366f1';

/** Stored colors are validated on save; anything else falls back so a bad value can never inject CSS. */
export function tagColor(color?: string | null): string {
    return color && HEX_COLOR.test(color) ? color : DEFAULT_TAG_COLOR;
}

/**
 * A tag as a tinted chip with a color dot, readable in light and dark themes. `unavailable` marks a tag
 * the ticket keeps from an earlier department or category; `hint` explains it on hover and focus.
 */
export function TagChip({ tag, hint, unavailable = false, size = 'md', onRemove, removeLabel, className }: {
    tag: TagChipTag;
    hint?: string;
    unavailable?: boolean;
    size?: 'sm' | 'md';
    onRemove?: () => void;
    removeLabel?: string;
    className?: string;
}) {
    const color = tagColor(tag.color);
    const chip = (
        <span
            tabIndex={hint ? 0 : undefined}
            className={cn(
                'inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
                size === 'sm' ? 'px-2 text-[11px] leading-5' : 'px-2.5 py-0.5 text-xs',
                unavailable && 'border-dashed border-muted-foreground/60 opacity-70',
                className,
            )}
            style={{ backgroundColor: `${color}1f`, ...(unavailable ? {} : { borderColor: `${color}66` }) }}
        >
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className={cn('truncate', unavailable && 'line-through decoration-muted-foreground/60')}>{tag.name}</span>
            {unavailable && hint ? <span className="sr-only">{hint}</span> : null}
            {onRemove ? (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={removeLabel ?? `Remove ${tag.name}`}
                    className="-mr-1 rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <X className="h-3 w-3" />
                </button>
            ) : null}
        </span>
    );
    if (!hint) return chip;
    return (
        <TooltipProvider delayDuration={150}>
            <Tooltip>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent>{hint}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
