import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { auditLog } from '@/lib/audit';
import logger from '@/lib/logger';
import { OidcConfigError } from '@/lib/oidc-provider';
import { SettingsValidationError } from '@/lib/settings-validation';
import { buildOidcCandidate, normalizeOidcSetting, oidcKeys, type OidcPrefix, type SettingValue } from '@/lib/sso-settings';
import { TlsMaterialError } from '@/lib/tls-material';
import { testOidcDiscovery } from '../../../../../scripts/oidc-discovery.mjs';

/**
 * "Test SSO configuration": checks an OpenID Connect slot with optional unsaved values, without
 * saving anything and without sending client credentials.
 */
export async function POST(request: Request) {
    const session = await auth();
    if (!session?.user || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    try {
        const body = await request.json().catch(() => null) as { slot?: unknown; values?: unknown } | null;
        const prefix: OidcPrefix = body?.slot === 'oidc_next' ? 'oidc_next' : 'oidc';
        const raw = body?.values && typeof body.values === 'object' && !Array.isArray(body.values) ? body.values as Record<string, unknown> : {};
        const submitted = new Map<string, SettingValue>(Object.entries(raw)
            .filter(([key]) => oidcKeys(prefix).includes(key))
            .map(([key, value]) => [key, normalizeOidcSetting(key, value)]));
        const candidate = await buildOidcCandidate(prefix, submitted);
        const result = await testOidcDiscovery({ issuer: candidate.issuer, authMethod: candidate.authMethod, caCertificates: candidate.caCertificates });
        await auditLog({ userId: session.user.id, action: result.success ? 'sso.test_succeeded' : 'sso.test_failed', entity: 'auth', metadata: { slot: prefix, stage: result.stage } });
        return NextResponse.json(result, { status: result.success ? 200 : 502 });
    } catch (error) {
        if (error instanceof SettingsValidationError || error instanceof OidcConfigError || error instanceof TlsMaterialError) {
            return NextResponse.json({ success: false, stage: 'configuration', message: error.message }, { status: 400 });
        }
        logger.error('SSO configuration test failed', { error });
        return NextResponse.json({ success: false, stage: 'configuration', message: 'The configuration could not be tested.' }, { status: 500 });
    }
}
