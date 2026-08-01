#!/usr/bin/env node
// Regenerates the derived xHydra/CompDesk static icon and social-preview assets
// from the source marks in public/brand/. Run after replacing any source mark:
//   node scripts/generate-brand-assets.mjs
//
// Source marks are never resized in a way that changes their aspect ratio or
// recolors them — this only crops/pads square canvases and composites the
// already-square app icon onto larger canvases for favicon/OG use.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const BRAND_DIR = path.join(PUBLIC_DIR, 'brand');
const APP_ICON = path.join(BRAND_DIR, 'xhydra-app-icon.png');

// Sampled from the app icon's flat background fill (see public/brand/README.md).
const APP_ICON_BACKGROUND = { r: 243, g: 241, b: 236 };
const THEME_COLOR = '#4f46e5';

async function pngIcoBuffer(sizes) {
    // Minimal ICO container embedding PNG-compressed images per entry (supported
    // since Windows Vista / all modern browsers) — avoids adding an ICO-encoding
    // dependency for a one-time asset generation step.
    const images = await Promise.all(
        sizes.map((size) => sharp(APP_ICON).resize(size, size, { fit: 'contain' }).png().toBuffer())
    );
    const headerSize = 6;
    const dirEntrySize = 16;
    let offset = headerSize + dirEntrySize * images.length;
    const header = Buffer.alloc(headerSize);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(images.length, 4);

    const dirEntries = [];
    for (const [index, image] of images.entries()) {
        const size = sizes[index];
        const entry = Buffer.alloc(dirEntrySize);
        entry.writeUInt8(size >= 256 ? 0 : size, 0);
        entry.writeUInt8(size >= 256 ? 0 : size, 1);
        entry.writeUInt8(0, 2); // color palette
        entry.writeUInt8(0, 3); // reserved
        entry.writeUInt16LE(1, 4); // color planes
        entry.writeUInt16LE(32, 6); // bits per pixel
        entry.writeUInt32LE(image.length, 8);
        entry.writeUInt32LE(offset, 12);
        offset += image.length;
        dirEntries.push(entry);
    }
    return Buffer.concat([header, ...dirEntries, ...images]);
}

async function main() {
    await mkdir(BRAND_DIR, { recursive: true });

    await writeFile(path.join(PUBLIC_DIR, 'favicon.ico'), await pngIcoBuffer([16, 32, 48]));

    await sharp(APP_ICON).resize(192, 192).png({ compressionLevel: 9 }).toFile(path.join(PUBLIC_DIR, 'icon-192.png'));
    await sharp(APP_ICON).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(PUBLIC_DIR, 'icon-512.png'));
    await sharp(APP_ICON).resize(180, 180).png({ compressionLevel: 9 }).toFile(path.join(PUBLIC_DIR, 'apple-touch-icon.png'));

    // Social preview (OG/Twitter): pad the square, unmodified icon onto a
    // 1200x630 canvas filled with its own background color — never stretched.
    const mark = await sharp(APP_ICON).resize(460, 460).toBuffer();
    await sharp({
        create: {
            width: 1200,
            height: 630,
            channels: 3,
            background: APP_ICON_BACKGROUND,
        },
    })
        .composite([{ input: mark, gravity: 'center' }])
        .png({ compressionLevel: 9 })
        .toFile(path.join(PUBLIC_DIR, 'og-image.png'));

    const manifest = {
        name: 'CompDesk',
        short_name: 'CompDesk',
        description: 'A lightweight, privacy-first, self-hosted ticketing and help desk platform.',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: THEME_COLOR,
        icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
    };
    await writeFile(path.join(PUBLIC_DIR, 'site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);

    // Re-encode the source marks with maximum lossless compression so the
    // committed copies are optimized without any visible quality change.
    for (const file of ['xhydra-mark-black.png', 'xhydra-mark-white.png', 'xhydra-app-icon.png']) {
        const target = path.join(BRAND_DIR, file);
        const optimized = await sharp(target).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
        await writeFile(target, optimized);
    }

    console.log('Brand assets regenerated in public/.');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
