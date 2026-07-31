import fs from 'node:fs';
import path from 'node:path';
import { AttachmentScanStatus } from '@prisma/client';
import {
    AttachmentValidationError,
    attachmentLimits,
    inspectAttachment,
    isAttachmentDownloadable,
    safeAttachmentName,
    type MalwareScanner,
} from '@/lib/attachment-security';

const root = path.resolve(__dirname, '..', '..');
const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

function scanner(status: AttachmentScanStatus): MalwareScanner {
    return { scan: jest.fn().mockResolvedValue({ status, scannedAt: status === AttachmentScanStatus.NOT_CONFIGURED ? null : new Date(0) }) };
}

describe('attachment security hardening', () => {
    it('accepts content whose signature matches the declared type', async () => {
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('data')]);
        const result = await inspectAttachment('../unsafe name.exe', 'image/png', png, scanner(AttachmentScanStatus.CLEAN));
        expect(result.filename).toBe('unsafe name.png');
        expect(result.detectedMimetype).toBe('image/png');
        expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.status).toBe(AttachmentScanStatus.CLEAN);
    });

    it('rejects MIME spoofing for binary, Office, archive, and text inputs', async () => {
        const clean = scanner(AttachmentScanStatus.CLEAN);
        await expect(inspectAttachment('fake.pdf', 'application/pdf', Buffer.from('MZ executable'), clean))
            .rejects.toMatchObject({ code: 'TYPE' });
        await expect(inspectAttachment('fake.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK\x03\x04not-office'), clean))
            .rejects.toMatchObject({ code: 'TYPE' });
        await expect(inspectAttachment('fake.zip', 'application/zip', Buffer.from('not-a-zip'), clean))
            .rejects.toMatchObject({ code: 'TYPE' });
        await expect(inspectAttachment('fake.txt', 'text/plain', Buffer.from([0, 1, 2]), clean))
            .rejects.toMatchObject({ code: 'TYPE' });
    });

    it('rejects infected files and fails closed when configured scanning errors', async () => {
        await expect(inspectAttachment('note.txt', 'text/plain', Buffer.from('EICAR simulation'), scanner(AttachmentScanStatus.INFECTED)))
            .rejects.toEqual(expect.objectContaining<Partial<AttachmentValidationError>>({ code: 'MALWARE' }));
        await expect(inspectAttachment('note.txt', 'text/plain', Buffer.from('safe'), scanner(AttachmentScanStatus.ERROR)))
            .rejects.toEqual(expect.objectContaining<Partial<AttachmentValidationError>>({ code: 'SCAN' }));
        expect(isAttachmentDownloadable(AttachmentScanStatus.INFECTED)).toBe(false);
        expect(isAttachmentDownloadable(AttachmentScanStatus.ERROR)).toBe(false);
    });

    it('allows the documented optional-scanner state without claiming a scan passed', async () => {
        const result = await inspectAttachment('note.txt', 'text/plain', Buffer.from('safe'), scanner(AttachmentScanStatus.NOT_CONFIGURED));
        expect(result.status).toBe(AttachmentScanStatus.NOT_CONFIGURED);
        expect(result.scannedAt).toBeNull();
        expect(isAttachmentDownloadable(result.status)).toBe(true);
    });

    it('uses bounded configurable per-file, ticket, and global quotas', () => {
        const before = {
            file: process.env.UPLOAD_MAX_SIZE_MB,
            count: process.env.ATTACHMENT_MAX_FILES_PER_TICKET,
            ticket: process.env.ATTACHMENT_MAX_BYTES_PER_TICKET,
            global: process.env.ATTACHMENT_GLOBAL_MAX_BYTES,
        };
        Object.assign(process.env, {
            UPLOAD_MAX_SIZE_MB: '2',
            ATTACHMENT_MAX_FILES_PER_TICKET: '3',
            ATTACHMENT_MAX_BYTES_PER_TICKET: '4000',
            ATTACHMENT_GLOBAL_MAX_BYTES: '5000',
        });
        try {
            expect(attachmentLimits()).toEqual({
                maxFileBytes: 2 * 1024 * 1024,
                maxFilesPerTicket: 3,
                maxBytesPerTicket: 4000,
                globalMaxBytes: 5000,
            });
        } finally {
            for (const [key, value] of Object.entries(before)) {
                const envKey = key === 'file' ? 'UPLOAD_MAX_SIZE_MB'
                    : key === 'count' ? 'ATTACHMENT_MAX_FILES_PER_TICKET'
                        : key === 'ticket' ? 'ATTACHMENT_MAX_BYTES_PER_TICKET'
                            : 'ATTACHMENT_GLOBAL_MAX_BYTES';
                if (value === undefined) delete process.env[envKey];
                else process.env[envKey] = value;
            }
        }
    });

    it('sanitizes stored display names and forces the verified extension', () => {
        expect(safeAttachmentName('../../report.exe', '.pdf')).toBe('report.pdf');
        expect(safeAttachmentName('bad<name>.txt', '.txt')).toBe('bad_name_.txt');
    });

    it('uses database reservations and advisory locks to prevent concurrent quota bypass', () => {
        const upload = read('src', 'app', 'api', 'upload', 'route.ts');
        const creation = read('src', 'lib', 'tickets', 'create-ticket.ts');
        expect(upload).toContain('temporaryAttachment.aggregate');
        expect(upload).toContain('pg_advisory_xact_lock');
        expect(upload).toContain('globalMaxBytes');
        expect(creation).toContain('pg_advisory_xact_lock');
        expect(creation).toContain('temporaryAttachment.findUnique');
        expect(creation).toContain("createHash('sha256')");
    });

    it('serves only authorized, nondeleted, nonquarantined files as downloads', () => {
        const route = read('src', 'app', 'api', 'upload', '[id]', 'route.ts');
        expect(route).toContain('canAccessTicket');
        expect(route).toContain('attachment.deletedAt');
        expect(route).toContain('isAttachmentDownloadable');
        expect(route).toContain("'Content-Disposition': `attachment;");
        expect(route).toContain("'X-Content-Type-Options': 'nosniff'");
        expect(route).not.toContain("const disposition =");
    });

    it('tombstones and audits attachment removal instead of deleting history', () => {
        const route = read('src', 'app', 'api', 'upload', '[id]', 'route.ts');
        expect(route).toContain('prisma.attachment.updateMany');
        expect(route).not.toContain('prisma.attachment.delete(');
        expect(route).toContain("action: 'attachment.removed'");
        expect(route).toContain('historyRetained: true');
    });

    it('adds scan metadata and temporary reservations through an upgrade migration', () => {
        const migration = read('prisma', 'migrations', '20260730213000_attachment_security', 'migration.sql');
        expect(migration).toContain('CREATE TYPE "AttachmentScanStatus"');
        expect(migration).toContain('CREATE TABLE "temporary_attachments"');
        expect(migration).toContain('"scan_status"');
        expect(migration).toContain('"uploader_id"');
    });
});
