import crypto from 'crypto';
import path from 'path';
import { mkdir, unlink, writeFile } from 'fs/promises';

export const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
};

export type UploadImageFolder = 'branding' | 'quick-links';

export function detectImageMime(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon';
    return null;
}

function uploadsDirectory(folder: UploadImageFolder): string {
    return path.resolve(process.cwd(), 'public', 'uploads', folder);
}

export async function storeUploadedImage(file: File, folder: UploadImageFolder, maxBytes: number): Promise<{ url: string; mimeType: string; size: number }> {
    if (file.size === 0 || file.size > maxBytes) throw new Error(`Image must be between 1 byte and ${Math.round(maxBytes / 1024)} KB`);
    if (!IMAGE_MIME_EXTENSIONS[file.type]) throw new Error('Only PNG, JPEG, WebP, GIF, and ICO images are allowed. SVG is not accepted.');

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedMime = detectImageMime(buffer);
    const declaredMime = file.type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : file.type;
    if (!detectedMime || detectedMime !== declaredMime) throw new Error('The uploaded file content does not match its image type');

    const directory = uploadsDirectory(folder);
    await mkdir(directory, { recursive: true });
    const filename = `${crypto.randomUUID()}${IMAGE_MIME_EXTENSIONS[file.type]}`;
    const destination = path.join(directory, filename);
    if (!destination.startsWith(`${directory}${path.sep}`)) throw new Error('Invalid image path');
    await writeFile(destination, buffer, { flag: 'wx' });
    return { url: `/uploads/${folder}/${filename}`, mimeType: detectedMime, size: buffer.length };
}

export function isUploadedImageUrl(url: string, folder: UploadImageFolder): boolean {
    return new RegExp(`^/uploads/${folder}/[0-9a-f-]{36}\\.(?:png|jpg|webp|gif|ico)$`).test(url);
}

export async function removeUploadedImage(url: string, folder: UploadImageFolder): Promise<void> {
    if (!isUploadedImageUrl(url, folder)) return;
    const directory = uploadsDirectory(folder);
    const candidate = path.resolve(process.cwd(), 'public', url.replace(/^\/+/, ''));
    if (!candidate.startsWith(`${directory}${path.sep}`)) return;
    await unlink(candidate).catch(() => undefined);
}