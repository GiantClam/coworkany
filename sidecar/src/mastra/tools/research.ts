import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import {
    resolveRuntimeSearchConfig,
    type RuntimeSearchConfigResolution,
    type RuntimeSearchProvider,
} from '../../config/runtimeConfig';
import {
    MARKET_QUERY_PATTERN,
    NEWS_QUERY_PATTERN,
    WEATHER_QUERY_PATTERN,
} from '../intentPatterns';

type SearchResult = {
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
};

type SearchDomain = 'market' | 'weather' | 'news' | 'general';
type SearchProvider = RuntimeSearchProvider;
type SearchAttempt = {
    provider: SearchProvider;
    label: string;
};
const PROVIDER_HARD_FAILURE_BACKOFF_MS = 10 * 60 * 1000;
const providerDisabledUntilByName = new Map<SearchProvider, number>();

function normalizeOptionalIntLike(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return undefined;
        }
        const parsed = Number.parseInt(trimmed, 10);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const marker = typeof record.$type === 'string'
            ? record.$type.trim().toLowerCase()
            : '';
        if (marker === 'null' || marker === 'undefined') {
            return undefined;
        }
        if ('value' in record) {
            return normalizeOptionalIntLike(record.value);
        }
    }
    return undefined;
}

function optionalIntField(min: number, max: number) {
    return z.preprocess(
        (value) => normalizeOptionalIntLike(value),
        z.number().int().min(min).max(max).optional(),
    );
}

const searchInputSchema = z.object({
    query: z.string().min(1),
    max_results: optionalIntField(1, 10),
    recency_days: optionalIntField(1, 30),
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

const crawlInputSchema = z.object({
    url: z.string().url(),
    max_chars: optionalIntField(200, 20_000),
});

const crawlOutputSchema = z.object({
    url: z.string(),
    status: z.number().int().optional(),
    title: z.string().optional(),
    content: z.string(),
    textLength: z.number().int(),
    error: z.string().optional(),
});

const extractInputSchema = z.object({
    url: z.string().url().optional(),
    html: z.string().optional(),
    max_chars: optionalIntField(200, 20_000),
});

const extractOutputSchema = z.object({
    url: z.string().optional(),
    title: z.string().optional(),
    content: z.string(),
    textLength: z.number().int(),
    error: z.string().optional(),
});

const LOW_SIGNAL_HOSTS = new Set([
    'zhihu.com',
    'zhuanlan.zhihu.com',
    'reddit.com',
    'weibo.com',
    'x.com',
    'twitter.com',
    'xiaohongshu.com',
    'tieba.baidu.com',
    'baike.baidu.com',
]);

const DOMAIN_HOST_FILTERS: Record<SearchDomain, string[]> = {
    market: [
        'hkex.com.hk',
        'finance.yahoo.com',
        'reuters.com',
        'bloomberg.com',
        'investing.com',
    ],
    weather: [
        'weather.gov',
        'noaa.gov',
        'weather.com',
        'accuweather.com',
    ],
    news: [
        'reuters.com',
        'apnews.com',
        'bloomberg.com',
    ],
    general: [],
};

const SEARCH_PROVIDER_LABELS: Record<SearchProvider, string> = {
    serper: 'Serper.dev',
    exa: 'Exa',
    tavily: 'Tavily',
    brave: 'Brave Search',
};

function isProviderTemporarilyDisabled(provider: SearchProvider, nowMs: number = Date.now()): boolean {
    const disabledUntil = providerDisabledUntilByName.get(provider);
    if (!Number.isFinite(disabledUntil)) {
        return false;
    }
    if ((disabledUntil ?? 0) <= nowMs) {
        providerDisabledUntilByName.delete(provider);
        return false;
    }
    return true;
}

function isNonRetryableProviderError(message: string): boolean {
    const normalized = message.trim().toLowerCase();
    if (normalized.length === 0) {
        return false;
    }
    return /\bhttp_(400|401|403|404)\b/.test(normalized)
        || /\b(invalid|unauthorized|forbidden|quota|billing)\b/.test(normalized);
}

function recordProviderFailure(provider: SearchProvider, message: string): void {
    if (!isNonRetryableProviderError(message)) {
        return;
    }
    const disabledUntil = Date.now() + PROVIDER_HARD_FAILURE_BACKOFF_MS;
    providerDisabledUntilByName.set(provider, disabledUntil);
}

function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

async function fetchJsonWithTimeout<T>(
    url: string,
    timeoutMs: number,
    init?: RequestInit,
): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            ...init,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'CoworkAny/1.0 (+https://coworkany.com)',
                ...(init?.headers ?? {}),
            },
        });
        if (!response.ok) {
            throw new Error(`http_${response.status}`);
        }
        return await response.json() as T;
    } finally {
        clearTimeout(timer);
    }
}

function toIsoDateString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function stripHtmlToText(input: string): string {
    return input
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractHtmlTitle(input: string): string | undefined {
    const matched = input.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!matched) {
        return undefined;
    }
    const normalized = stripHtmlToText(matched[1] ?? '').slice(0, 200);
    return normalized.length > 0 ? normalized : undefined;
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<{ status: number; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'CoworkAny/1.0 (+https://coworkany.com)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });
        const text = await response.text();
        return {
            status: response.status,
            text,
        };
    } finally {
        clearTimeout(timer);
    }
}

async function runCrawlUrl(input: {
    url: string;
    maxChars?: number;
}): Promise<z.infer<typeof crawlOutputSchema>> {
    const maxChars = Math.min(20_000, Math.max(200, input.maxChars ?? 4_000));
    try {
        const { status, text } = await fetchTextWithTimeout(input.url, 20_000);
        const title = extractHtmlTitle(text);
        const content = stripHtmlToText(text).slice(0, maxChars);
        return {
            url: input.url,
            status,
            title,
            content,
            textLength: content.length,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            url: input.url,
            content: '',
            textLength: 0,
            error: message,
        };
    }
}

async function runExtractContent(input: {
    url?: string;
    html?: string;
    maxChars?: number;
}): Promise<z.infer<typeof extractOutputSchema>> {
    const maxChars = Math.min(20_000, Math.max(200, input.maxChars ?? 4_000));
    try {
        let html = typeof input.html === 'string' ? input.html : '';
        let resolvedUrl = typeof input.url === 'string' ? input.url : undefined;
        if (!html && resolvedUrl) {
            const fetched = await fetchTextWithTimeout(resolvedUrl, 20_000);
            html = fetched.text;
        }
        if (!html) {
            return {
                url: resolvedUrl,
                content: '',
                textLength: 0,
                error: 'missing_html_or_url',
            };
        }
        const title = extractHtmlTitle(html);
        const content = stripHtmlToText(html).slice(0, maxChars);
        return {
            url: resolvedUrl,
            title,
            content,
            textLength: content.length,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            url: input.url,
            content: '',
            textLength: 0,
            error: message,
        };
    }
}

function parseSerperResults(payload: unknown, maxResults: number): SearchResult[] {
    if (!payload || typeof payload !== 'object') {
        return [];
    }
    const organic = Array.isArray((payload as Record<string, unknown>).organic)
        ? (payload as Record<string, unknown>).organic as unknown[]
        : [];
    const results: SearchResult[] = [];
    for (const entry of organic) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const title = typeof record.title === 'string' ? normalizeText(record.title) : '';
        const url = typeof record.link === 'string' ? record.link.trim() : '';
        const snippet = typeof record.snippet === 'string' ? normalizeText(record.snippet) : '';
        if (!title || !url) {
            continue;
        }
        results.push({
            title,
            url,
            snippet,
            publishedAt: toIsoDateString(record.date),
        });
        if (results.length >= maxResults) {
            break;
        }
    }
    return results;
}

function parseExaResults(payload: unknown, maxResults: number): SearchResult[] {
    if (!payload || typeof payload !== 'object') {
        return [];
    }
    const rawResults = Array.isArray((payload as Record<string, unknown>).results)
        ? (payload as Record<string, unknown>).results as unknown[]
        : [];
    const results: SearchResult[] = [];
    for (const entry of rawResults) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const title = typeof record.title === 'string' ? normalizeText(record.title) : '';
        const url = typeof record.url === 'string' ? record.url.trim() : '';
        const highlights = Array.isArray(record.highlights)
            ? record.highlights.filter((value): value is string => typeof value === 'string').join(' ')
            : '';
        const snippetSource = highlights
            || (typeof record.summary === 'string'
            ? record.summary
            : typeof record.text === 'string'
                ? record.text
                : '');
        const snippet = normalizeText(snippetSource).slice(0, 320);
        if (!title || !url) {
            continue;
        }
        results.push({
            title,
            url,
            snippet,
            publishedAt: toIsoDateString(record.publishedDate),
        });
        if (results.length >= maxResults) {
            break;
        }
    }
    return results;
}

function parseTavilyResults(payload: unknown, maxResults: number): SearchResult[] {
    if (!payload || typeof payload !== 'object') {
        return [];
    }
    const rawResults = Array.isArray((payload as Record<string, unknown>).results)
        ? (payload as Record<string, unknown>).results as unknown[]
        : [];
    const results: SearchResult[] = [];
    for (const entry of rawResults) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const title = typeof record.title === 'string' ? normalizeText(record.title) : '';
        const url = typeof record.url === 'string' ? record.url.trim() : '';
        const snippetSource = typeof record.content === 'string'
            ? record.content
            : typeof record.raw_content === 'string'
                ? record.raw_content
                : '';
        const snippet = normalizeText(snippetSource).slice(0, 320);
        if (!title || !url) {
            continue;
        }
        results.push({
            title,
            url,
            snippet,
            publishedAt: toIsoDateString(record.published_date),
        });
        if (results.length >= maxResults) {
            break;
        }
    }
    return results;
}

function parseBraveResults(payload: unknown, maxResults: number): SearchResult[] {
    if (!payload || typeof payload !== 'object') {
        return [];
    }
    const web = (payload as Record<string, unknown>).web;
    if (!web || typeof web !== 'object') {
        return [];
    }
    const rawResults = Array.isArray((web as Record<string, unknown>).results)
        ? (web as Record<string, unknown>).results as unknown[]
        : [];
    const results: SearchResult[] = [];
    for (const entry of rawResults) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const title = typeof record.title === 'string' ? normalizeText(record.title) : '';
        const url = typeof record.url === 'string' ? record.url.trim() : '';
        const snippet = typeof record.description === 'string' ? normalizeText(record.description) : '';
        if (!title || !url) {
            continue;
        }
        results.push({
            title,
            url,
            snippet,
            publishedAt: toIsoDateString(record.age),
        });
        if (results.length >= maxResults) {
            break;
        }
    }
    return results;
}

export function inferSearchDomain(query: string): SearchDomain {
    const normalized = query.trim();
    if (normalized.length === 0) {
        return 'general';
    }
    if (MARKET_QUERY_PATTERN.test(normalized)) {
        return 'market';
    }
    if (WEATHER_QUERY_PATTERN.test(normalized)) {
        return 'weather';
    }
    if (NEWS_QUERY_PATTERN.test(normalized)) {
        return 'news';
    }
    return 'general';
}

export function augmentSearchQueryForDomain(query: string): string {
    const domain = inferSearchDomain(query);
    const hostFilters = DOMAIN_HOST_FILTERS[domain];
    if (!hostFilters || hostFilters.length === 0) {
        return query;
    }
    const filterClause = hostFilters.map((host) => `site:${host}`).join(' OR ');
    return `${query} (${filterClause})`;
}

function normalizeHost(url: string): string {
    try {
        return new URL(url).hostname.trim().toLowerCase();
    } catch {
        return '';
    }
}

function isLowSignalHost(host: string): boolean {
    if (!host) {
        return false;
    }
    for (const candidate of LOW_SIGNAL_HOSTS) {
        if (host === candidate || host.endsWith(`.${candidate}`)) {
            return true;
        }
    }
    return false;
}

function isAuthoritativeHostForDomain(domain: SearchDomain, host: string): boolean {
    const candidates = DOMAIN_HOST_FILTERS[domain];
    if (!candidates || candidates.length === 0 || host.length === 0) {
        return false;
    }
    return candidates.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

export function filterSearchResultsByQuality(
    query: string,
    results: SearchResult[],
    maxResults: number,
): SearchResult[] {
    if (results.length === 0) {
        return results;
    }
    const domain = inferSearchDomain(query);
    if (domain === 'general') {
        return results.slice(0, maxResults);
    }
    const annotated = results
        .map((entry) => ({
            entry,
            host: normalizeHost(entry.url),
        }))
        .filter((item) => item.host.length > 0);
    if (annotated.length === 0) {
        return [];
    }
    const authoritative = annotated.filter((item) => isAuthoritativeHostForDomain(domain, item.host));
    if (authoritative.length > 0) {
        return authoritative.map((item) => item.entry).slice(0, maxResults);
    }
    const nonLowSignal = annotated.filter((item) => !isLowSignalHost(item.host));
    if (nonLowSignal.length > 0) {
        return nonLowSignal.map((item) => item.entry).slice(0, maxResults);
    }
    return [];
}

function getRuntimeProviderAttempts(resolved: RuntimeSearchConfigResolution): SearchAttempt[] {
    const available = new Set<SearchProvider>();
    const nowMs = Date.now();

    if (resolved.settings.serperApiKey && !isProviderTemporarilyDisabled('serper', nowMs)) {
        available.add('serper');
    }
    if (resolved.settings.exaApiKey && !isProviderTemporarilyDisabled('exa', nowMs)) {
        available.add('exa');
    }
    if (resolved.settings.tavilyApiKey && !isProviderTemporarilyDisabled('tavily', nowMs)) {
        available.add('tavily');
    }
    if (resolved.settings.braveApiKey && !isProviderTemporarilyDisabled('brave', nowMs)) {
        available.add('brave');
    }
    const attempts: SearchAttempt[] = [];
    const maybePush = (provider: SearchProvider) => {
        if (!available.has(provider)) {
            return;
        }
        if (attempts.some((attempt) => attempt.provider === provider)) {
            return;
        }
        attempts.push({
            provider,
            label: SEARCH_PROVIDER_LABELS[provider],
        });
    };

    maybePush(resolved.settings.provider);
    maybePush('serper');
    maybePush('exa');
    maybePush('tavily');
    maybePush('brave');

    return attempts;
}

function providerApiKey(provider: RuntimeSearchProvider, resolved: RuntimeSearchConfigResolution): string | undefined {
    if (provider === 'serper') return resolved.settings.serperApiKey;
    if (provider === 'exa') return resolved.settings.exaApiKey;
    if (provider === 'tavily') return resolved.settings.tavilyApiKey;
    return resolved.settings.braveApiKey;
}

async function executeSearchAttempt(input: {
    attempt: SearchAttempt;
    query: string;
    effectiveQuery: string;
    maxResults: number;
    recencyDays?: number;
    timeoutMs: number;
    resolved: RuntimeSearchConfigResolution;
}): Promise<SearchResult[]> {
    const {
        attempt,
        query,
        effectiveQuery,
        maxResults,
        recencyDays,
        timeoutMs,
        resolved,
    } = input;

    switch (attempt.provider) {
        case 'serper': {
            const payload = await fetchJsonWithTimeout<unknown>('https://google.serper.dev/search', timeoutMs, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': resolved.settings.serperApiKey!,
                },
                body: JSON.stringify({
                    q: effectiveQuery,
                    num: maxResults,
                    ...(recencyDays ? { tbs: `qdr:d${recencyDays}` } : {}),
                }),
            });
            return parseSerperResults(payload, maxResults);
        }
        case 'exa': {
            const domain = inferSearchDomain(query);
            const payload = await fetchJsonWithTimeout<unknown>('https://api.exa.ai/search', timeoutMs, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': resolved.settings.exaApiKey!,
                },
                body: JSON.stringify({
                    query: effectiveQuery,
                    type: 'auto',
                    num_results: maxResults,
                    contents: {
                        highlights: {
                            max_characters: 1200,
                        },
                    },
                    ...(domain === 'news' ? { category: 'news' } : {}),
                    ...(recencyDays ? { startPublishedDate: new Date(Date.now() - recencyDays * 24 * 60 * 60 * 1000).toISOString() } : {}),
                }),
            });
            return parseExaResults(payload, maxResults);
        }
        case 'tavily': {
            const domain = inferSearchDomain(query);
            const payload = await fetchJsonWithTimeout<unknown>('https://api.tavily.com/search', timeoutMs, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: resolved.settings.tavilyApiKey!,
                    query: effectiveQuery,
                    max_results: maxResults,
                    search_depth: 'basic',
                    include_answer: false,
                    include_raw_content: false,
                    topic: domain === 'general' ? 'general' : domain,
                    ...(recencyDays
                        ? { time_range: recencyDays <= 1 ? 'day' : recencyDays <= 7 ? 'week' : recencyDays <= 30 ? 'month' : 'year' }
                        : {}),
                }),
            });
            return parseTavilyResults(payload, maxResults);
        }
        case 'brave': {
            const url = new URL('https://api.search.brave.com/res/v1/web/search');
            url.searchParams.set('q', effectiveQuery);
            url.searchParams.set('count', String(maxResults));
            const payload = await fetchJsonWithTimeout<unknown>(url.toString(), timeoutMs, {
                method: 'GET',
                headers: {
                    'X-Subscription-Token': resolved.settings.braveApiKey!,
                },
            });
            return parseBraveResults(payload, maxResults);
        }
        default: {
            return [];
        }
    }
}

export async function runWebSearch(input: {
    query: string;
    max_results?: number;
    recency_days?: number;
    runtimeConfig?: RuntimeSearchConfigResolution;
}): Promise<z.infer<typeof searchOutputSchema>> {
    const { query, max_results, recency_days } = input;
    const maxResults = Math.max(1, Math.min(10, max_results ?? 5));
    const timeoutMs = 12_000;
    const effectiveQuery = augmentSearchQueryForDomain(query);
    const resolved = input.runtimeConfig ?? resolveRuntimeSearchConfig();
    const selectedProvider = resolved.settings.provider;
    const attempts = getRuntimeProviderAttempts(resolved);
    if (!providerApiKey(selectedProvider, resolved)) {
        console.warn(`[WebSearch] ${SEARCH_PROVIDER_LABELS[selectedProvider]} unavailable: missing_api_key`);
    }
    if (attempts.length === 0) {
        return {
            query,
            provider: selectedProvider,
            results: [],
            error: 'unavailable:no_configured_search_api_key',
        };
    }
    let droppedLowQualityResults = false;
    let lastError: string | undefined;
    let lastProvider: SearchProvider = attempts.at(-1)?.provider ?? selectedProvider;

    console.log(`[LlmConfig] Search provider configured: ${resolved.settings.provider}`);

    for (const attempt of attempts) {
        lastProvider = attempt.provider;
        console.log(`[WebSearch] Trying ${attempt.label} search...`);
        try {
            const rawResults = await executeSearchAttempt({
                attempt,
                query,
                effectiveQuery,
                maxResults,
                recencyDays: recency_days,
                timeoutMs,
                resolved,
            });
            const filteredResults = filterSearchResultsByQuality(query, rawResults, maxResults);
            if (filteredResults.length > 0) {
                return {
                    query,
                    provider: attempt.provider,
                    results: filteredResults,
                };
            }
            if (rawResults.length > 0) {
                droppedLowQualityResults = true;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            lastError = message;
            console.warn(`[WebSearch] ${attempt.label} failed: ${message}`);
            recordProviderFailure(attempt.provider, message);
        }
    }

    return {
        query,
        provider: lastProvider,
        results: [],
        error: lastError ?? (droppedLowQualityResults ? 'low_quality_results' : 'no_results'),
    };
}

export const searchWebTool = createTool({
    id: 'search_web',
    description: 'Search the web and return top results with links and snippets.',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    execute: async (rawInput) => {
        const input = searchInputSchema.parse(rawInput);
        return runWebSearch({
            query: input.query,
            max_results: input.max_results,
            recency_days: input.recency_days,
        });
    },
});

export const crawlUrlTool = createTool({
    id: 'crawl_url',
    description: 'Fetch a web page and return extracted readable text.',
    inputSchema: crawlInputSchema,
    outputSchema: crawlOutputSchema,
    execute: async (rawInput) => {
        const input = crawlInputSchema.parse(rawInput);
        return runCrawlUrl({
            url: input.url,
            maxChars: input.max_chars,
        });
    },
});

export const extractContentTool = createTool({
    id: 'extract_content',
    description: 'Extract readable text content from HTML or a URL.',
    inputSchema: extractInputSchema,
    outputSchema: extractOutputSchema,
    execute: async (rawInput) => {
        const input = extractInputSchema.parse(rawInput);
        return runExtractContent({
            url: input.url,
            html: input.html,
            maxChars: input.max_chars,
        });
    },
});
