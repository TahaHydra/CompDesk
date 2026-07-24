import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface HelpHeading {
    id: string;
    text: string;
    level: 2 | 3;
}

export function headingId(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'section';
}

export function extractHelpHeadings(markdown: string): HelpHeading[] {
    return markdown.split(/\r?\n/).flatMap((line) => {
        const match = /^(##|###)\s+(.+)$/.exec(line.trim());
        if (!match) return [];
        return [{ id: headingId(match[2]), text: match[2], level: match[1] === '##' ? 2 : 3 } as HelpHeading];
    });
}

function renderInline(text: string): ReactNode[] {
    const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
    return tokens.map((token, index) => {
        if (token.startsWith('**') && token.endsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>;
        if (token.startsWith('`') && token.endsWith('`')) return <code key={index} className="rounded bg-muted px-1.5 py-0.5 text-[0.9em]">{token.slice(1, -1)}</code>;
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
        if (link) {
            const href = link[2];
            const safe = href.startsWith('/') || /^https:\/\//i.test(href);
            return safe ? <a key={index} href={href} target={href.startsWith('/') ? undefined : '_blank'} rel={href.startsWith('/') ? undefined : 'noreferrer'} className="font-medium text-primary underline decoration-primary/35 underline-offset-4 hover:decoration-primary">{link[1]}</a> : <span key={index}>{link[1]}</span>;
        }
        return <span key={index}>{token}</span>;
    });
}

export function MarkdownArticle({ content, className }: { content: string; className?: string }) {
    const lines = content.split(/\r?\n/);
    const nodes: ReactNode[] = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index].trim();
        if (!line) { index += 1; continue; }

        const heading = /^(#{1,3})\s+(.+)$/.exec(line);
        if (heading) {
            const level = heading[1].length;
            const text = heading[2];
            const id = headingId(text);
            if (level === 1) nodes.push(<h1 key={index} id={id} className="mt-10 scroll-mt-24 text-3xl font-semibold">{renderInline(text)}</h1>);
            if (level === 2) nodes.push(<h2 key={index} id={id} className="mt-10 scroll-mt-24 border-t pt-8 text-2xl font-semibold">{renderInline(text)}</h2>);
            if (level === 3) nodes.push(<h3 key={index} id={id} className="mt-7 scroll-mt-24 text-lg font-semibold">{renderInline(text)}</h3>);
            index += 1;
            continue;
        }

        if (/^[-*]\s+/.test(line)) {
            const items: string[] = [];
            while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
                items.push(lines[index].trim().replace(/^[-*]\s+/, ''));
                index += 1;
            }
            nodes.push(<ul key={`ul-${index}`} className="my-4 list-disc space-y-2 pl-6 text-[15px] leading-7 text-foreground/90">{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>);
            continue;
        }

        if (/^\d+\.\s+/.test(line)) {
            const items: string[] = [];
            while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
                items.push(lines[index].trim().replace(/^\d+\.\s+/, ''));
                index += 1;
            }
            nodes.push(<ol key={`ol-${index}`} className="my-4 list-decimal space-y-2 pl-6 text-[15px] leading-7 text-foreground/90">{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ol>);
            continue;
        }

        if (line.startsWith('> ')) {
            nodes.push(<blockquote key={index} className="my-5 border-l-2 border-primary/50 bg-muted/35 px-4 py-3 text-[15px] leading-7 text-muted-foreground">{renderInline(line.slice(2))}</blockquote>);
            index += 1;
            continue;
        }

        const paragraph = [line];
        index += 1;
        while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+|^[-*]\s+|^\d+\.\s+|^>\s+/.test(lines[index].trim())) {
            paragraph.push(lines[index].trim());
            index += 1;
        }
        nodes.push(<p key={`p-${index}`} className="my-4 text-[15px] leading-7 text-foreground/88">{renderInline(paragraph.join(' '))}</p>);
    }

    return <div className={cn('help-article', className)}>{nodes}</div>;
}