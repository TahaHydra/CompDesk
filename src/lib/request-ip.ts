export function requestSourceIp(request: { headers: Headers }): string {
    if (process.env.TRUST_PROXY !== 'true') return 'unknown';
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown';
}