import crypto from 'crypto';
import fs from 'fs';

export class TlsMaterialError extends Error {}

const MAX_PEM_BYTES = 64 * 1024;
const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** Accepts real newlines, CRLF, or literal `\n` escapes (single-line environment values). */
export function normalizePem(value: string): string {
    return value.replace(/\\n/g, '\n').replace(/\r\n?/g, '\n').trim();
}

function boundedPem(value: string, label: string): string {
    const pem = normalizePem(value);
    if (Buffer.byteLength(pem, 'utf8') > MAX_PEM_BYTES) throw new TlsMaterialError(`${label} is larger than 64 KB.`);
    return pem;
}

export function parseCertificates(value: string, label = 'Certificate'): crypto.X509Certificate[] {
    const blocks = boundedPem(value, label).match(CERTIFICATE_BLOCK) ?? [];
    if (blocks.length === 0) throw new TlsMaterialError(`${label} must contain at least one PEM "BEGIN CERTIFICATE" block.`);
    try { return blocks.map((block) => new crypto.X509Certificate(block)); }
    catch { throw new TlsMaterialError(`${label} contains an invalid PEM certificate.`); }
}

export function parsePrivateKey(value: string, label = 'Private key'): crypto.KeyObject {
    const pem = boundedPem(value, label);
    if (/-----BEGIN ENCRYPTED|Proc-Type:\s*4,ENCRYPTED/.test(pem)) throw new TlsMaterialError(`${label} is passphrase-protected. Provide an unencrypted PEM key and protect it with file permissions.`);
    try { return crypto.createPrivateKey({ key: pem, format: 'pem' }); }
    catch { throw new TlsMaterialError(`${label} is not a valid PEM private key.`); }
}

export function assertKeyMatchesCertificate(certificate: crypto.X509Certificate, key: crypto.KeyObject): void {
    if (!certificate.checkPrivateKey(key)) throw new TlsMaterialError('The private key does not match the certificate.');
}

export function describeCertificate(certificate: crypto.X509Certificate): { subject: string; validTo: string; expired: boolean } {
    const validTo = new Date(certificate.validTo);
    return { subject: certificate.subject.replace(/\n/g, ', '), validTo: validTo.toISOString(), expired: validTo.getTime() < Date.now() };
}

/** Resolves a PEM from an inline value or a `*_FILE` path (Docker/Kubernetes secrets). */
export function readPemSource(value: string | undefined, filePath: string | undefined): string | undefined {
    if (value?.trim()) return normalizePem(value);
    if (!filePath?.trim()) return undefined;
    try { return normalizePem(fs.readFileSync(filePath.trim(), 'utf8')); }
    catch { throw new TlsMaterialError(`Could not read ${filePath.trim()}.`); }
}
