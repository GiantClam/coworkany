import { ToolDefinition } from '../standard';
type NewsApiArticle = {
    title?: string;
    description?: string;
    source?: { name?: string };
    author?: string;
    url?: string;
    publishedAt?: string;
    urlToImage?: string;
};
type NewsApiResponse = {
    status?: string;
    message?: string;
    code?: string;
    totalResults?: number;
    articles?: NewsApiArticle[];
};
function isNewsRssFallbackEnabled(): boolean {
    const value = process.env.ENABLE_NEWS_RSS_FALLBACK?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
}
export const getNewsTool: ToolDefinition = {
    name: 'get_news',
    description: 'Get latest news on a topic, category, or from specific sources. Use when user asks about news, current events, or latest updates.',
    effects: ['network:outbound'],
    input_schema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'Search query for news articles (e.g., "AI technology", "climate change")',
            },
            category: {
                type: 'string',
                enum: [
                    'business',
                    'entertainment',
                    'general',
                    'health',
                    'science',
                    'sports',
                    'technology',
                ],
                description: 'News category (used for top headlines when no query provided)',
            },
            country: {
                type: 'string',
                description: 'Country code for top headlines (e.g., "us", "cn", "gb"). Only works without query.',
                default: 'us',
            },
            max_results: {
                type: 'integer',
                description: 'Maximum number of articles to return',
                default: 5,
                minimum: 1,
                maximum: 20,
            },
        },
    },
    handler: async (args: {
        query?: string;
        category?: string;
        country?: string;
        max_results?: number;
    }) => {
        const { query, category, country = 'us', max_results = 5 } = args;
        const apiKey = process.env.NEWS_API_KEY;
        const allowRssFallback = isNewsRssFallbackEnabled();
        if (!apiKey) {
            if (!allowRssFallback) {
                console.error('[News] API key not found and RSS fallback is disabled');
                return {
                    success: false,
                    error: 'NEWS_API_KEY is not configured and RSS fallback is disabled. Set NEWS_API_KEY, or explicitly enable fallback with ENABLE_NEWS_RSS_FALLBACK=1.',
                };
            }
            console.error('[News] API key not found, using RSS fallback (ENABLE_NEWS_RSS_FALLBACK=1)');
            return await fetchFromRSS({
                query,
                category: category || 'technology',
                country,
                maxResults: max_results,
            });
        }
        try {
            const endpoint = query
                ? 'https://newsapi.org/v2/everything'
                : 'https://newsapi.org/v2/top-headlines';
            const params = new URLSearchParams({
                apiKey,
                pageSize: String(max_results),
                language: 'en',
            });
            if (query) {
                params.set('q', query);
                params.set('sortBy', 'publishedAt');
            } else {
                if (category) params.set('category', category);
                if (country) params.set('country', country);
            }
            console.error(
                `[News] Fetching ${query ? `articles for "${query}"` : `${category || 'top'} headlines`}`
            );
            const response = await fetch(`${endpoint}?${params}`);
            const json = await response.json();
            const data = (json && typeof json === 'object' ? json : {}) as NewsApiResponse;
            if (data.status !== 'ok') {
                console.error('[News] API error:', data.message);
                if (data.code === 'rateLimited' || data.code === 'apiKeyInvalid') {
                    if (allowRssFallback) {
                        console.error('[News] Falling back to RSS (ENABLE_NEWS_RSS_FALLBACK=1)');
                        return await fetchFromRSS({
                            query,
                            category: category || 'technology',
                            country,
                            maxResults: max_results,
                        });
                    }
                    return {
                        success: false,
                        error: `News API failed (${data.code || 'unknown'}) and RSS fallback is disabled.`,
                        code: data.code,
                    };
                }
                return {
                    success: false,
                    error: data.message || 'News API error',
                    code: data.code,
                };
            }
            const articles = Array.isArray(data.articles) ? data.articles : [];
            console.error(`[News] Found ${data.totalResults ?? 0} articles, returning ${articles.length}`);
            return {
                success: true,
                total_results: data.totalResults ?? 0,
                query: query || `${category || 'top'} headlines`,
                articles: articles.slice(0, max_results).map((article) => ({
                    title: article.title,
                    description: article.description,
                    source: article.source?.name,
                    author: article.author,
                    url: article.url,
                    published_at: article.publishedAt,
                    image_url: article.urlToImage,
                })),
            };
        } catch (error) {
            console.error('[News] Error:', error);
            if (allowRssFallback) {
                console.error('[News] Network error, falling back to RSS (ENABLE_NEWS_RSS_FALLBACK=1)');
                return await fetchFromRSS({
                    query,
                    category: category || 'technology',
                    country,
                    maxResults: max_results,
                });
            }
            return {
                success: false,
                error: `News API request failed and RSS fallback is disabled: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
    },
};
type RSSFetchOptions = {
    query?: string;
    category: string;
    country?: string;
    maxResults: number;
};
type RSSQualitySummary = {
    totalArticles: number;
    untitledCount: number;
    unknownSourceCount: number;
    untitledRatio: number;
    unknownSourceRatio: number;
    degraded: boolean;
};
async function fetchFromRSS(
    options: RSSFetchOptions
): Promise<{
    success: boolean;
    source?: string;
    query?: string;
    articles?: any[];
    quality?: RSSQualitySummary;
    warning?: string;
    error?: string;
}> {
    const { query, category, country = 'us', maxResults } = options;
    const rssUrl = buildGoogleNewsRssUrl({
        query,
        category,
        country,
    });
    try {
        const queryLabel = query?.trim() ? `query="${query.trim()}"` : `category="${category}"`;
        console.error(`[News RSS] Fetching from Google News RSS: ${queryLabel}`);
        const response = await fetch(rssUrl, {
            headers: {
                'User-Agent': 'CoworkAny-Desktop/1.0 (News Reader)',
            },
        });
        if (!response.ok) {
            return {
                success: false,
                error: `RSS fetch failed: ${response.status}`,
            };
        }
        const xml = await response.text();
        const { articles, quality } = parseRSSFeed(xml, maxResults);
        console.error(`[News RSS] Parsed ${articles.length} articles from RSS`);
        const warning = quality.degraded
            ? 'RSS results are degraded (many entries are missing title/source). Prefer search_web with explicit ticker/exchange for market-sensitive analysis.'
            : undefined;
        return {
            success: articles.length > 0,
            source: 'Google News RSS',
            query: query?.trim() || undefined,
            articles,
            quality,
            warning,
        };
    } catch (error) {
        return {
            success: false,
            error: `RSS fallback failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}
function parseRSSFeed(xml: string, maxResults: number): {
    articles: any[];
    quality: RSSQualitySummary;
} {
    const articles: any[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && articles.length < maxResults) {
        const itemXml = match[1];
        const rawTitle = extractTagText(itemXml, 'title');
        const rawSource = extractTagText(itemXml, 'source');
        const rawDescription = extractTagText(itemXml, 'description');
        const link = extractTagText(itemXml, 'link');
        const pubDate = extractTagText(itemXml, 'pubDate');
        const { title, inferredSource } = normalizeGoogleNewsTitle(rawTitle || 'No title');
        const source = rawSource || inferredSource || 'Unknown';
        const cleanedDescription = stripHtml(rawDescription || '').trim();
        articles.push({
            title: title.trim() || 'No title',
            description: truncateText(cleanedDescription, 200),
            source: source.trim() || 'Unknown',
            url: link.trim(),
            published_at: pubDate,
        });
    }
    return {
        articles,
        quality: summarizeArticleQuality(articles),
    };
}
function buildGoogleNewsRssUrl(input: {
    query?: string;
    category: string;
    country?: string;
}): string {
    const { query, category, country = 'us' } = input;
    const trimmedQuery = query?.trim();
    if (trimmedQuery) {
        const encodedQuery = encodeURIComponent(trimmedQuery);
        return `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`;
    }
    const rssSources: Record<string, string> = {
        technology:
            'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB',
        business:
            'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
        health:
            'https://news.google.com/rss/topics/CAAqJQgKIh9DQkFTRVFvSUwyMHZNR3QwTlRFU0FtVnVHZ0pWVXlnQVAB',
        science:
            'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB',
        sports:
            'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
        entertainment:
            'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB',
        general: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en',
    };
    if (category === 'general') {
        const normalizedCountry = /^[a-z]{2}$/i.test(country) ? country.toUpperCase() : 'US';
        return `https://news.google.com/rss?hl=en-US&gl=${normalizedCountry}&ceid=${normalizedCountry}:en`;
    }
    return rssSources[category] || rssSources.technology;
}
function extractTagText(xml: string, tagName: string): string {
    const pattern = new RegExp(
        `<${tagName}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${tagName}>`,
        'i'
    );
    const matched = xml.match(pattern);
    const raw = (matched?.[1] ?? matched?.[2] ?? '')
        .replace(/^<!\[CDATA\[/i, '')
        .replace(/\]\]>$/i, '');
    return decodeHtmlEntities(raw).trim();
}
function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}
function stripHtml(value: string): string {
    return value
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function truncateText(value: string, maxLength: number): string {
    if (!value) {
        return '...';
    }
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength).trim()}...`;
}
function normalizeGoogleNewsTitle(rawTitle: string): { title: string; inferredSource?: string } {
    const normalized = rawTitle.trim();
    if (!normalized || normalized === 'No title') {
        return { title: 'No title' };
    }
    const titleParts = normalized.split(' - ').map((segment) => segment.trim()).filter(Boolean);
    if (titleParts.length >= 2) {
        const inferredSource = titleParts[titleParts.length - 1];
        const title = titleParts.slice(0, -1).join(' - ').trim();
        if (title.length >= 5) {
            return { title, inferredSource };
        }
    }
    return { title: normalized };
}
function summarizeArticleQuality(articles: Array<{ title?: string; source?: string }>): RSSQualitySummary {
    const totalArticles = articles.length;
    if (totalArticles === 0) {
        return {
            totalArticles: 0,
            untitledCount: 0,
            unknownSourceCount: 0,
            untitledRatio: 1,
            unknownSourceRatio: 1,
            degraded: true,
        };
    }
    const untitledCount = articles.filter((article) => {
        const title = (article.title || '').trim().toLowerCase();
        return !title || title === 'no title';
    }).length;
    const unknownSourceCount = articles.filter((article) => {
        const source = (article.source || '').trim().toLowerCase();
        return !source || source === 'unknown';
    }).length;
    const untitledRatio = untitledCount / totalArticles;
    const unknownSourceRatio = unknownSourceCount / totalArticles;
    const degraded = totalArticles >= 3 && (untitledRatio >= 0.4 || unknownSourceRatio >= 0.7);
    return {
        totalArticles,
        untitledCount,
        unknownSourceCount,
        untitledRatio,
        unknownSourceRatio,
        degraded,
    };
}
