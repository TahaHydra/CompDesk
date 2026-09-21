import { readUploadFormData } from '@/lib/bounded-upload';

function streamedRequest(chunks: string[], contentLength?: string) {
    const cancel = jest.fn();
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index === chunks.length) controller.close();
            else controller.enqueue(new TextEncoder().encode(chunks[index++]));
        },
        cancel,
    });
    const request = new Request('http://localhost/upload', {
        method: 'POST', body, duplex: 'half',
        headers: { 'content-type': 'multipart/form-data; boundary=test', ...(contentLength ? { 'content-length': contentLength } : {}) },
    } as RequestInit);
    return { request, cancel };
}

test.each([undefined, '1'])('rejects and cancels an oversized upload without trusting Content-Length=%s', async (length) => {
    const { request, cancel } = streamedRequest(['a'.repeat(20), 'b'.repeat(20), 'c'.repeat(20)], length);
    await expect(readUploadFormData(request, 30)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
});

test('rejects a declared oversized body before reading it', async () => {
    const { request, cancel } = streamedRequest(['small'], '1000000');
    await expect(readUploadFormData(request, 30)).rejects.toMatchObject({ status: 413 });
    expect(cancel).toHaveBeenCalled();
});

test('parses a valid multipart file within the request bound', async () => {
    const form = new FormData();
    form.set('file', new File(['hello'], 'note.txt', { type: 'text/plain' }));
    const request = new Request('http://localhost/upload', { method: 'POST', body: form });
    const parsed = await readUploadFormData(request, 1024);
    const file = parsed.get('file') as File;
    expect(file.name).toBe('note.txt');
    expect(await file.text()).toBe('hello');
});
