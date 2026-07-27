import crypto from 'crypto';
import logger from '@/lib/logger';
import { classifyNetworkError, type NetworkFailureCategory } from '@/lib/network-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const METADATA_TEMPLATE = 'https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration';

export type EntraDiagnosticStage = 'provider_configuration' | 'dns_resolution' | 'tcp_connectivity' | 'tls_certificate' | 'timeout' | 'http_response' | 'malformed_metadata' | 'metadata_validation' | 'success';
export interface EntraDiagnosticResult {
    success: boolean;
    correlationId: string;
    stage: EntraDiagnosticStage;
    message: string;
    presence: { clientId: boolean; clientSecret: boolean; tenantId: boolean; authUrl: boolean; authSecret: boolean };
    format: { clientId: boolean; tenantId: boolean; authUrl: boolean };
    metadataUrl: string;
    expectedCallbackUri: string | null;
    metadata?: { issuer: boolean; authorizationEndpoint: boolean; tokenEndpoint: boolean; jwksUri: boolean };
    httpStatus?: number;
    networkCategory?: NetworkFailureCategory;
}

interface DiagnosticOptions {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    correlationId?: string;
}

function validHttps(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function publicAuthOrigin(value: string): string | null {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
        return url.origin;
    } catch { return null; }
}

function networkStage(category: NetworkFailureCategory): EntraDiagnosticStage {
    if (category === 'dns') return 'dns_resolution';
    if (category === 'timeout') return 'timeout';
    if (category === 'tls_certificate') return 'tls_certificate';
    return 'tcp_connectivity';
}

export async function diagnoseEntraRuntime(options: DiagnosticOptions = {}): Promise<EntraDiagnosticResult> {
    const env = options.env ?? process.env;
    const correlationId = options.correlationId ?? crypto.randomUUID();
    const clientId = env.AZURE_AD_CLIENT_ID?.trim() ?? '';
    const clientSecret = env.AZURE_AD_CLIENT_SECRET?.trim() ?? '';
    const tenantId = env.AZURE_AD_TENANT_ID?.trim() ?? '';
    const authUrlValue = env.AUTH_URL?.trim() || env.NEXTAUTH_URL?.trim() || '';
    const authSecret = env.AUTH_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || '';
    const authOrigin = publicAuthOrigin(authUrlValue);
    const presence = { clientId: Boolean(clientId), clientSecret: Boolean(clientSecret), tenantId: Boolean(tenantId), authUrl: Boolean(authUrlValue), authSecret: Boolean(authSecret) };
    const format = { clientId: UUID.test(clientId), tenantId: UUID.test(tenantId) || TENANT_DOMAIN.test(tenantId), authUrl: Boolean(authOrigin) };
    const base = { correlationId, presence, format, metadataUrl: METADATA_TEMPLATE, expectedCallbackUri: authOrigin ? `${authOrigin}/api/auth/callback/microsoft-entra-id` : null };
    if (!Object.values(presence).every(Boolean)) return { ...base, success: false, stage: 'provider_configuration', message: 'One or more required Entra or Auth.js runtime variables are missing.' };
    if (!format.clientId || !format.tenantId || !format.authUrl) return { ...base, success: false, stage: 'provider_configuration', message: 'Client ID, Tenant ID, or AUTH_URL has an invalid format.' };

    const metadataUrl = `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Entra metadata request timed out')), options.timeoutMs ?? 7000);
    let response: Response;
    try {
        response = await (options.fetchImpl ?? fetch)(metadataUrl, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal: controller.signal });
    } catch (error) {
        const failure = classifyNetworkError(error);
        return { ...base, success: false, stage: networkStage(failure.category), networkCategory: failure.category, message: failure.message };
    } finally { clearTimeout(timeout); }
    if (!response.ok) return { ...base, success: false, stage: 'http_response', httpStatus: response.status, message: `The metadata endpoint returned HTTP ${response.status}.` };

    let metadata: Record<string, unknown>;
    try {
        const parsed: unknown = await response.json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Metadata is not an object');
        metadata = parsed as Record<string, unknown>;
    } catch {
        return { ...base, success: false, stage: 'malformed_metadata', message: 'The metadata endpoint did not return valid JSON metadata.' };
    }
    const checks = {
        issuer: validHttps(metadata.issuer),
        authorizationEndpoint: validHttps(metadata.authorization_endpoint),
        tokenEndpoint: validHttps(metadata.token_endpoint),
        jwksUri: validHttps(metadata.jwks_uri),
    };
    if (!Object.values(checks).every(Boolean)) return { ...base, success: false, stage: 'metadata_validation', metadata: checks, message: 'OIDC metadata is missing one or more required HTTPS endpoints.' };
    return { ...base, success: true, stage: 'success', metadata: checks, httpStatus: response.status, message: 'OIDC metadata is reachable and structurally valid.' };
}

let startupDiagnosticScheduled = false;
export function scheduleEntraStartupDiagnostic(): void {
    const anyEntraVariable = Boolean(process.env.AZURE_AD_CLIENT_ID || process.env.AZURE_AD_CLIENT_SECRET || process.env.AZURE_AD_TENANT_ID);
    if (startupDiagnosticScheduled || !anyEntraVariable || process.env.NODE_ENV === 'test') return;
    startupDiagnosticScheduled = true;
    void diagnoseEntraRuntime().then((result) => {
        if (!result.success) logger.warn('Entra metadata startup diagnostic failed; local login remains available when enabled', { correlationId: result.correlationId, stage: result.stage, category: result.networkCategory, httpStatus: result.httpStatus });
    }).catch(() => undefined);
}