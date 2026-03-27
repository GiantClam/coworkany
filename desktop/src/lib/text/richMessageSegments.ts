import { parseExternalUrl } from '../externalLinks';
import type { InlineFileAttachment } from './inlineAttachments';

const HTML_FENCE_PATTERN = /```(?:html|htm)\s*\n?([\s\S]*?)```/gi;
const MARKDOWN_LINK_ONLY_PATTERN = /^\s*\[([^\]]+)\]\(([^)]+)\)\s*$/;
const REFERENCE_PREFIX_PATTERN = /^\s*(?:artifact|file|attached file|html|文件|附件)\s*:\s*(.+?)\s*$/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]/;

export type RichMessageFileRef =
    | {
        kind: 'inline';
        source: string;
        label: string;
        isHtml: boolean;
        displayPath: string;
    }
    | {
        kind: 'local';
        source: string;
        label: string;
        isHtml: boolean;
        displayPath: string;
    }
    | {
        kind: 'remote';
        source: string;
        label: string;
        isHtml: boolean;
        displayPath: string;
    };

export type RichMessageSegment =
    | {
        type: 'markdown';
        content: string;
    }
    | {
        type: 'file';
        file: RichMessageFileRef;
    }
    | {
        type: 'html';
        title: string;
        source?: RichMessageFileRef;
        inlineContent?: string;
    };

export function looksLikeHtmlDocument(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed) return false;

    return /^<!doctype html/i.test(trimmed)
        || /<html[\s>]/i.test(trimmed)
        || (/<body[\s>]/i.test(trimmed) && /<\/body>/i.test(trimmed));
}

function hasFileLikeExtension(value: string): boolean {
    const sanitized = value.split('#')[0]?.split('?')[0] ?? value;
    return /\.[a-z0-9]{1,8}$/i.test(sanitized);
}

function normalizeLocalPath(raw: string): string {
    if (raw.startsWith('file://')) {
        try {
            return decodeURIComponent(new URL(raw).pathname);
        } catch {
            return raw.replace(/^file:\/\//i, '');
        }
    }

    return raw;
}

function getReferenceLabel(source: string): string {
    const normalized = source.replace(/[?#].*$/, '');
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || source;
}

function buildReference(source: string, label?: string): RichMessageFileRef | null {
    const remote = parseExternalUrl(source);
    if (remote) {
        const pathname = decodeURIComponent(remote.pathname || '');
        const isHtml = /\.(?:html?|xhtml)$/i.test(pathname);
        const fileLike = isHtml || hasFileLikeExtension(pathname);
        if (!fileLike) {
            return null;
        }

        return {
            kind: 'remote',
            source: remote.toString(),
            label: label?.trim() || getReferenceLabel(pathname || remote.toString()),
            isHtml,
            displayPath: remote.toString(),
        };
    }

    if (!isLikelyLocalPath(source)) {
        return null;
    }

    const normalized = normalizeLocalPath(source.trim());
    const isHtml = /\.(?:html?|xhtml)$/i.test(normalized);

    return {
        kind: 'local',
        source: normalized,
        label: label?.trim() || getReferenceLabel(normalized),
        isHtml,
        displayPath: normalized,
    };
}

export function isLikelyLocalPath(raw: string): boolean {
    const value = raw.trim();
    if (!value) return false;
    if (value.startsWith('http://') || value.startsWith('https://')) return false;

    return value.startsWith('/')
        || value.startsWith('~/')
        || value.startsWith('file://')
        || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value);
}

function pushMarkdownSegment(segments: RichMessageSegment[], content: string): void {
    const trimmed = content.replace(/\n{3,}/g, '\n\n').trim();
    if (!trimmed) {
        return;
    }

    segments.push({
        type: 'markdown',
        content: trimmed,
    });
}

function parseStandaloneReference(line: string): RichMessageFileRef | null {
    const prefixedMatch = line.match(REFERENCE_PREFIX_PATTERN);
    if (prefixedMatch) {
        const rawValue = prefixedMatch[1]?.trim() ?? '';
        const markdownLinkMatch = rawValue.match(MARKDOWN_LINK_ONLY_PATTERN);
        if (markdownLinkMatch) {
            return buildReference(markdownLinkMatch[2] || '', markdownLinkMatch[1] || '');
        }
        return buildReference(rawValue);
    }

    const markdownLinkMatch = line.match(MARKDOWN_LINK_ONLY_PATTERN);
    if (markdownLinkMatch) {
        return buildReference(markdownLinkMatch[2] || '', markdownLinkMatch[1] || '');
    }

    return buildReference(line.trim());
}

function parseTextChunk(chunk: string): RichMessageSegment[] {
    if (!chunk.trim()) {
        return [];
    }

    if (looksLikeHtmlDocument(chunk)) {
        return [{
            type: 'html',
            title: 'HTML Preview',
            inlineContent: chunk.trim(),
        }];
    }

    const segments: RichMessageSegment[] = [];
    const markdownBuffer: string[] = [];
    const lines = chunk.split('\n');

    const flushMarkdown = () => {
        if (markdownBuffer.length === 0) {
            return;
        }
        pushMarkdownSegment(segments, markdownBuffer.join('\n'));
        markdownBuffer.length = 0;
    };

    for (const line of lines) {
        const reference = parseStandaloneReference(line);
        if (reference) {
            flushMarkdown();
            segments.push(reference.isHtml
                ? {
                    type: 'html',
                    title: reference.label,
                    source: reference,
                }
                : {
                    type: 'file',
                    file: reference,
                });
            continue;
        }

        markdownBuffer.push(line);
    }

    flushMarkdown();
    return segments;
}

export function buildRichMessageSegments(
    content: string,
    inlineFiles: InlineFileAttachment[] = [],
): RichMessageSegment[] {
    const segments: RichMessageSegment[] = [];

    for (const file of inlineFiles) {
        const inlineRef: RichMessageFileRef = {
            kind: 'inline',
            source: file.name,
            label: file.name,
            isHtml: /\.(?:html?|xhtml)$/i.test(file.name) || looksLikeHtmlDocument(file.content),
            displayPath: file.name,
        };
        segments.push(inlineRef.isHtml
            ? {
                type: 'html',
                title: inlineRef.label,
                source: inlineRef,
                inlineContent: file.content,
            }
            : {
                type: 'file',
                file: inlineRef,
            });
    }

    let lastIndex = 0;
    for (const match of content.matchAll(HTML_FENCE_PATTERN)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        segments.push(...parseTextChunk(content.slice(lastIndex, start)));

        const html = (match[1] || '').trim();
        if (looksLikeHtmlDocument(html)) {
            segments.push({
                type: 'html',
                title: 'HTML Preview',
                inlineContent: html,
            });
        } else {
            pushMarkdownSegment(segments, match[0]);
        }

        lastIndex = end;
    }

    segments.push(...parseTextChunk(content.slice(lastIndex)));

    if (segments.length === 0 && content.trim()) {
        return [{ type: 'markdown', content: content.trim() }];
    }

    return segments;
}
