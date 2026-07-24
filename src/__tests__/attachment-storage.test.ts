import path from 'path';
import {
    attachmentStorageRoot,
    authenticatedAttachmentUrl,
    privateAttachmentLocation,
    resolveStoredAttachmentPath,
    resolveTemporaryAttachmentPath,
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
});
