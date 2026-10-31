/**
 * One line naming what happened, then optional text. Change events already read as a sentence
 * ("Status changed from NEW to OPEN"); comments and reminders show their text beneath a label, and a
 * created ticket shows no text because it would only repeat the ticket title.
 */
export function notificationText(n: { type: string; content?: string | null }, t: (key: string) => string): { title: string; detail?: string } {
    const content = n.content?.trim() || undefined;
    switch (n.type) {
        case 'CREATED': return { title: t('Ticket created') };
        case 'COMMENT': return { title: t('New comment'), detail: content };
        case 'INTERNAL_NOTE': return { title: t('Internal note'), detail: content };
        case 'REMINDER': return { title: t('Ticket reminder'), detail: content };
        default: return { title: content ?? n.type.replace(/_/g, ' ').toLowerCase() };
    }
}
