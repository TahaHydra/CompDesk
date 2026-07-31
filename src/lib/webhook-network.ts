import dns from 'node:dns/promises';
import net from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
    'localhost',
    'localhost.localdomain',
    'metadata.google.internal',
    'metadata.azure.internal',
    'instance-data.ec2.internal',
]);

export class WebhookDestinationError extends Error {
    constructor(public stage: 'url' | 'dns' | 'private_network', message: string) {
        super(message);
        this.name = 'WebhookDestinationError';
    }
}

function ipv4Number(address: string): number | null {
    if (net.isIP(address) !== 4) return null;
    return address.split('.').reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function inIpv4Range(value: number, network: number, prefix: number): boolean {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (network & mask);
}

function ipv6Parts(address: string): number[] | null {
    const clean = address.toLowerCase().split('%')[0];
    if (net.isIP(clean) !== 6) return null;
    let candidate = clean;
    const dotted = candidate.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) {
        const mapped = ipv4Number(dotted[2]);
        if (mapped === null) return null;
        candidate = `${dotted[1]}${((mapped >>> 16) & 0xffff).toString(16)}:${(mapped & 0xffff).toString(16)}`;
    }
    const halves = candidate.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
    const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
    const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
    const rawParts = [...left, ...Array(Math.max(0, fill)).fill('0'), ...right];
    if (rawParts.length !== 8) return null;
    const parts = rawParts.map((part) => Number.parseInt(part || '0', 16));
    return parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff) ? parts : null;
}

export function isPublicIpAddress(address: string): boolean {
    const ipv4 = ipv4Number(address);
    if (ipv4 !== null) {
        const blocked: Array<[number, number]> = [
            [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
            [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
            [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24], [0xcb007100, 24],
            [0xe0000000, 4], [0xf0000000, 4],
        ];
        return !blocked.some(([network, prefix]) => inIpv4Range(ipv4, network, prefix));
    }
    const parts = ipv6Parts(address);
    if (!parts) return false;
    const mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
    if (mapped) {
        const value = ((parts[6] << 16) | parts[7]) >>> 0;
        return isPublicIpAddress(`${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`);
    }
    const unspecified = parts.every((part) => part === 0);
    const loopback = parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1;
    const uniqueLocal = (parts[0] & 0xfe00) === 0xfc00;
    const linkLocal = (parts[0] & 0xffc0) === 0xfe80;
    const multicast = (parts[0] & 0xff00) === 0xff00;
    const documentation = parts[0] === 0x2001 && parts[1] === 0x0db8;
    const benchmarking = parts[0] === 0x2001 && parts[1] === 0x0002;
    const orchid = parts[0] === 0x2001 && (parts[1] & 0xfff0) === 0x0010;
    return !(unspecified || loopback || uniqueLocal || linkLocal || multicast || documentation || benchmarking || orchid);
}
export interface ResolvedWebhookDestination {
    url: URL;
    address: string;
    family: 4 | 6;
}

type Lookup = typeof dns.lookup;

export async function resolveWebhookDestination(input: string, lookup: Lookup = dns.lookup): Promise<ResolvedWebhookDestination> {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new WebhookDestinationError('url', 'Enter a valid HTTPS webhook URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
        throw new WebhookDestinationError('url', 'Webhook URLs must use HTTPS and cannot contain credentials or fragments.');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) {
        throw new WebhookDestinationError('private_network', 'Webhook destinations cannot use local or metadata hostnames.');
    }
    let addresses: Array<{ address: string; family: number }>;
    if (net.isIP(hostname)) {
        addresses = [{ address: hostname, family: net.isIP(hostname) }];
    } else {
        try {
            addresses = await lookup(hostname, { all: true, verbatim: true });
        } catch {
            throw new WebhookDestinationError('dns', 'The webhook hostname could not be resolved.');
        }
    }
    if (addresses.length === 0) throw new WebhookDestinationError('dns', 'The webhook hostname did not resolve to an address.');
    if (addresses.some(({ address }) => !isPublicIpAddress(address))) {
        throw new WebhookDestinationError('private_network', 'Webhook destinations must resolve only to public Internet addresses.');
    }
    const selected = addresses[0];
    return { url, address: selected.address, family: selected.family === 6 ? 6 : 4 };
}
