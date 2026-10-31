'use client';

import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface MultiSelectOption { value: string; label: string; group?: string }
export interface MultiSelectGroup { id: string; label: string; hint?: string }

/** Lets a surrounding dialog ignore Escape while one of these lists is open (it closes the list instead). */
export const MULTI_SELECT_OPEN_ATTRIBUTE = 'data-multi-select-open';

/**
 * Searchable multi-select whose list opens inline under the field, with optional headed groups (e.g. a
 * department above its categories). Inline rather than a floating layer so it works inside dialogs —
 * keyboard focus, search and Escape stay within the dialog — and on small screens. Long lists scroll
 * inside the panel; search filters across groups and keeps each match under its heading.
 */
export function MultiSelect({ id, options, groups, selected, onChange, placeholder, searchPlaceholder, emptyText, disabled = false, className }: {
    id?: string;
    options: MultiSelectOption[];
    /** Headings in display order; options without a group are listed first. */
    groups?: MultiSelectGroup[];
    selected: string[];
    onChange: (next: string[]) => void;
    placeholder: string;
    searchPlaceholder?: string;
    emptyText?: string;
    disabled?: boolean;
    className?: string;
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const root = useRef<HTMLDivElement>(null);
    const listId = useId();
    const needle = search.trim().toLowerCase();
    const sections = useMemo(() => {
        const matches = (option: MultiSelectOption) => !needle || option.label.toLowerCase().includes(needle);
        const ungrouped = options.filter((option) => !option.group && matches(option));
        const grouped = (groups ?? []).map((group) => ({ group, options: options.filter((option) => option.group === group.id && matches(option)) }))
            .filter((section) => section.options.length > 0);
        return [...(ungrouped.length ? [{ group: undefined, options: ungrouped }] : []), ...grouped];
    }, [groups, needle, options]);
    const selectedLabels = options.filter((option) => selected.includes(option.value)).map((option) => option.label);
    const summary = selectedLabels.length <= 2 ? selectedLabels.join(', ') : `${selectedLabels.slice(0, 2).join(', ')} +${selectedLabels.length - 2}`;
    const toggle = (value: string) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
    const close = () => { setOpen(false); setSearch(''); };

    // Close on a click outside the field and its list, and on Escape wherever focus is.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);
    useEffect(() => { if (disabled) close(); }, [disabled]);

    return (
        <div ref={root} className={cn('space-y-1.5', className)} {...(open ? { [MULTI_SELECT_OPEN_ATTRIBUTE]: '' } : {})}>
            <Button id={id} type="button" variant="outline" disabled={disabled} aria-expanded={open} aria-controls={listId}
                onClick={() => (open ? close() : setOpen(true))}
                className="h-10 w-full justify-between gap-2 px-3 font-normal">
                <span className={cn('truncate', selectedLabels.length === 0 && 'text-muted-foreground')}>{selectedLabels.length ? summary : placeholder}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
            </Button>
            {open ? (
                <div className="overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-sm">
                    <div className="relative border-b p-2">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={searchPlaceholder ?? t('Search…')} aria-label={searchPlaceholder ?? t('Search…')} className="h-8 pl-8" />
                    </div>
                    <div id={listId} role="listbox" aria-multiselectable="true" aria-label={placeholder} className="max-h-[min(16rem,45vh)] overflow-y-auto overscroll-contain p-1">
                        {sections.length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">{search ? t('No matches') : emptyText ?? t('Nothing to choose from')}</p> : sections.map(({ group, options: sectionOptions }) => (
                            <Fragment key={group?.id ?? 'ungrouped'}>
                                {group ? (
                                    <div role="presentation" className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-popover px-2 pb-1 pt-2 text-xs font-semibold">
                                        <span className="truncate">{group.label}</span>
                                        {group.hint ? <span className="shrink-0 text-[11px] font-normal text-muted-foreground">{group.hint}</span> : null}
                                    </div>
                                ) : null}
                                {sectionOptions.map((option) => {
                                    const isSelected = selected.includes(option.value);
                                    return (
                                        <button key={option.value} type="button" role="option" aria-selected={isSelected} onClick={() => toggle(option.value)}
                                            className={cn('flex w-full items-center gap-2 rounded-sm py-2 pr-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:py-1.5', group ? 'pl-4' : 'pl-2')}>
                                            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border', isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                                                {isSelected ? <Check className="h-3 w-3" /> : null}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">{option.label}</span>
                                        </button>
                                    );
                                })}
                            </Fragment>
                        ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t p-1.5">
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" disabled={selectedLabels.length === 0}
                            onClick={() => onChange(selected.filter((value) => !options.some((option) => option.value === value)))}>{t('Clear selection')}</Button>
                        <Button type="button" size="sm" className="h-7 text-xs" onClick={close}>{t('Done')}</Button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
