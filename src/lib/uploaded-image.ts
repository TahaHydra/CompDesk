import crypto from 'crypto';
import path from 'path';
import { mkdir, unlink, writeFile } from 'fs/promises';
import sharp from 'sharp';
import { isLocalStandaloneRuntime, resolveApplicationRoot } from '@/lib/runtime-paths';

export const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
};

export const QUICK_LINK_ICON_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const QUICK_LINK_ICON_MAX_EDGE = 128;
const QUICK_LINK_ICON_MAX_INPUT_PIXELS = 20_000_000;
const QUICK_LINK_ICON_MIN_EDGE = 16;
const QUICK_LINK_ICON_MIN_ASPECT_RATIO = 0.5;
const QUICK_LINK_ICON_MAX_ASPECT_RATIO = 2;

export type UploadImageFolder = 'branding' | 'quick-links';

export interface StoredImage {
    url: string;
    mimeType: string;
    size: number;
}

export interface OptimizedQuickLinkIcon extends StoredImage {
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
    sourceSize: number;
}

export function detectImageMime(buffer: Buffer): string | null {
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
    if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon';
    return null;
}

export function resolveUploadRoots(cwd = process.cwd()): string[] {
    const runtimeRoot = path.resolve(cwd, 'public', 'uploads');
    const persistentRoot = isLocalStandaloneRuntime(cwd)
        ? path.resolve(resolveApplicationRoot(cwd), 'public', 'uploads')
        : runtimeRoot;
    return [...new Set([persistentRoot, runtimeRoot])];
}

function uploadDirectories(folder: UploadImageFolder): string[] {
    return resolveUploadRoots().map((root) => path.resolve(root, folder));
}

async function writeImageCopies(folder: UploadImageFolder, filename: string, buffer: Buffer): Promise<void> {
    const written: string[] = [];
    try {
        for (const directory of uploadDirectories(folder)) {
            await mkdir(directory, { recursive: true });
            const destination = path.resolve(directory, filename);
            if (!destination.startsWith(`${directory}${path.sep}`)) throw new Error('Invalid image path');
            await writeFile(destination, buffer, { flag: 'wx' });
            written.push(destination);
        }
    } catch (error) {
        await Promise.all(written.map((destination) => unlink(destination).catch(() => undefined)));
        throw error;
    }
}

async function validatedImageBuffer(file: File, maxBytes: number): Promise<{ buffer: Buffer; mimeType: string }> {
    if (file.size === 0 || file.size > maxBytes) throw new Error(`Image must be between 1 byte and ${Math.round(maxBytes / 1024 / 1024)} MB`);
    if (!IMAGE_MIME_EXTENSIONS[file.type]) throw new Error('Only PNG, JPEG, WebP, GIF, and ICO images are allowed. SVG is not accepted.');

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedMime = detectImageMime(buffer);
    const declaredMime = file.type === 'image/vnd.microsoft.icon' ? 'image/x-icon' : file.type;
    if (!detectedMime || detectedMime !== declaredMime) throw new Error('The uploaded file content does not match its image type');
    return { buffer, mimeType: detectedMime };
}

export async function storeUploadedImage(file: File, folder: UploadImageFolder, maxBytes: number): Promise<StoredImage> {
    const { buffer, mimeType } = await validatedImageBuffer(file, maxBytes);
    const filename = `${crypto.randomUUID()}${IMAGE_MIME_EXTENSIONS[file.type]}`;
    await writeImageCopies(folder, filename, buffer);
    return { url: `/uploads/${folder}/${filename}`, mimeType, size: buffer.length };
}

export async function optimizeQuickLinkIconBuffer(buffer: Buffer): Promise<Omit<OptimizedQuickLinkIcon, 'url' | 'sourceSize'> & { buffer: Buffer }> {
    try {
        const image = sharp(buffer, { animated: false, failOn: 'warning', limitInputPixels: QUICK_LINK_ICON_MAX_INPUT_PIXELS });
        const metadata = await image.metadata();
        const sourceWidth = metadata.width;
        const sourceHeight = metadata.height;
        if (!sourceWidth || !sourceHeight) throw new Error('Image dimensions could not be read');
        if (sourceWidth < QUICK_LINK_ICON_MIN_EDGE || sourceHeight < QUICK_LINK_ICON_MIN_EDGE) {
            throw new Error(`Image must be at least ${QUICK_LINK_ICON_MIN_EDGE}×${QUICK_LINK_ICON_MIN_EDGE} pixels`);
        }
        const aspectRatio = sourceWidth / sourceHeight;
        if (aspectRatio < QUICK_LINK_ICON_MIN_ASPECT_RATIO || aspectRatio > QUICK_LINK_ICON_MAX_ASPECT_RATIO) {
            throw new Error('Image proportions must be between 1:2 and 2:1 for a clear dashboard icon');
        }

        const result = await image
            .rotate()
            .resize({
                width: QUICK_LINK_ICON_MAX_EDGE,
                height: QUICK_LINK_ICON_MAX_EDGE,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .webp({ quality: 84, alphaQuality: 90, effort: 4 })
            .toBuffer({ resolveWithObject: true });

        return {
            buffer: result.data,
            mimeType: 'image/webp',
            size: result.data.length,
            width: result.info.width,
            height: result.info.height,
            sourceWidth,
            sourceHeight,
        };
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Image')) throw error;
        throw new Error('Image could not be decoded safely');
    }
}

export async function storeOptimizedQuickLinkIcon(file: File): Promise<OptimizedQuickLinkIcon> {
    const { buffer } = await validatedImageBuffer(file, QUICK_LINK_ICON_MAX_INPUT_BYTES);
    const { buffer: output, ...optimized } = await optimizeQuickLinkIconBuffer(buffer);
    const filename = `${crypto.randomUUID()}.webp`;
    await writeImageCopies('quick-links', filename, output);
    return { ...optimized, url: `/uploads/quick-links/${filename}`, sourceSize: buffer.length };
}

export function isUploadedImageUrl(url: string, folder: UploadImageFolder): boolean {
    return new RegExp(`^/uploads/${folder}/[0-9a-f-]{36}\.(?:png|jpg|webp|gif|ico)$`).test(url);
}

export async function removeUploadedImage(url: string, folder: UploadImageFolder): Promise<void> {
    if (!isUploadedImageUrl(url, folder)) return;
    const filename = path.basename(url);
    await Promise.all(uploadDirectories(folder).map(async (directory) => {
        const candidate = path.resolve(directory, filename);
        if (!candidate.startsWith(`${directory}${path.sep}`)) return;
        await unlink(candidate).catch(() => undefined);
    }));
}