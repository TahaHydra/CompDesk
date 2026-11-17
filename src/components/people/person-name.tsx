'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, Check, Copy, Languages, Mail, Ticket, UserCog } from 'lucide-react';
import { useLanguage } from '@/components/providers/language-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LANGUAGE_LABELS, type AppLanguage } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export type PersonRole = 'USER' | 'AGENT' | 'ADMIN' | 'SUPER_ADMIN';
export interface PersonSummary { id: string; name?: string | null; role?: PersonRole | string | null }

interface PersonCard {
    id: string;
    name: string;
    image: string | null;
    role: PersonRole;
    isSelf: boolean;
    departments: string[];
    isActive?: boolean;
    email?: string;
    preferredLanguage?: string;
    jobTitle?: string;
    openRequests?: number;
    requestsHref?: string;
    manageHref?: string;
}

export const ROLE_LABELS: Record<PersonRole, string> = {
    USER: 'Requester',
    AGENT: 'Agent',
    ADMIN: 'Department admin',
    SUPER_ADMIN: 'Super Admin',
};

export function roleLabel(role?: string | null): string | null {
    return role && role in ROLE_LABELS ? ROLE_LABELS[role as PersonRole] : null;
}

export function initials(name?: string | null): string {
    return (name || '?').split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
}

const HOVER_OPEN_DELAY = 400;
const HOVER_CLOSE_DELAY = 150;

/**
 * A person's name that opens their card on hover (mouse) or click/tap (touch, keyboard).
 * The card is fetched only when opened; the server decides which details the viewer may see
 * (Admin → Settings → Privacy). `ticketId` gives the context the person is seen in.
 */
export function PersonName({ person, ticketId, hint, className }: {
    person: PersonSummary | null | undefined;
    ticketId?: string;
    /** Short disambiguation shown when another person in the same view has the same name. */
    hint?: string;
    className?: string;
}) {
    const { t } = useLanguage();
    const [open, setOpen] = useState(false);
    const timer = useRef<number | null>(null);
    const clearTimer = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
    useEffect(() => clearTimer, []);

    if (!person?.id) return <span className={className}>{person?.name || '—'}</span>;
    const schedule = (next: boolean, delay: number) => (event: React.PointerEvent) => {
        if (event.pointerType !== 'mouse') return;
        clearTimer();
        timer.current = window.setTimeout(() => setOpen(next), delay);
    };

    return (
        <Popover open={open} onOpenChange={(next) => { clearTimer(); setOpen(next); }}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    onPointerEnter={schedule(true, HOVER_OPEN_DELAY)}
                    onPointerLeave={schedule(false, HOVER_CLOSE_DELAY)}
                    className={cn('inline max-w-full truncate rounded-sm text-left underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1', className)}
                    aria-label={t('Show details for {name}', { name: person.name || '' })}
                >
                    {person.name || t('Unnamed user')}
                    {hint ? <span className="ml-1 text-xs font-normal text-muted-foreground">({hint})</span> : null}
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                collisionPadding={8}
                className="w-[min(20rem,calc(100vw-1rem))] p-0"
                onPointerEnter={() => clearTimer()}
                onPointerLeave={schedule(false, HOVER_CLOSE_DELAY)}
            >
                {open ? <PersonCardBody personId={person.id} ticketId={ticketId} fallbackName={person.name ?? ''} /> : null}
            </PopoverContent>
        </Popover>
    );
}

function PersonCardBody({ personId, ticketId, fallbackName }: { personId: string; ticketId?: string; fallbackName: string }) {
    const { t } = useLanguage();
    const [copied, setCopied] = useState(false);
    const { data, isLoading, isError } = useQuery<PersonCard>({
        queryKey: ['person-card', personId, ticketId ?? null],
        queryFn: async () => {
            const query = ticketId ? `?ticketId=${encodeURIComponent(ticketId)}` : '';
            const response = await fetch(`/api/users/${personId}/card${query}`, { cache: 'no-store' });
            if (!response.ok) throw new Error('Unavailable');
            return response.json();
        },
        // Short cache: permission or policy changes show up the next time the card opens.
        staleTime: 60_000,
        retry: false,
    });

    if (isLoading) {
        return (
            <div className="flex items-center gap-3 p-4" aria-busy="true">
                <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                <div className="flex-1 space-y-2"><div className="h-3 w-2/3 animate-pulse rounded bg-muted" /><div className="h-3 w-1/3 animate-pulse rounded bg-muted" /></div>
            </div>
        );
    }
    if (isError || !data) {
        return <p className="p-4 text-sm text-muted-foreground">{t('Details for {name} are not available.', { name: fallbackName })}</p>;
    }

    const label = roleLabel(data.role);
    const copyEmail = async () => {
        if (!data.email) return;
        await navigator.clipboard?.writeText(data.email).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
    };
    const language = data.preferredLanguage && data.preferredLanguage in LANGUAGE_LABELS ? LANGUAGE_LABELS[data.preferredLanguage as AppLanguage] : null;

    return (
        <div className="space-y-3 p-4 text-sm">
            <div className="flex items-start gap-3">
                <Avatar className="h-10 w-10 shrink-0">
                    {data.image ? <AvatarImage src={data.image} alt="" /> : null}
                    <AvatarFallback className="bg-primary text-xs text-primary-foreground">{initials(data.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold leading-tight">{data.name}</p>
                    {data.jobTitle ? <p className="break-words text-xs text-muted-foreground">{data.jobTitle}</p> : null}
                    <div className="mt-1.5 flex flex-wrap gap-1">
                        {data.isSelf ? <Badge variant="outline" className="text-[11px]">{t('You')}</Badge> : null}
                        {label ? <Badge variant="secondary" className="text-[11px]">{t(label)}</Badge> : null}
                        {data.isActive === false ? <Badge variant="outline" className="text-[11px] text-muted-foreground">{t('Inactive account')}</Badge> : null}
                    </div>
                </div>
            </div>

            {data.departments.length || data.email || language ? (
                <ul className="space-y-1.5 border-t pt-3 text-xs">
                    {data.departments.length ? (
                        <li className="flex items-start gap-2"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="break-words">{data.departments.join(', ')}</span></li>
                    ) : null}
                    {data.email ? (
                        <li className="flex items-center gap-2">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <a href={`mailto:${data.email}`} className="min-w-0 flex-1 truncate underline-offset-4 hover:underline">{data.email}</a>
                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={copyEmail} aria-label={t('Copy email address')}>
                                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            </Button>
                        </li>
                    ) : null}
                    {language ? (
                        <li className="flex items-center gap-2"><Languages className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span>{t('Prefers {language}', { language })}</span></li>
                    ) : null}
                </ul>
            ) : null}

            {data.requestsHref || data.manageHref ? (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                    {data.requestsHref ? (
                        <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                            <Link href={data.requestsHref}><Ticket className="h-3.5 w-3.5" />{t('Open requests: {count}', { count: data.openRequests ?? 0 })}</Link>
                        </Button>
                    ) : null}
                    {data.manageHref ? (
                        <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
                            <Link href={data.manageHref}><UserCog className="h-3.5 w-3.5" />{t('Manage user')}</Link>
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
