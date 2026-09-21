export class UploadBodyError extends Error {
    constructor(message: string, public readonly status: number) {
        super(message);
        this.name = 'UploadBodyError';
    }
}

/** Bound bytes before the multipart parser allocates files, including chunked requests. */
export async function readUploadFormData(request: Request, maxBytes: number): Promise<FormData> {
    const declaredLength = Number(request.headers.get('content-length'));
    if (declaredLength > maxBytes) {
        await request.body?.cancel().catch(() => undefined);
        throw new UploadBodyError('Upload request is too large', 413);
    }
    const reader = request.body?.getReader();
    if (!reader) throw new UploadBodyError('No upload body provided', 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw new UploadBodyError('Upload request is too large', 413);
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    try {
        return await new Response(Buffer.concat(chunks), {
            headers: { 'content-type': request.headers.get('content-type') ?? '' },
        }).formData();
    } catch {
        throw new UploadBodyError('Invalid multipart upload', 400);
    }
}
