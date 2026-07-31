import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import { diagnoseEntraRuntime } from '@/lib/entra-diagnostic';
import logger from '@/lib/logger';

export async function POST() {
    const session = await auth();
    if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const result = await diagnoseEntraRuntime();
    const logData = { correlationId: result.correlationId, stage: result.stage, category: result.networkCategory, httpStatus: result.httpStatus };
    if (result.success) logger.info('Entra diagnostic succeeded', logData);
    else logger.warn('Entra diagnostic failed', logData);
    await auditLog({ userId: session.user.id, action: result.success ? 'entra.diagnostic_succeeded' : 'entra.diagnostic_failed', entity: 'auth', metadata: logData });
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
}