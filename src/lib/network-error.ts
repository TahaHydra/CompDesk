export type NetworkFailureCategory = 'dns' | 'tcp_connectivity' | 'tls_certificate' | 'timeout' | 'proxy_connect' | 'authentication' | 'unknown';

export interface NetworkFailure {
    category: NetworkFailureCategory;
    code?: string;
    message: string;
}

function collectErrorSignals(error: unknown): { codes: string[]; messages: string[] } {
    const codes: string[] = [];
    const messages: string[] = [];
    const visited = new Set<unknown>();
    let current: unknown = error;
    for (let depth = 0; depth < 10 && current && !visited.has(current); depth += 1) {
        visited.add(current);
        if (current instanceof Error) messages.push(current.message);
        if (typeof current === 'object') {
            const record = current as Record<string, unknown>;
            if (typeof record.code === 'string') codes.push(record.code.toUpperCase());
            if (typeof record.errno === 'string') codes.push(record.errno.toUpperCase());
            if (typeof record.message === 'string' && !messages.includes(record.message)) messages.push(record.message);
            current = record.cause;
        } else break;
    }
    return { codes, messages };
}

export function classifyNetworkError(error: unknown): NetworkFailure {
    const { codes, messages } = collectErrorSignals(error);
    const text = `${codes.join(' ')} ${messages.join(' ')}`.toLowerCase();
    const code = codes[0];
    if (/enotfound|eai_again|dns|getaddrinfo/.test(text)) return { category: 'dns', code, message: 'DNS resolution failed for the configured service host.' };
    if (/aborterror|aborted|etimedout|timeout|und_err_connect_timeout/.test(text)) return { category: 'timeout', code, message: 'The connection attempt exceeded the configured timeout.' };
    if (/certificate|cert_|self_signed|unable_to_verify|altname|expired|tls|ssl/.test(text)) return { category: 'tls_certificate', code, message: 'TLS negotiation or certificate validation failed.' };
    if (/eauth|authentication|invalid login|535|534/.test(text)) return { category: 'authentication', code, message: 'The remote service rejected authentication.' };
    if (/proxy|tunnel|407/.test(text)) return { category: 'proxy_connect', code, message: 'A proxy or CONNECT tunnel failed.' };
    if (/econnrefused|econnreset|ehostunreach|enetunreach|eacces|esocket|connect/.test(text)) return { category: 'tcp_connectivity', code, message: 'TCP connectivity to the configured service failed.' };
    return { category: 'unknown', code, message: 'The remote service request failed for an unclassified reason.' };
}