export async function register() {
    if (process.env.NODE_ENV === 'test' || process.env.NEXT_PHASE === 'phase-production-build') return;
    // A positive NEXT_RUNTIME check lets the bundler drop these Node-only imports from the edge
    // build; a negative check does not, and breaks `next dev`.
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { startWebhookDeliveryWorker } = await import('./lib/webhooks');
        startWebhookDeliveryWorker();
        const { startTicketReminderWorker } = await import('./lib/ticket-reminders');
        startTicketReminderWorker();
    }
}
