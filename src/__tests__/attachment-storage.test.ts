import path from 'path';
import {
    attachmentStorageRoot,
    authenticatedAttachmentUrl,
    privateAttachmentLocation,
    resolveStoredAttachmentPath,
    resolveTemporaryAttachmentPath,
    temporaryAttachmentLimits,
    temporaryAttachmentLocation,
} from '@/lib/attachment-storage';

const userId = '550e8400-e29b-41d4-a716-446655440000';
const ticketId = '550e8400-e29b-41d4-a716-446655440001';
const filename = '0123456789abcdef.png';

describe('private attachment storage', () => {
    it('creates private final references and authenticated URLs', () => {
        const location = privateAttachmentLocation(ticketId, filename);
        expect(location.reference).toBe(`private/${ticketId}/${filename}`);
        expect(location.absolutePath).toBe(resolveStoredAttachmentPath(location.reference, ticketId));
        expect(authenticatedAttachmentUrl('attachment-id')).toBe('/api/upload/attachment-id');
        expect(location.absolutePath).toContain(`${path.sep}storage${path.sep}attachments${path.sep}`);
    });

    it('binds temporary references to the authenticated uploader', () => {
        const location = temporaryAttachmentLocation(userId, filename);
        expect(location.reference).toBe(`temporary/${userId}/${filename}`);
        expect(resolveTemporaryAttachmentPath(location.reference, userId)).toBe(location.absolutePath);
        expect(resolveTemporaryAttachmentPath(location.reference, ticketId)).toBeNull();
    });

    it('rejects traversal and cross-ticket stored references', () => {
        expect(() => privateAttachmentLocation('../outside', filename)).toThrow();
        expect(() => privateAttachmentLocation(ticketId, '../secret.txt')).toThrow();
        expect(resolveStoredAttachmentPath(`private/${ticketId}/${filename}`, userId)).toBeNull();
        expect(resolveStoredAttachmentPath('/uploads/../secret.txt', ticketId)).toBeNull();
    });

    it('rejects private storage configured inside the public web directory', () => {
        const previous = process.env.ATTACHMENT_STORAGE_DIR;
        process.env.ATTACHMENT_STORAGE_DIR = 'public/uploads/attachments';
        try {
            expect(() => attachmentStorageRoot()).toThrow('cannot be inside the public directory');
        } finally {
            if (previous === undefined) delete process.env.ATTACHMENT_STORAGE_DIR;
            else process.env.ATTACHMENT_STORAGE_DIR = previous;
        }
    });

    it('uses bounded temporary storage defaults and validates overrides', () => {
        const previous = {
            ttl: process.env.TEMP_ATTACHMENT_TTL_HOURS,
            files: process.env.TEMP_ATTACHMENT_MAX_FILES_PER_USER,
            bytes: process.env.TEMP_ATTACHMENT_MAX_BYTES_PER_USER,
        };
        process.env.TEMP_ATTACHMENT_TTL_HOURS = '2';
        process.env.TEMP_ATTACHMENT_MAX_FILES_PER_USER = '7';
        process.env.TEMP_ATTACHMENT_MAX_BYTES_PER_USER = '12345';
        try {
            expect(temporaryAttachmentLimits()).toEqual({ ttlMs: 2 * 60 * 60 * 1000, maxFilesPerUser: 7, maxBytesPerUser: 12345 });
        } finally {
            if (previous.ttl === undefined) delete process.env.TEMP_ATTACHMENT_TTL_HOURS;
            else process.env.TEMP_ATTACHMENT_TTL_HOURS = previous.ttl;
            if (previous.files === undefined) delete process.env.TEMP_ATTACHMENT_MAX_FILES_PER_USER;
            else process.env.TEMP_ATTACHMENT_MAX_FILES_PER_USER = previous.files;
            if (previous.bytes === undefined) delete process.env.TEMP_ATTACHMENT_MAX_BYTES_PER_USER;
            else process.env.TEMP_ATTACHMENT_MAX_BYTES_PER_USER = previous.bytes;
        }
    });
});
