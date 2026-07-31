export async function register() {
    if (process.env.NEXT_RUNTIME === 'edge'
        || process.env.NODE_ENV === 'test'
        || process.env.NEXT_PHASE === 'phase-production-build') return;
    const { startWebhookDeliveryWorker } = await import('./lib/webhooks');
    startWebhookDeliveryWorker();
}