export type TicketContentSegment =
    | { kind: 'text'; value: string }
    | { kind: 'inline-image'; alt: string; url: string }
    | { kind: 'external-image-link'; alt: string; url: string }
    | { kind: 'blocked-image'; alt: string };

const AUTHENTICATED_ATTACHMENT = /^\/api\/upload\/[0-9a-f-]{36}(?:\?download=1)?$/i;

export function isAuthenticatedInlineAttachment(url: string): boolean {
    return AUTHENTICATED_ATTACHMENT.test(url);
}

export function parseTicketContent(text: string): TicketContentSegment[] {
    const segments: TicketContentSegment[] = [];
    const pattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (index > cursor) segments.push({ kind: 'text', value: text.slice(cursor, index) });
        const alt = match[1];
        const url = match[2].trim();
        if (isAuthenticatedInlineAttachment(url)) segments.push({ kind: 'inline-image', alt, url });
        else {
            try {
                const parsed = new URL(url);
                if (parsed.protocol === 'https:' || parsed.protocol === 'http:') segments.push({ kind: 'external-image-link', alt, url: parsed.toString() });
                else segments.push({ kind: 'blocked-image', alt });
            } catch { segments.push({ kind: 'blocked-image', alt }); }
        }
        cursor = index + match[0].length;
    }
    if (cursor < text.length) segments.push({ kind: 'text', value: text.slice(cursor) });
    return segments;
}