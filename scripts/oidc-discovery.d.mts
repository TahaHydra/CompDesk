export class OidcTransportError extends Error {}
export function discoveryUrl(issuer: string): string;
export function assertSecureDiscoveryMetadata(metadata: unknown, env?: { NODE_ENV?: string }): void;
export function createTrustedFetch(caCertificates: string[]): typeof fetch;
export interface OidcDiscoveryResult {
    success: boolean;
    stage: 'configuration' | 'discovery' | 'metadata' | 'success';
    message: string;
    endpoints?: { authorization: string; token: string; userinfo: string };
}
export function testOidcDiscovery(input: {
    issuer: string;
    authMethod?: string;
    caCertificates?: string[];
    fetchImpl?: typeof fetch;
    env?: { NODE_ENV?: string };
    timeoutMs?: number;
}): Promise<OidcDiscoveryResult>;
