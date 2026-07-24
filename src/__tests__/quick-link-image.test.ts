import path from 'path';
import sharp from 'sharp';
import {
    optimizeQuickLinkIconBuffer,
    QUICK_LINK_ICON_MAX_EDGE,
    QUICK_LINK_ICON_MAX_INPUT_BYTES,
    resolveUploadRoots,
} from '@/lib/uploaded-image';

describe('quick-link icon optimization', () => {
    it('preserves proportions and downsizes large sources to a compact WebP', async () => {
        const source = await sharp({
            create: { width: 256, height: 128, channels: 4, background: { r: 45, g: 90, b: 180, alpha: 1 } },
        }).png().toBuffer();

        const optimized = await optimizeQuickLinkIconBuffer(source);
        const metadata = await sharp(optimized.buffer).metadata();

        expect(optimized.sourceWidth).toBe(256);
        expect(optimized.sourceHeight).toBe(128);
        expect(optimized.width).toBe(128);
        expect(optimized.height).toBe(64);
        expect(metadata.format).toBe('webp');
        expect(metadata.width).toBe(128);
        expect(metadata.height).toBe(64);
        expect(QUICK_LINK_ICON_MAX_EDGE).toBe(128);
        expect(QUICK_LINK_ICON_MAX_INPUT_BYTES).toBe(5 * 1024 * 1024);
    });

    it('does not enlarge an already small source', async () => {
        const source = await sharp({
            create: { width: 64, height: 64, channels: 4, background: { r: 30, g: 30, b: 30, alpha: 0.8 } },
        }).png().toBuffer();
        const optimized = await optimizeQuickLinkIconBuffer(source);
        expect([optimized.width, optimized.height]).toEqual([64, 64]);
    });

    it('rejects proportions that would be unreadable as a small icon', async () => {
        const source = await sharp({
            create: { width: 400, height: 40, channels: 3, background: { r: 255, g: 255, b: 255 } },
        }).png().toBuffer();
        await expect(optimizeQuickLinkIconBuffer(source)).rejects.toThrow('between 1:2 and 2:1');
    });
});

describe('standalone upload persistence', () => {
    it('writes to both persistent and runtime public folders for a local standalone build', () => {
        const repository = path.resolve('C:\\workspace\\CompDesk');
        const standalone = path.join(repository, '.next', 'standalone');
        expect(resolveUploadRoots(standalone)).toEqual([
            path.join(repository, 'public', 'uploads'),
            path.join(standalone, 'public', 'uploads'),
        ]);
    });

    it('uses one upload root during development and Docker production', () => {
        const applicationRoot = path.resolve('C:\\app');
        expect(resolveUploadRoots(applicationRoot)).toEqual([path.join(applicationRoot, 'public', 'uploads')]);
    });
});