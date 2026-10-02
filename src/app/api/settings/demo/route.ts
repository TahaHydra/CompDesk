import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDemoState, installDemoData, removeDemoData } from '@/lib/demo-service';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const privilegedUser = async () => {
    const session = await auth();
    return session?.user.role === 'SUPER_ADMIN' ? session.user.id : null;
};
function failure(error: unknown) {
    const problem = error as { statusCode?: number; message?: string };
    return json({ error: problem.statusCode ? problem.message : 'Could not manage demo data. No partial database changes were committed.' }, problem.statusCode || 500);
}

export async function GET() {
    if (!await privilegedUser()) return json({ error: 'Super Admin privileges required' }, 403);
    try { return json(await getDemoState()); } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
    const userId = await privilegedUser();
    if (!userId) return json({ error: 'Super Admin privileges required' }, 403);
    const body = await request.json().catch(() => null);
    if (body?.confirmation !== 'INSTALL-DEMO-DATA') return json({ error: 'Explicit demo installation confirmation is required.' }, 400);
    try { return json(await installDemoData(userId)); } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
    const userId = await privilegedUser();
    if (!userId) return json({ error: 'Super Admin privileges required' }, 403);
    const body = await request.json().catch(() => null);
    if (body?.confirmation !== 'REMOVE-DEMO-DATA') return json({ error: 'Explicit demo removal confirmation is required.' }, 400);
    try { return json(await removeDemoData(userId)); } catch (error) { return failure(error); }
}
