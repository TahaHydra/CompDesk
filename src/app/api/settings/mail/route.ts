import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { auditLog } from '@/lib/audit';
import { encryptSettingSecret } from '@/lib/settings-secret';
import { consumeDatabaseRateLimit } from '@/lib/database-rate-limit';
import { getMailSettings, graphMailConfig, mailProvider, sendGraphMail } from '@/lib/graph-mail';

const input = z.object({ provider: z.enum(['smtp', 'graph']), tenantId: z.string().uuid().or(z.literal('')), clientId: z.string().uuid().or(z.literal('')), sender: z.string().email().or(z.literal('')), secret: z.string().max(4096).optional() }).strict();
export async function GET() {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Super Admin privileges required' }, { status: 403 });
    const values = await getMailSettings();
    return NextResponse.json({ provider: mailProvider(values), tenantId: process.env.COMPDESK_GRAPH_TENANT_ID || values.mail_graph_tenant_id || '', clientId: process.env.COMPDESK_GRAPH_CLIENT_ID || values.mail_graph_client_id || '', sender: process.env.COMPDESK_GRAPH_SENDER || values.mail_graph_sender || '', secretConfigured: Boolean(process.env.COMPDESK_GRAPH_CLIENT_SECRET || values.mail_graph_secret), environmentProvider: Boolean(process.env.COMPDESK_MAIL_PROVIDER) }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PATCH(req: NextRequest) {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Super Admin privileges required' }, { status: 403 });
    try {
        const body = input.parse(await req.json());
        const values = await getMailSettings();
        const entries: Record<string, string> = { mail_provider: body.provider, mail_graph_tenant_id: body.tenantId, mail_graph_client_id: body.clientId, mail_graph_sender: body.sender };
        if (body.secret) entries.mail_graph_secret = encryptSettingSecret(body.secret);
        if (body.provider === 'graph') graphMailConfig({ ...values, ...entries });
        await prisma.$transaction(Object.entries(entries).map(([key, value]) => prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } })));
        await auditLog({ userId: session.user.id, action: 'mail.configuration_updated', entity: 'settings', metadata: { provider: body.provider } });
        return NextResponse.json({ success: true });
    } catch { return NextResponse.json({ error: 'Invalid mail configuration or unavailable encryption key' }, { status: 400 }); }
}
export async function POST(req: NextRequest) {
    const session = await auth();
    if (session?.user?.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Super Admin privileges required' }, { status: 403 });
    try {
        const { recipient } = z.object({ recipient: z.string().email() }).strict().parse(await req.json());
        const limit = await consumeDatabaseRateLimit('graph-mail-test', session.user.id, 5, 60000);
        if (!limit.allowed) return NextResponse.json({ error: 'Too many mail tests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } });
        const values = await getMailSettings();
        if (mailProvider(values) !== 'graph') return NextResponse.json({ error: 'Save Microsoft 365 mail settings first' }, { status: 400 });
        await sendGraphMail({ to: recipient, subject: 'CompDesk mail test', html: '<p>CompDesk Microsoft 365 mail configuration test.</p>' }, graphMailConfig(values));
        await auditLog({ userId: session.user.id, action: 'mail.test_accepted', entity: 'email', metadata: { provider: 'graph' } });
        return NextResponse.json({ accepted: true });
    } catch { return NextResponse.json({ error: 'Microsoft 365 test was not accepted. Check app credentials, mailbox scope and outbound HTTPS access.' }, { status: 502 }); }
}
