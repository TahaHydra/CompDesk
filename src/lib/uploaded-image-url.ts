export type UploadImageFolder = 'branding' | 'quick-links';

export function isUploadedImageUrl(url: string, folder: UploadImageFolder): boolean {
    return new RegExp(`^/uploads/${folder}/[0-9a-f-]{36}\.(?:png|jpg|webp|gif|ico)$`).test(url);
}