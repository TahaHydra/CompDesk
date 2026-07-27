'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ScopedUserOption {
    id: string;
    name: string;
    email: string;
    role: string;
    departmentNames: string[];
}

interface Props {
    value: string;
    onValueChange: (value: string) => void;
    kind: 'requester' | 'assignee';
    queueId?: string;
    selectedUser?: Pick<ScopedUserOption, 'id' | 'name' | 'email'> | null;
    allowUnassigned?: boolean;
    allowAny?: boolean;
    disabled?: boolean;
    placeholder?: string;
}

export function UserSearchCombobox({ value, onValueChange, kind, queueId, selectedUser, allowUnassigned, allowAny, disabled, placeholder }: Props) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState('');
    const [query, setQuery] = useState('');
    const [options, setOptions] = useState<ScopedUserOption[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const timeout = window.setTimeout(() => setQuery(input.trim()), 250);
        return () => window.clearTimeout(timeout);
    }, [input]);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setLoading(true);
        const params = new URLSearchParams({ kind, q: query, limit: '20' });
        if (queueId) params.set('queueId', queueId);
        fetch(`/api/users/search?${params}`, { signal: controller.signal })
            .then(async (response) => {
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || 'User search failed');
                setOptions(payload);
            })
            .catch((error) => { if (error.name !== 'AbortError') setOptions([]); })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [kind, open, query, queueId]);

    const current = options.find((option) => option.id === value) ?? (selectedUser?.id === value ? selectedUser : null);
    const label = value === 'all' ? `Any ${kind}` : value === 'unassigned' ? 'Unassigned' : current?.name ?? placeholder ?? `Select ${kind}`;
    const choose = (next: string) => { onValueChange(next); setOpen(false); setInput(''); };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild><Button variant="outline" role="combobox" aria-expanded={open} disabled={disabled} className="h-9 w-full justify-between font-normal"><span className="truncate">{label}</span><ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" /></Button></PopoverTrigger>
            <PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] p-2">
                <div className="relative mb-2"><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input autoFocus value={input} onChange={(event) => setInput(event.target.value)} placeholder="Search name or email…" className="pl-8" /></div>
                <div role="listbox" className="max-h-64 overflow-y-auto">
                    {allowAny ? <Option active={value === 'all'} onClick={() => choose('all')} title={`Any ${kind}`} detail="Do not filter" /> : null}
                    {allowUnassigned ? <Option active={value === 'unassigned'} onClick={() => choose('unassigned')} title="Unassigned" detail="Tickets without an assignee" /> : null}
                    {loading ? <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Searching…</div> : null}
                    {!loading && options.map((option) => <Option key={option.id} active={value === option.id} onClick={() => choose(option.id)} title={option.name} detail={`${option.email} · ${option.role}${option.departmentNames.length ? ` · ${option.departmentNames.join(', ')}` : ''}`} />)}
                    {!loading && !options.length ? <p className="py-5 text-center text-sm text-muted-foreground">No matching users</p> : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function Option({ active, onClick, title, detail }: { active: boolean; onClick: () => void; title: string; detail: string }) {
    return <button type="button" role="option" aria-selected={active} onClick={onClick} className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"><Check className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'opacity-100' : 'opacity-0')} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{title}</span><span className="block truncate text-xs text-muted-foreground">{detail}</span></span></button>;
}