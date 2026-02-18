/**
 * Built-in Web Search MCP Server
 *
 * Provides web search and webpage fetching capabilities using DuckDuckGo.
 * This is loaded by default in all sessions.
 */

// ============================================================================
// Types
// ============================================================================

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface WebSearchInput {
    query: string;
    numResults?: number;
}

export interface FetchWebpageInput {
    url: string;
    extractText?: boolean;
}

export interface WebSearchOutput {
    results: SearchResult[];
    query: string;
}

export interface FetchWebpageOutput {
    url: string;
    title: string;
    content: string;
    contentType: string;
}

// ============================================================================
// DuckDuckGo Search
// ============================================================================

/**
 * Search using DuckDuckGo HTML API
 */
export async function webSearch(input: WebSearchInput): Promise<WebSearchOutput> {
    const { query, numResults = 5 } = input;

    console.log(`[WebSearch] Searching: ${query}`);

    try {
        // Use DuckDuckGo HTML API (no API key required)
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
        });

        if (!response.ok) {
            throw new Error(`Search failed: ${response.status}`);
        }

        const html = await response.text();
        const results = parseDuckDuckGoResults(html, numResults);

        return {
            results,
            query,
        };
    } catch (error) {
        console.error('[WebSearch] Error:', error);
        return {
            results: [],
            query,
        };
    }
}

/**
 * Parse DuckDuckGo HTML results
 */
function parseDuckDuckGoResults(html: string, limit: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Simple regex parsing for DuckDuckGo HTML results
    // Match result blocks: <a class="result__a" href="...">title</a>
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>)*[^<]*)<\/a>/gi;

    let match;
    const urls: string[] = [];
    const titles: string[] = [];

    while ((match = resultPattern.exec(html)) !== null && urls.length < limit) {
        // DuckDuckGo uses redirect URLs, extract the actual URL
        const redirectUrl = match[1];
        const actualUrl = extractActualUrl(redirectUrl);
        if (actualUrl && !actualUrl.includes('duckduckgo.com')) {
            urls.push(actualUrl);
            titles.push(decodeHtmlEntities(match[2].trim()));
        }
    }

    // Extract snippets
    const snippets: string[] = [];
    while ((match = snippetPattern.exec(html)) !== null && snippets.length < limit) {
        const snippet = match[1]
            .replace(/<[^>]+>/g, '') // Remove HTML tags
            .replace(/\s+/g, ' ')    // Normalize whitespace
            .trim();
        snippets.push(decodeHtmlEntities(snippet));
    }

    // Combine results
    for (let i = 0; i < Math.min(urls.length, limit); i++) {
        results.push({
            title: titles[i] || 'No title',
            url: urls[i],
            snippet: snippets[i] || '',
        });
    }

    return results;
}

/**
 * Extract actual URL from DuckDuckGo redirect URL
 */
function extractActualUrl(redirectUrl: string): string | null {
    try {
        // DuckDuckGo uses uddg= parameter for the actual URL
        const match = redirectUrl.match(/uddg=([^&]+)/);
        if (match) {
            return decodeURIComponent(match[1]);
        }
        // Fallback: might be a direct URL
        if (redirectUrl.startsWith('http') && !redirectUrl.includes('duckduckgo.com')) {
            return redirectUrl;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Decode HTML entities
 */
function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

// ============================================================================
// Webpage Fetcher
// ============================================================================

/**
 * Fetch and extract content from a webpage
 */
export async function fetchWebpage(input: FetchWebpageInput): Promise<FetchWebpageOutput> {
    const { url, extractText = true } = input;

    console.log(`[WebSearch] Fetching: ${url}`);

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
        });

        if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || 'text/html';
        const html = await response.text();

        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        const title = titleMatch ? decodeHtmlEntities(titleMatch[1].trim()) : 'No title';

        // Extract text content
        let content = html;
        if (extractText) {
            content = extractTextFromHtml(html);
        }

        return {
            url,
            title,
            content,
            contentType,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[WebSearch] Fetch error:', message);
        return {
            url,
            title: 'Error',
            content: `Failed to fetch: ${message}`,
            contentType: 'text/plain',
        };
    }
}

/**
 * Extract readable text from HTML
 */
function extractTextFromHtml(html: string): string {
    // Remove script and style elements
    let text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

    // Convert block elements to newlines
    text = text
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n');

    // Remove remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode entities and normalize whitespace
    text = decodeHtmlEntities(text)
        .replace(/\s+/g, ' ')
        .replace(/\n\s+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Limit content length
    if (text.length > 10000) {
        text = text.substring(0, 10000) + '\n\n[Content truncated...]';
    }

    return text;
}

// ============================================================================
// Tool Definitions (MCP format)
// ============================================================================

export const tools = {
    web_search: {
        name: 'web_search',
        description: 'Search the web using DuckDuckGo. Returns titles, URLs, and snippets.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Search query',
                },
                numResults: {
                    type: 'number',
                    description: 'Number of results to return (default: 5)',
                },
            },
            required: ['query'],
        },
        handler: webSearch,
    },
    fetch_webpage: {
        name: 'fetch_webpage',
        description: 'Fetch and extract text content from a webpage URL.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'URL to fetch',
                },
                extractText: {
                    type: 'boolean',
                    description: 'Whether to extract text only (default: true)',
                },
            },
            required: ['url'],
        },
        handler: fetchWebpage,
    },
};
