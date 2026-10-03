import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { readinessChecks } from '@/lib/health';
import { canInspectUpdates, type UpdateHealth } from '@/lib/updates';

export const dynamic = 'force-dynamic';

export async function GET() {
    const session = await auth();
    if (!session?.user || !canInspectUpdates(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const checks = await readinessChecks().catch(() => null);
    const state: UpdateHealth = {
        application: true,
        database: checks?.database ?? null, installation: checks?.installation ?? null,
        migrations: checks?.migrations ?? null, storage: checks?.privateStorage ?? null,
        // Backup scripts run outside the app; there is no verified managed recovery registry.
        recoveryPoint: null, previousVersion: null, lastSuccessfulUpdate: null,
    };
    return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } });
}
