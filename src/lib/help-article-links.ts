export interface SafeArticleLink {
    href: string;
    external: boolean;
}

export function resolveArticleLink(rawHref: string): SafeArticleLink | null {
    const href = rawHref.trim();
    if (!href || href.includes('\\')) return null;
    for (let index = 0; index < href.length; index += 1) {
        const code = href.charCodeAt(index);
        if (code < 32 || code === 127) return null;
    }
    if (href[0] === '/' && href[1] !== '/') return { href, external: false };
    try {
        const parsed = new URL(href);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
        return { href: parsed.href, external: true };
    } catch {
        return null;
    }
}