import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { getBrandingConfig, saveBrandingConfig } from '@/lib/branding';

const schema = z.object({ showDemoAccounts: z.boolean(), demoAccountInfo: z.string().trim().max(1000) }).strict()
    .refine(value => !value.showDemoAccounts || Boolean(value.demoAccountInfo), { message: 'Provide safe demo instructions before enabling visibility.' });
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET() {
    if ((await auth())?.user.role !== 'SUPER_ADMIN') return json({ error: 'Super Admin privileges required' }, 403);
    const value = await getBrandingConfig();
    return json({ showDemoAccounts: value.showDemoAccounts, demoAccountInfo: value.demoAccountInfo });
}
export async function PATCH(request: Request) {
    const session = await auth();
    if (session?.user.role !== 'SUPER_ADMIN') return json({ error: 'Super Admin privileges required' }, 403);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Provide valid demo visibility settings and safe instructions.' }, 400);
    try {
        await saveBrandingConfig({ ...await getBrandingConfig(), ...parsed.data });
        await auditLog({ userId: session.user.id, action: 'demo.visibility.updated', entity: 'app_setting', metadata: { visible: parsed.data.showDemoAccounts } });
        return json(parsed.data);
    } catch { return json({ error: 'Could not save demo visibility' }, 500); }
}
