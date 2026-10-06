import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import logger from '@/lib/logger';
import { ManagedEnvironmentError } from '@/lib/managed-env';
import { cancelMigration, cutoverMigration, finishMigration, getMigrationProgress, rollbackMigration, SsoMigrationError, startMigration } from '@/lib/sso-migration';
import { parseSsoProvider, SSO_PROVIDER_OPTIONS } from '@/lib/sso-presets';
import { AuthenticationPolicyError } from '../../../../../scripts/auth-policy.mjs';

async function superAdmin() {
    const session = await auth();
    return session?.user?.role === 'SUPER_ADMIN' ? session.user : null;
}

export async function GET() {
    const user = await superAdmin();
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await getMigrationProgress(user.id));
}

export async function POST(request: Request) {
    const user = await superAdmin();
    if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const body = await request.json().catch(() => null) as { action?: unknown; target?: unknown; pruneOldBindings?: unknown } | null;
    try {
        let restartRequired = false;
        switch (body?.action) {
            case 'start':
                if (!SSO_PROVIDER_OPTIONS.includes(body.target as never)) return NextResponse.json({ error: 'Choose a valid target provider.' }, { status: 400 });
                await startMigration(parseSsoProvider(body.target), user.id);
                break;
            case 'cancel': await cancelMigration(user.id); break;
            case 'cutover': await cutoverMigration(user.id); break;
            case 'rollback': await rollbackMigration(user.id); break;
            case 'finish': restartRequired = (await finishMigration(user.id, { pruneOldBindings: body.pruneOldBindings === true })).restartRequired; break;
            default: return NextResponse.json({ error: 'Unknown migration action.' }, { status: 400 });
        }
        return NextResponse.json({ ...(await getMigrationProgress(user.id)), restartRequired });
    } catch (error) {
        if (error instanceof SsoMigrationError || error instanceof AuthenticationPolicyError || error instanceof ManagedEnvironmentError) {
            return NextResponse.json({ error: error.message }, { status: 409 });
        }
        logger.error('SSO migration action failed', { error, action: body?.action });
        return NextResponse.json({ error: 'The migration action failed.' }, { status: 500 });
    }
}
