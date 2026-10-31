'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, Tag as TagIcon } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { tagColor } from './tag-chip';

export interface TagPickerOption { id: string; name: string; color?: string | null; hint?: string }

/**
 * Searchable, scrollable multi-select for tags. Selection is controlled by the caller; options are only
 * the tags that can be chosen in the current context (department, category).
 */
export function TagPicker({ options, selected, onChange, onOpenChange, label, emptyText, disabled = false, align = 'start', id }: {
    options: TagPickerOption[];
    selected: string[];
    onChange: (next: string[]) => void;
    /** Lets a caller apply a batch of changes once, when the list closes. */
    onOpenChange?: (open: boolean) => void;
    label: string;
    emptyText?: string;
    disabled?: boolean;
    align?: 'start' | 'end';
    id?: string;
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        return needle ? options.filter((option) => option.name.toLowerCase().includes(needle)) : options;
    }, [options, search]);
    const selectedCount = options.filter((option) => selected.includes(option.id)).length;
    const toggle = (tagId: string) => onChange(selected.includes(tagId) ? selected.filter((value) => value !== tagId) : [...selected, tagId]);

    return (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch(''); onOpenChange?.(next); }}>
            <PopoverTrigger asChild>
                <Button id={id} type="button" variant="outline" size="sm" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} className="h-9 justify-between gap-2 font-normal">
                    <span className="flex items-center gap-2"><TagIcon className="h-3.5 w-3.5 text-muted-foreground" />{label}</span>
                    {/* No count badge: the selected tags are always shown as chips next to this button. */}
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align={align} collisionPadding={8} className="w-[min(18rem,calc(100vw-1rem))] p-0">
                <div className="relative border-b p-2">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    {/* Focus search for mouse and keyboard users; on touch screens it would raise the keyboard over the list. */}
                    <Input autoFocus={typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search tags…')} aria-label={t('Search tags…')} className="h-8 pl-8" />
                </div>
                <div role="listbox" aria-multiselectable="true" aria-label={label} className="max-h-64 overflow-y-auto p-1">
                    {visible.length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">{search ? t('No matching tags') : emptyText ?? t('No tags available here')}</p> : visible.map((option) => {
                        const isSelected = selected.includes(option.id);
                        return (
                            <button
                                key={option.id}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => toggle(option.id)}
                                className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none', isSelected && 'font-medium')}
                            >
                                <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border', isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
                                    {isSelected ? <Check className="h-3 w-3" /> : null}
                                </span>
                                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tagColor(option.color) }} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{option.name}</span>
                                    {option.hint ? <span className="block truncate text-[11px] font-normal text-muted-foreground">{option.hint}</span> : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {selectedCount > 0 ? (
                    <div className="flex justify-end border-t p-1.5">
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange(selected.filter((value) => !options.some((option) => option.id === value)))}>{t('Clear selection')}</Button>
                    </div>
                ) : null}
            </PopoverContent>
        </Popover>
    );
}
