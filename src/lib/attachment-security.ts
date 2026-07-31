import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { AttachmentScanStatus } from '@prisma/client';

const MEBIBYTE = 1024 * 1024;
const DECLARED_TYPES: Record<string, { extension: string; kind: string }> = {
    'image/jpeg': { extension: '.jpg', kind: 'jpeg' },
    'image/png': { extension: '.png', kind: 'png' },
    'image/gif': { extension: '.gif', kind: 'gif' },
    'image/webp': { extension: '.webp', kind: 'webp' },
    'image/bmp': { extension: '.bmp', kind: 'bmp' },
    'application/pdf': { extension: '.pdf', kind: 'pdf' },
    'application/msword': { extension: '.doc', kind: 'ole' },
    'application/vnd.ms-excel': { extension: '.xls', kind: 'ole' },
    'application/vnd.ms-powerpoint': { extension: '.ppt', kind: 'ole' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: '.docx', kind: 'docx' },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: '.xlsx', kind: 'xlsx' },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { extension: '.pptx', kind: 'pptx' },
    'application/zip': { extension: '.zip', kind: 'zip' },
    'application/x-rar-compressed': { extension: '.rar', kind: 'rar' },
    'application/vnd.rar': { extension: '.rar', kind: 'rar' },
    'application/x-7z-compressed': { extension: '.7z', kind: '7z' },
    'text/plain': { extension: '.txt', kind: 'text' },
    'text/csv': { extension: '.csv', kind: 'text' },
};

export class AttachmentValidationError extends Error {
    constructor(public code: 'TYPE' | 'MALWARE' | 'SCAN' | 'SIZE' | 'QUOTA', message: string) {
        super(message);
        this.name = 'AttachmentValidationError';
    }
}

export interface MalwareScanResult {
    status: AttachmentScanStatus;
    scannedAt: Date | null;
}

export interface AttachmentInspection extends MalwareScanResult {
    filename: string;
    declaredMimetype: string;
    detectedMimetype: string;
    extension: string;
    sha256: string;
}

export interface MalwareScanner {
    scan(buffer: Buffer): Promise<MalwareScanResult>;
}

function positiveNumber(name: string, fallback: number): number {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function attachmentLimits() {
    return {
        maxFileBytes: positiveNumber('UPLOAD_MAX_SIZE_MB', 10) * MEBIBYTE,
        maxFilesPerTicket: positiveNumber('ATTACHMENT_MAX_FILES_PER_TICKET', 20),
        maxBytesPerTicket: positiveNumber('ATTACHMENT_MAX_BYTES_PER_TICKET', 100 * MEBIBYTE),
        globalMaxBytes: positiveNumber('ATTACHMENT_GLOBAL_MAX_BYTES', 10 * 1024 * MEBIBYTE),
    };
}

export function allowedAttachmentType(mimetype: string) {
    return DECLARED_TYPES[mimetype] ?? null;
}

function begins(buffer: Buffer, signature: number[]): boolean {
    return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

function isZip(buffer: Buffer): boolean {
    return begins(buffer, [0x50, 0x4b, 0x03, 0x04])
        || begins(buffer, [0x50, 0x4b, 0x05, 0x06])
        || begins(buffer, [0x50, 0x4b, 0x07, 0x08]);
}

function isUtf8Text(buffer: Buffer): boolean {
    if (buffer.includes(0)) return false;
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(buffer);
        return true;
    } catch {
        return false;
    }
}

function zipContains(buffer: Buffer, marker: string): boolean {
    return buffer.includes(Buffer.from(marker, 'utf8'));
}

function contentMatches(kind: string, buffer: Buffer): boolean {
    if (kind === 'png') return begins(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (kind === 'jpeg') return begins(buffer, [0xff, 0xd8, 0xff]);
    if (kind === 'gif') return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a';
    if (kind === 'webp') return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    if (kind === 'bmp') return buffer.subarray(0, 2).toString('ascii') === 'BM';
    if (kind === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    if (kind === 'ole') return begins(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    if (kind === 'zip') return isZip(buffer);
    if (kind === 'docx') return isZip(buffer) && zipContains(buffer, '[Content_Types].xml') && zipContains(buffer, 'word/');
    if (kind === 'xlsx') return isZip(buffer) && zipContains(buffer, '[Content_Types].xml') && zipContains(buffer, 'xl/');
    if (kind === 'pptx') return isZip(buffer) && zipContains(buffer, '[Content_Types].xml') && zipContains(buffer, 'ppt/');
    if (kind === 'rar') return begins(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]) || begins(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    if (kind === '7z') return begins(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    if (kind === 'text') return isUtf8Text(buffer);
    return false;
}

export function safeAttachmentName(originalName: string, extension: string): string {
    const basename = path.basename(originalName).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    const withoutExtension = basename.slice(0, Math.max(0, basename.length - path.extname(basename).length));
    const safeBase = withoutExtension.replace(/[<>:"/\\|?*]+/g, '_').trim().slice(0, 240) || 'attachment';
    return `${safeBase}${extension}`;
}

class ClamAvScanner implements MalwareScanner {
    async scan(buffer: Buffer): Promise<MalwareScanResult> {
        const host = process.env.CLAMAV_HOST?.trim();
        if (!host) return { status: AttachmentScanStatus.NOT_CONFIGURED, scannedAt: null };
        const port = positiveNumber('CLAMAV_PORT', 3310);
        const timeoutMs = positiveNumber('CLAMAV_TIMEOUT_MS', 10_000);
        return new Promise((resolve) => {
            let settled = false;
            let response = '';
            const finish = (status: AttachmentScanStatus) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve({ status, scannedAt: new Date() });
            };
            const socket = net.createConnection({ host, port });
            socket.setTimeout(timeoutMs);
            socket.on('connect', () => {
                socket.write('zINSTREAM\0');
                for (let offset = 0; offset < buffer.length; offset += 64 * 1024) {
                    const chunk = buffer.subarray(offset, Math.min(offset + 64 * 1024, buffer.length));
                    const length = Buffer.allocUnsafe(4);
                    length.writeUInt32BE(chunk.length);
                    socket.write(length);
                    socket.write(chunk);
                }
                socket.write(Buffer.alloc(4));
            });
            socket.on('data', (chunk) => {
                response = `${response}${chunk.toString('utf8')}`.slice(-2048);
                if (response.includes('FOUND')) finish(AttachmentScanStatus.INFECTED);
                else if (response.includes('OK')) finish(AttachmentScanStatus.CLEAN);
                else if (response.includes('\0')) finish(AttachmentScanStatus.ERROR);
            });
            socket.on('timeout', () => finish(AttachmentScanStatus.ERROR));
            socket.on('error', () => finish(AttachmentScanStatus.ERROR));
            socket.on('end', () => {
                if (response.includes('FOUND')) finish(AttachmentScanStatus.INFECTED);
                else if (response.includes('OK')) finish(AttachmentScanStatus.CLEAN);
                else finish(AttachmentScanStatus.ERROR);
            });
        });
    }
}

export async function inspectAttachment(
    originalName: string,
    declaredMimetype: string,
    buffer: Buffer,
    scanner: MalwareScanner = new ClamAvScanner()
): Promise<AttachmentInspection> {
    const type = allowedAttachmentType(declaredMimetype);
    if (!type) throw new AttachmentValidationError('TYPE', `File type not allowed: ${declaredMimetype || 'unknown'}`);
    const limits = attachmentLimits();
    if (buffer.length === 0 || buffer.length > limits.maxFileBytes) {
        throw new AttachmentValidationError('SIZE', `Files must be between 1 byte and ${Math.floor(limits.maxFileBytes / MEBIBYTE)} MB`);
    }
    if (!contentMatches(type.kind, buffer)) {
        throw new AttachmentValidationError('TYPE', 'The uploaded file content does not match its declared type');
    }
    const scan = await scanner.scan(buffer);
    if (scan.status === AttachmentScanStatus.INFECTED) {
        throw new AttachmentValidationError('MALWARE', 'The uploaded file was rejected by malware scanning');
    }
    if (scan.status === AttachmentScanStatus.ERROR) {
        throw new AttachmentValidationError('SCAN', 'Malware scanning is temporarily unavailable');
    }
    return {
        ...scan,
        filename: safeAttachmentName(originalName, type.extension),
        declaredMimetype,
        detectedMimetype: declaredMimetype,
        extension: type.extension,
        sha256: createHash('sha256').update(buffer).digest('hex'),
    };
}

export function isAttachmentDownloadable(status: AttachmentScanStatus): boolean {
    return status === AttachmentScanStatus.CLEAN || status === AttachmentScanStatus.NOT_CONFIGURED;
}
