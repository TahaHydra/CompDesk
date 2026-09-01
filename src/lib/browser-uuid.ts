export function createBrowserUuid(): string {
    const secureCrypto = globalThis.crypto;
    if (!secureCrypto) throw new Error('Secure browser random number generation is unavailable.');

    if (typeof secureCrypto.randomUUID === 'function') {
        return secureCrypto.randomUUID();
    }
    if (typeof secureCrypto.getRandomValues !== 'function') {
        throw new Error('Secure browser random number generation is unavailable.');
    }

    const bytes = new Uint8Array(16);
    secureCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
