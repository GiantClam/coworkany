import { ToolDefinition, ToolContext } from '../standard';

/**
 * News Query Tool - Uses NewsAPI with RSS fallback
 *
 * Provides latest news articles on topics or from specific sources
 */
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

        // If no API key, fallback to RSS
        if (!apiKey) {
            console.error('[News] API key not found, using RSS fallback');
            return await fetchFromRSS(category || 'technology', max_results);
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
            const data = await response.json() as any;

            if (data.status !== 'ok') {
                console.error('[News] API error:', data.message);

                // Fallback to RSS if API fails
                if (data.code === 'rateLimited' || data.code === 'apiKeyInvalid') {
                    console.error('[News] Falling back to RSS');
                    return await fetchFromRSS(category || 'technology', max_results);
                }

                return {
                    success: false,
                    error: data.message || 'News API error',
                    code: data.code,
                };
            }

            console.error(`[News] Found ${data.totalResults} articles, returning ${data.articles.length}`);

            return {
                success: true,
                total_results: data.totalResults,
                query: query || `${category || 'top'} headlines`,
                articles: data.articles.slice(0, max_results).map((article: any) => ({
                    title: article.title,
                    description: article.description,
                    source: article.source.name,
                    author: article.author,
                    url: article.url,
                    published_at: article.publishedAt,
                    image_url: article.urlToImage,
                })),
            };
        } catch (error) {
            console.error('[News] Error:', error);

            // Fallback to RSS on network error
            console.error('[News] Network error, falling back to RSS');
            return await fetchFromRSS(category || 'technology', max_results);
        }
    },
};

/**
 * RSS Fallback - Fetches news from Google News RSS feeds
 */
async function fetchFromRSS(
    category: string,
    maxResults: number
): Promise<{
    success: boolean;
    source?: string;
    articles?: any[];
    error?: string;
}> {
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

    const rssUrl = rssSources[category] || rssSources.technology;

    try {
        console.error(`[News RSS] Fetching from Google News RSS: ${category}`);

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
        const articles = parseRSSFeed(xml, maxResults);

        console.error(`[News RSS] Parsed ${articles.length} articles from RSS`);

        return {
            success: true,
            source: 'Google News RSS',
            articles,
        };
    } catch (error) {
        return {
            success: false,
            error: `RSS fallback failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Simple RSS Feed Parser
 */
function parseRSSFeed(xml: string, maxResults: number): any[] {
    const articles: any[] = [];

    // Simple regex-based parsing (good enough for Google News RSS)
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>/;
    const linkRegex = /<link>(.*?)<\/link>/;
    const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/;
    const descriptionRegex = /<description><!\[CDATA\[(.*?)\]\]><\/description>/;
    const sourceRegex = /<source[^>]*><!\[CDATA\[(.*?)\]\]><\/source>/;

    let match;
    while ((match = itemRegex.exec(xml)) !== null && articles.length < maxResults) {
        const itemXml = match[1];

        const title = titleRegex.exec(itemXml)?.[1] || 'No title';
        const link = linkRegex.exec(itemXml)?.[1] || '';
        const pubDate = pubDateRegex.exec(itemXml)?.[1] || '';
        const description = descriptionRegex.exec(itemXml)?.[1] || '';
        const source = sourceRegex.exec(itemXml)?.[1] || 'Unknown';

        articles.push({
            title: title.trim(),
            description: description.trim().substring(0, 200) + '...',
            source: source.trim(),
            url: link.trim(),
            published_at: pubDate,
        });
    }

    return articles;
}
