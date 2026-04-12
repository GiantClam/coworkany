import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

type SearchResult = {
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
};

const searchInputSchema = z.object({
    query: z.string().min(1),
    max_results: z.number().int().min(1).max(10).optional(),
    recency_days: z.number().int().min(1).max(30).optional(),
});

const searchOutputSchema = z.object({
    query: z.string(),
    provider: z.string(),
    results: z.array(z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string(),
        publishedAt: z.string().optional(),
    })),
    error: z.string().optional(),
});

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
        .replace(/&apos;/g, '\'');
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function extractXmlTag(item: string, tag: string): string {
    const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
    return match?.[1] ? normalizeText(decodeXmlEntities(match[1])) : '';
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'Accept': 'application/json, text/xml, application/xml, text/plain, */*',
                'User-Agent': 'CoworkAny/1.0 (+https://coworkany.com)',
            },
        });
        if (!response.ok) {
            throw new Error(`http_${response.status}`);
        }
        return await response.text();
    } finally {
        clearTimeout(timer);
    }
}

function parseBingRss(xml: string, maxResults: number): SearchResult[] {
    const matches = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
    const results: SearchResult[] = [];
    for (const match of matches) {
        if (!match[1]) {
            continue;
        }
        const item = match[1];
        const title = extractXmlTag(item, 'title');
        const url = extractXmlTag(item, 'link');
        const snippet = extractXmlTag(item, 'description');
        const publishedAt = extractXmlTag(item, 'pubDate');
        if (!title || !url) {
            continue;
        }
        results.push({
            title,
            url,
            snippet,
            publishedAt: publishedAt || undefined,
        });
        if (results.length >= maxResults) {
            break;
        }
    }
    return results;
}

function parseDuckDuckGo(payload: unknown, maxResults: number): SearchResult[] {
    if (!payload || typeof payload !== 'object') {
        return [];
    }
    const record = payload as Record<string, unknown>;
    const results: SearchResult[] = [];
    const pushResult = (value: unknown): void => {
        if (!value || typeof value !== 'object') {
            return;
        }
        const entry = value as Record<string, unknown>;
        const text = typeof entry.Text === 'string' ? normalizeText(entry.Text) : '';
        const url = typeof entry.FirstURL === 'string' ? entry.FirstURL.trim() : '';
        if (!text || !url) {
            return;
        }
        const separatorIndex = text.indexOf(' - ');
        const title = separatorIndex > 0 ? text.slice(0, separatorIndex).trim() : text.slice(0, 80).trim();
        const snippet = separatorIndex > 0 ? text.slice(separatorIndex + 3).trim() : text;
        results.push({
            title,
            url,
            snippet,
        });
    };

    const related = Array.isArray(record.RelatedTopics) ? record.RelatedTopics : [];
    for (const item of related) {
        if (results.length >= maxResults) {
            break;
        }
        if (item && typeof item === 'object' && Array.isArray((item as Record<string, unknown>).Topics)) {
            for (const nested of (item as Record<string, unknown>).Topics as unknown[]) {
                pushResult(nested);
                if (results.length >= maxResults) {
                    break;
                }
            }
            continue;
        }
        pushResult(item);
    }
    return results.slice(0, maxResults);
}

export const searchWebTool = createTool({
    id: 'search_web',
    description: 'Search the web and return top results with links and snippets.',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    execute: async ({ query, max_results }) => {
        const maxResults = Math.max(1, Math.min(10, max_results ?? 5));
        const timeoutMs = 12_000;

        try {
            const rssUrl = `https://www.bing.com/search?format=rss&count=${maxResults}&q=${encodeURIComponent(query)}`;
            const rssText = await fetchTextWithTimeout(rssUrl, timeoutMs);
            const rssResults = parseBingRss(rssText, maxResults);
            if (rssResults.length > 0) {
                return {
                    query,
                    provider: 'bing_rss',
                    results: rssResults,
                };
            }
        } catch {
            // Fall through to secondary provider.
        }

        try {
            const duckUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
            const duckText = await fetchTextWithTimeout(duckUrl, timeoutMs);
            const duckPayload = JSON.parse(duckText) as unknown;
            const duckResults = parseDuckDuckGo(duckPayload, maxResults);
            if (duckResults.length > 0) {
                return {
                    query,
                    provider: 'duckduckgo_instant',
                    results: duckResults,
                };
            }
            return {
                query,
                provider: 'duckduckgo_instant',
                results: [],
                error: 'no_results',
            };
        } catch (error) {
            return {
                query,
                provider: 'search_fallback',
                results: [],
                error: String(error),
            };
        }
    },
});

