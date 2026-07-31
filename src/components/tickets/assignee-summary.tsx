interface AssigneeSummaryProps {
    assignees?: Array<{ id?: string; name?: string | null }>;
    className?: string;
}

export function AssigneeSummary({ assignees = [], className = '' }: AssigneeSummaryProps) {
    if (assignees.length === 0) return <span className={`text-xs font-medium text-amber-700 dark:text-amber-300 ${className}`}>Unassigned</span>;
    const names = assignees.slice(0, 2).map((user) => user.name || 'Unnamed user');
    const remainder = assignees.length - names.length;
    const label = remainder > 0 ? `${names.join(', ')} +${remainder}` : names.join(', ');
    return <span className={className} title={assignees.map((user) => user.name || 'Unnamed user').join(', ')}>{label}</span>;
}