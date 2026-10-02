import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { decryptSettingSecret } from '@/lib/settings-secret';

export const graphMailSchema = z.object({ tenantId: z.string().uuid(), clientId: z.string().uuid(), sender: z.string().email().max(320), secret: z.string().min(1).max(4096) });
export type GraphMailConfig = z.infer<typeof graphMailSchema>;
type Mail = { to: string; subject: string; html: string; text?: string };
let cached: { key: string; expiresAt: number; token: string } | undefined;
let pending: { key: string; promise: Promise<string> } | undefined;
export function resetGraphMailTokenCache() { cached = pending = undefined; }

export async function getMailSettings(): Promise<Record<string, string>> {
    const values = await prisma.appSetting.findMany({ where: { key: { startsWith: 'mail_' } } });
    return Object.fromEntries(values.map(({ key, value }) => [key, value]));
}
export function mailProvider(settings: Record<string, string>): 'smtp' | 'graph' {
    return (process.env.COMPDESK_MAIL_PROVIDER || settings.mail_provider) === 'graph' ? 'graph' : 'smtp';
}
export function graphMailConfig(settings: Record<string, string>): GraphMailConfig {
    return graphMailSchema.parse({ tenantId: process.env.COMPDESK_GRAPH_TENANT_ID || settings.mail_graph_tenant_id, clientId: process.env.COMPDESK_GRAPH_CLIENT_ID || settings.mail_graph_client_id, sender: process.env.COMPDESK_GRAPH_SENDER || settings.mail_graph_sender, secret: process.env.COMPDESK_GRAPH_CLIENT_SECRET || (settings.mail_graph_secret ? decryptSettingSecret(settings.mail_graph_secret) : '') });
}
async function token(config: GraphMailConfig): Promise<string> {
    const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
    if (cached?.key === key && cached.expiresAt > Date.now()) return cached.token;
    if (pending?.key === key) return pending.promise;
    const promise = (async () => {
        const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.secret, scope: 'https://graph.microsoft.com/.default' });
        const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, { method: 'POST', body, signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store' });
        if (!response.ok) throw new Error(`Microsoft 365 authentication failed (HTTP ${response.status}).`);
        const data = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).parse(await response.json());
        cached = { key, token: data.access_token, expiresAt: Date.now() + Math.max(0, Math.min(data.expires_in, 86400) - 60) * 1000 };
        return data.access_token;
    })();
    pending = { key, promise };
    try { return await promise; } finally { if (pending?.promise === promise) pending = undefined; }
}
/** 202 is provider acceptance, not proof of delivery. One recipient per message. */
export async function sendGraphMail(mail: Mail, input: GraphMailConfig): Promise<void> {
    const config = graphMailSchema.parse(input);
    const accessToken = await token(config);
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { subject: mail.subject, body: { contentType: 'HTML', content: mail.html }, toRecipients: [{ emailAddress: { address: mail.to } }] }, saveToSentItems: true }),
    });
    if (response.status !== 202) { if (response.status === 401) resetGraphMailTokenCache(); throw new Error(`Microsoft 365 mail was not accepted (HTTP ${response.status}).`); }
}
