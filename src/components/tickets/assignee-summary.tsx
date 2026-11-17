'use client';

import { useLanguage } from '@/components/providers/language-provider';
import { PersonName } from '@/components/people/person-name';

interface AssigneeSummaryProps {
    assignees?: Array<{ id?: string; name?: string | null; role?: string | null }>;
    /** Context for the person cards opened from these names. */
    ticketId?: string;
    className?: string;
}

/** First two assignees as person names, then "+N"; the full list stays available as a tooltip. */
export function AssigneeSummary({ assignees = [], ticketId, className = '' }: AssigneeSummaryProps) {
    const { t } = useLanguage();
    if (assignees.length === 0) return <span className={`text-xs font-medium text-amber-700 dark:text-amber-300 ${className}`}>{t('Unassigned')}</span>;
    const shown = assignees.slice(0, 2);
    const remainder = assignees.length - shown.length;
    return (
        <span className={className} title={assignees.map((user) => user.name || t('Unnamed user')).join(', ')}>
            {shown.map((user, index) => (
                <span key={user.id ?? index}>
                    {index > 0 ? ', ' : null}
                    <PersonName person={user.id ? { id: user.id, name: user.name, role: user.role } : { id: '', name: user.name }} ticketId={ticketId} />
                </span>
            ))}
            {remainder > 0 ? ` +${remainder}` : null}
        </span>
    );
}
