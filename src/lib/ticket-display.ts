const STATUS_LABELS: Record<string, string> = {
    NEW: 'New',
    OPEN: 'Open',
    PENDING_USER: 'Pending User',
    PENDING_AGENT: 'Pending Agent',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
};

const PRIORITY_LABELS: Record<string, string> = {
    LOW: 'Low',
    NORMAL: 'Normal',
    HIGH: 'High',
    URGENT: 'Urgent',
};

function normalizeTicketValue(value: string) {
    return value.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function formatTicketValue(value: string) {
    const normalized = normalizeTicketValue(value);
    return PRIORITY_LABELS[normalized] ?? STATUS_LABELS[normalized] ?? value;
}

export function getStatusBadgeClass(value: string) {
    const normalized = normalizeTicketValue(value);
    return STATUS_LABELS[normalized] ? `status-${normalized.toLowerCase()}` : '';
}

export function getPriorityBadgeClass(value: string) {
    const normalized = normalizeTicketValue(value);
    return PRIORITY_LABELS[normalized] ? `priority-${normalized.toLowerCase()}` : '';
}

export function getTicketValueBadgeClass(value: string) {
    return getPriorityBadgeClass(value) || getStatusBadgeClass(value);
}
