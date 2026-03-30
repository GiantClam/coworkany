import { ToolDefinition } from './standard';
export type SearchProvider = 'searxng' | 'tavily' | 'brave' | 'serper';
export interface SearchConfig {
    provider: SearchProvider;
    searxngUrl?: string;  // e.g., 'http://localhost:8080' or public instance
    tavilyApiKey?: string;
    braveApiKey?: string;
    serperApiKey?: string;
}
export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
    source?: string;
}
export interface SearchResponse {
    results: SearchResult[];
    query: string;
    provider: string;
    error?: string;
}
function isFreeWebSearchFallbackEnabled(): boolean {
    const value = process.env.ENABLE_WEBSEARCH_FREE_FALLBACK?.trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
}
interface SearXNGInstance {
    url: string;
    responseTime: number;
    uptime: number;
}
let cachedInstances: SearXNGInstance[] = [];
let lastFetchTime = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes cache
const FALLBACK_SEARXNG_INSTANCES = [
    'https://search.inetol.net',
    'https://searx.work',
    'https://search.ononoki.org',
    'https://searx.namejeff.xyz',
    'https://search.sapti.me',
    'https://searx.be',
];
async function fetchSearXNGInstances(): Promise<SearXNGInstance[]> {
    if (cachedInstances.length > 0 && Date.now() - lastFetchTime < CACHE_DURATION) {
        return cachedInstances;
    }
    try {
        console.error('[WebSearch] Fetching SearXNG instances from searx.space...');
        const response = await fetch('https://searx.space/data/instances.json', {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            signal: AbortSignal.timeout(5000), // 5s timeout
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch instances: ${response.status}`);
        }
        const data = await response.json() as {
            instances: Record<string, {
                http?: {
                    status?: boolean;
                    status_code?: number;
                    error?: string;
                };
                timing?: {
                    initial?: number;
                    search?: {
                        all?: { mean?: number };
                    };
                };
                uptime?: {
                    uptimeDay?: number;
                    uptimeWeek?: number;
                };
                network_type?: string;
                version?: string;
            }>;
        };
        const instances: SearXNGInstance[] = [];
        for (const [url, info] of Object.entries(data.instances)) {
            const httpOk = info.http?.status === true || info.http?.status_code === 200;
            const hasVersion = !!info.version;
            const notTor = info.network_type !== 'tor';
            const responseTime = info.timing?.search?.all?.mean ?? info.timing?.initial ?? 9999;
            const uptime = info.uptime?.uptimeWeek ?? info.uptime?.uptimeDay ?? 0;
            if (httpOk && hasVersion && notTor && responseTime < 5000 && uptime > 90) {
                instances.push({
                    url: url.replace(/\/$/, ''), // Remove trailing slash
                    responseTime,
                    uptime,
                });
            }
        }
        instances.sort((a, b) => {
            if (Math.abs(a.responseTime - b.responseTime) < 200) {
                return b.uptime - a.uptime; // If similar speed, prefer higher uptime
            }
            return a.responseTime - b.responseTime;
        });
        cachedInstances = instances.slice(0, 10);
        lastFetchTime = Date.now();
        console.error(`[WebSearch] Found ${cachedInstances.length} healthy SearXNG instances`);
        if (cachedInstances.length > 0) {
            console.error(`[WebSearch] Fastest instance: ${cachedInstances[0].url} (${cachedInstances[0].responseTime}ms)`);
        }
        return cachedInstances;
    } catch (error) {
        console.error(`[WebSearch] Failed to fetch instances from searx.space: ${error}`);
        return cachedInstances;
    }
}
async function getSearXNGInstances(): Promise<string[]> {
    const dynamicInstances = await fetchSearXNGInstances();
    if (dynamicInstances.length > 0) {
        return dynamicInstances.map(i => i.url);
    }
    console.error('[WebSearch] Using fallback static instance list');
    return FALLBACK_SEARXNG_INSTANCES;
}
async function searchSearXNG(
    query: string,
    count: number,
    baseUrl: string
): Promise<SearchResponse> {
    try {
        const params = new URLSearchParams({
            q: query,
            format: 'json',
            categories: 'general',
            language: 'auto',
            time_range: '',
            safesearch: '0',
        });
        const response = await fetch(`${baseUrl}/search?${params}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Connection': 'keep-alive',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
            },
            signal: AbortSignal.timeout(5000), // 5 second timeout
        });
        if (!response.ok) {
            throw new Error(`SearXNG error: ${response.status}`);
        }
        const data = await response.json() as {
            results: Array<{
                title: string;
                url: string;
                content: string;
                engine: string;
            }>;
        };
        const results: SearchResult[] = (data.results || [])
            .slice(0, count)
            .map(r => ({
                title: r.title,
                url: r.url,
                snippet: r.content,
                source: r.engine,
            }));
        return {
            results,
            query,
            provider: 'searxng',
        };
    } catch (error) {
        return {
            results: [],
            query,
            provider: 'searxng',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function searchTavily(
    query: string,
    count: number,
    apiKey: string
): Promise<SearchResponse> {
    try {
        const response = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                api_key: apiKey,
                query,
                max_results: count,
                include_answer: false,
                include_raw_content: false,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Tavily error: ${response.status} - ${errorText}`);
        }
        const data = await response.json() as {
            results: Array<{
                title: string;
                url: string;
                content: string;
            }>;
        };
        const results: SearchResult[] = (data.results || []).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content,
            source: 'tavily',
        }));
        return {
            results,
            query,
            provider: 'tavily',
        };
    } catch (error) {
        return {
            results: [],
            query,
            provider: 'tavily',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function searchBrave(
    query: string,
    count: number,
    apiKey: string
): Promise<SearchResponse> {
    try {
        const params = new URLSearchParams({
            q: query,
            count: String(count),
        });
        const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': apiKey,
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Brave error: ${response.status} - ${errorText}`);
        }
        const data = await response.json() as {
            web?: {
                results: Array<{
                    title: string;
                    url: string;
                    description: string;
                }>;
            };
        };
        const results: SearchResult[] = (data.web?.results || []).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.description,
            source: 'brave',
        }));
        return {
            results,
            query,
            provider: 'brave',
        };
    } catch (error) {
        return {
            results: [],
            query,
            provider: 'brave',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function searchSerper(
    query: string,
    count: number,
    apiKey: string
): Promise<SearchResponse> {
    try {
        console.error('[WebSearch] Trying Serper.dev search...');
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                q: query,
                num: Math.min(count, 20),
            }),
            signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Serper error: ${response.status} - ${errorText}`);
        }
        const data = await response.json() as {
            organic?: Array<{
                title: string;
                link: string;
                snippet: string;
                position?: number;
            }>;
            knowledgeGraph?: {
                title?: string;
                description?: string;
            };
        };
        const results: SearchResult[] = (data.organic || []).map(r => ({
            title: r.title,
            url: r.link,
            snippet: r.snippet || '',
            source: 'serper',
        }));
        console.error(`[WebSearch] Serper returned ${results.length} results`);
        return {
            results,
            query,
            provider: 'serper',
        };
    } catch (error) {
        console.error(`[WebSearch] Serper failed: ${error}`);
        return {
            results: [],
            query,
            provider: 'serper',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function searchGoogle(
    query: string,
    count: number
): Promise<SearchResponse> {
    try {
        console.error('[WebSearch] Trying Google search...');
        const params = new URLSearchParams({
            q: query,
            num: String(Math.min(count, 10)),
            hl: 'en',
        });
        const response = await fetch(`https://www.google.com/search?${params}`, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Upgrade-Insecure-Requests': '1',
            },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            throw new Error(`Google error: ${response.status}`);
        }
        const html = await response.text();
        const results: SearchResult[] = [];
        console.error(`[WebSearch] Google HTML length: ${html.length}`);
        const redirectPattern = /href="\/url\?q=(https?:\/\/[^&"]+)[^"]*"[^>]*>.*?<h3[^>]*>(.*?)<\/h3>/gis;
        let match;
        while ((match = redirectPattern.exec(html)) !== null && results.length < count) {
            const url = decodeURIComponent(match[1]);
            const title = match[2].replace(/<[^>]*>/g, '').trim();
            if (url && title && !url.includes('google.com') && !url.includes('webcache')) {
                results.push({
                    title,
                    url,
                    snippet: '',
                    source: 'google',
                });
            }
        }
        if (results.length === 0) {
            const directPattern = /<a[^>]+href="(https?:\/\/(?!www\.google\.)[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
            while ((match = directPattern.exec(html)) !== null && results.length < count) {
                const url = match[1];
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                if (url && title && !url.includes('google.com') && !url.includes('webcache') && !url.includes('translate.google')) {
                    results.push({
                        title,
                        url,
                        snippet: '',
                        source: 'google',
                    });
                }
            }
        }
        if (results.length === 0) {
            const dataHrefPattern = /data-href="(https?:\/\/[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
            while ((match = dataHrefPattern.exec(html)) !== null && results.length < count) {
                const url = match[1];
                const title = match[2].replace(/<[^>]*>/g, '').trim();
                if (url && title && !url.includes('google.com')) {
                    results.push({
                        title,
                        url,
                        snippet: '',
                        source: 'google',
                    });
                }
            }
        }
        console.error(`[WebSearch] Google parsed ${results.length} results`);
        return {
            results,
            query,
            provider: 'google',
        };
    } catch (error) {
        console.error(`[WebSearch] Google failed: ${error}`);
        return {
            results: [],
            query,
            provider: 'google',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
function detectDuckDuckGoCaptcha(html: string): boolean {
    const lowerHtml = html.toLowerCase();
    const captchaIndicators = [
        'anomaly-modal',
        'cc=botnet',
        'please verify',
        'select all squares',
        'unusual traffic',
        'automated requests',
        'are you a robot',
        'captcha',
        'challenge-form',
        'challenge-container',
    ];
    for (const indicator of captchaIndicators) {
        if (lowerHtml.includes(indicator)) {
            console.error(`[WebSearch] CAPTCHA indicator detected: "${indicator}"`);
            return true;
        }
    }
    return false;
}
async function searchDuckDuckGo(
    query: string,
    count: number
): Promise<SearchResponse> {
    try {
        console.error('[WebSearch] Trying DuckDuckGo Lite search...');
        const params = new URLSearchParams({
            q: query,
            kl: 'us-en',
        });
        const response = await fetch(`https://lite.duckduckgo.com/lite/?${params}`, {
            method: 'GET',
            headers: {
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            throw new Error(`DuckDuckGo error: ${response.status}`);
        }
        const html = await response.text();
        const results: SearchResult[] = [];
        console.error(`[WebSearch] DuckDuckGo HTML length: ${html.length}`);
        if (detectDuckDuckGoCaptcha(html)) {
            const errMsg = 'DuckDuckGo returned CAPTCHA / bot-detection page — automated requests blocked';
            console.error(`[WebSearch] ${errMsg}`);
            return {
                results: [],
                query,
                provider: 'duckduckgo',
                error: errMsg,
            };
        }
        const nofollowPattern = /<a[^>]+rel=["']nofollow["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const nofollowPattern2 = /<a[^>]+href=["']([^"']+)["'][^>]+rel=["']nofollow["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = nofollowPattern.exec(html)) !== null && results.length < count) {
            let url = match[1];
            const title = match[2].replace(/<[^>]*>/g, '').trim();
            if (url.startsWith('//duckduckgo.com/l/?')) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    url = decodeURIComponent(uddgMatch[1]);
                }
            } else if (url.startsWith('/l/?')) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    url = decodeURIComponent(uddgMatch[1]);
                }
            }
            if (url && title && url.startsWith('http') && !url.includes('duckduckgo.com')) {
                if (!results.some(r => r.url === url)) {
                    results.push({
                        title,
                        url,
                        snippet: '',
                        source: 'duckduckgo',
                    });
                }
            }
        }
        while ((match = nofollowPattern2.exec(html)) !== null && results.length < count) {
            let url = match[1];
            const title = match[2].replace(/<[^>]*>/g, '').trim();
            if (url.includes('uddg=')) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    url = decodeURIComponent(uddgMatch[1]);
                }
            }
            if (url && title && url.startsWith('http') && !url.includes('duckduckgo.com')) {
                if (!results.some(r => r.url === url)) {
                    results.push({
                        title,
                        url,
                        snippet: '',
                        source: 'duckduckgo',
                    });
                }
            }
        }
        if (results.length === 0) {
            const genericPattern = /<a[^>]+href=["'](https?:\/\/(?!duckduckgo\.com)[^"']+)["'][^>]*>([^<]+)<\/a>/gi;
            while ((match = genericPattern.exec(html)) !== null && results.length < count) {
                const url = match[1];
                const title = match[2].trim();
                if (url && title && title.length > 5 && !url.includes('ad.') && !url.includes('/ad')) {
                    if (!results.some(r => r.url === url)) {
                        results.push({
                            title,
                            url,
                            snippet: '',
                            source: 'duckduckgo',
                        });
                    }
                }
            }
        }
        console.error(`[WebSearch] DuckDuckGo parsed ${results.length} results`);
        return {
            results,
            query,
            provider: 'duckduckgo',
        };
    } catch (error) {
        console.error(`[WebSearch] DuckDuckGo failed: ${error}`);
        return {
            results: [],
            query,
            provider: 'duckduckgo',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
function shuffleArray<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function searchDuckDuckGoHTML(
    query: string,
    count: number
): Promise<SearchResponse> {
    try {
        console.error('[WebSearch] Trying DuckDuckGo HTML search...');
        const params = new URLSearchParams({
            q: query,
        });
        const response = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
            method: 'GET',
            headers: {
                'Accept': 'text/html',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            },
            signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
            throw new Error(`DuckDuckGo HTML error: ${response.status}`);
        }
        const html = await response.text();
        const results: SearchResult[] = [];
        console.error(`[WebSearch] DuckDuckGo HTML length: ${html.length}`);
        if (detectDuckDuckGoCaptcha(html)) {
            const errMsg = 'DuckDuckGo HTML returned CAPTCHA / bot-detection page — automated requests blocked';
            console.error(`[WebSearch] ${errMsg}`);
            return {
                results: [],
                query,
                provider: 'duckduckgo',
                error: errMsg,
            };
        }
        const resultPattern = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const resultPattern2 = /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*result__a[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        while ((match = resultPattern.exec(html)) !== null && results.length < count) {
            let url = match[1];
            const title = match[2].replace(/<[^>]*>/g, '').trim();
            if (url.includes('uddg=')) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    url = decodeURIComponent(uddgMatch[1]);
                }
            }
            if (url && title && url.startsWith('http') && !url.includes('duckduckgo.com')) {
                if (!results.some(r => r.url === url)) {
                    results.push({
                        title,
                        url,
                        snippet: '',
                        source: 'duckduckgo-html',
                    });
                }
            }
        }
        while ((match = resultPattern2.exec(html)) !== null && results.length < count) {
            let url = match[1];
            const title = match[2].replace(/<[^>]*>/g, '').trim();
            if (url.includes('uddg=')) {
                const uddgMatch = url.match(/uddg=([^&]+)/);
                if (uddgMatch) {
                    url = decodeURIComponent(uddgMatch[1]);
                }
            }
            if (url && title && url.startsWith('http') && !url.includes('duckduckgo.com')) {
                if (!results.some(r => r.url === url)) {
                    results.push({
                        title,
                        url,
                        snippet: '',
                        source: 'duckduckgo-html',
                    });
                }
            }
        }
        console.error(`[WebSearch] DuckDuckGo HTML parsed ${results.length} results`);
        return {
            results,
            query,
            provider: 'duckduckgo',
        };
    } catch (error) {
        console.error(`[WebSearch] DuckDuckGo HTML failed: ${error}`);
        return {
            results: [],
            query,
            provider: 'duckduckgo',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
async function searchSearXNGWithFallback(
    query: string,
    count: number,
    primaryUrl?: string
): Promise<SearchResponse> {
    const errors: string[] = [];
    const dynamicInstances = await getSearXNGInstances();
    const instances = primaryUrl
        ? [primaryUrl, ...dynamicInstances.filter(url => url !== primaryUrl)]
        : dynamicInstances;
    const instancesToTry = instances.slice(0, 4);
    console.error(`[WebSearch] Trying ${instancesToTry.length} SearXNG instances...`);
    for (let i = 0; i < instancesToTry.length; i++) {
        const url = instancesToTry[i];
        console.error(`[WebSearch] Trying SearXNG: ${url}`);
        const result = await searchSearXNG(query, count, url);
        if (!result.error && result.results.length > 0) {
            console.error(`[WebSearch] SearXNG ${url} succeeded with ${result.results.length} results`);
            return result;
        }
        const reason = result.error || 'no results';
        console.error(`[WebSearch] SearXNG ${url} failed: ${reason}`);
        errors.push(`SearXNG(${url}): ${reason}`);
        if (i < instancesToTry.length - 1) {
            await delay(100);
        }
    }
    console.error('[WebSearch] All SearXNG instances failed, trying Google scraping...');
    const googleResult = await searchGoogle(query, count);
    if (!googleResult.error && googleResult.results.length > 0) {
        return googleResult;
    }
    errors.push(`Google: ${googleResult.error || 'no results'}`);
    console.error('[WebSearch] Google failed, trying DuckDuckGo Lite...');
    const ddgLiteResult = await searchDuckDuckGo(query, count);
    if (!ddgLiteResult.error && ddgLiteResult.results.length > 0) {
        return ddgLiteResult;
    }
    errors.push(`DDG-Lite: ${ddgLiteResult.error || 'no results'}`);
    console.error('[WebSearch] DuckDuckGo Lite failed, trying DuckDuckGo HTML...');
    const ddgHtmlResult = await searchDuckDuckGoHTML(query, count);
    if (!ddgHtmlResult.error && ddgHtmlResult.results.length > 0) {
        return ddgHtmlResult;
    }
    errors.push(`DDG-HTML: ${ddgHtmlResult.error || 'no results'}`);
    const summary = errors.join(' | ');
    console.error(`[WebSearch] All free providers failed: ${summary}`);
    return {
        results: [],
        query,
        provider: 'searxng',
        error: `All free search providers failed. Configure a search API key (SERPER_API_KEY, TAVILY_API_KEY, or BRAVE_API_KEY) for reliable results. Details: ${summary}`,
    };
}
export async function performSearch(
    query: string,
    count: number = 10,
    config: SearchConfig
): Promise<SearchResponse> {
    const { provider, searxngUrl, tavilyApiKey, braveApiKey, serperApiKey } = config;
    const hasSearchApiKey = Boolean(serperApiKey || tavilyApiKey || braveApiKey);
    const allowFreeFallback = isFreeWebSearchFallbackEnabled();
    if (!hasSearchApiKey && !allowFreeFallback) {
        return {
            results: [],
            query,
            provider: 'disabled',
            error: 'search_web is disabled because no API key is configured. Set SERPER_API_KEY, TAVILY_API_KEY, or BRAVE_API_KEY. To force free fallback for debugging only, set ENABLE_WEBSEARCH_FREE_FALLBACK=1.',
        };
    }
    let result: SearchResponse;
    switch (provider) {
        case 'serper':
            if (!serperApiKey) {
                return { results: [], query, provider: 'serper', error: 'Serper API key not configured' };
            }
            result = await searchSerper(query, count, serperApiKey);
            break;
        case 'tavily':
            if (!tavilyApiKey) {
                return { results: [], query, provider: 'tavily', error: 'Tavily API key not configured' };
            }
            result = await searchTavily(query, count, tavilyApiKey);
            break;
        case 'brave':
            if (!braveApiKey) {
                return { results: [], query, provider: 'brave', error: 'Brave API key not configured' };
            }
            result = await searchBrave(query, count, braveApiKey);
            break;
        case 'searxng':
        default:
            result = await searchSearXNGWithFallback(query, count, searxngUrl);
            break;
    }
    if (result.error || result.results.length === 0) {
        if (provider !== 'serper' && serperApiKey) {
            const serperResult = await searchSerper(query, count, serperApiKey);
            if (!serperResult.error && serperResult.results.length > 0) {
                return serperResult;
            }
        }
        if (provider !== 'tavily' && tavilyApiKey) {
            const tavilyResult = await searchTavily(query, count, tavilyApiKey);
            if (!tavilyResult.error && tavilyResult.results.length > 0) {
                return tavilyResult;
            }
        }
        if (provider !== 'brave' && braveApiKey) {
            const braveResult = await searchBrave(query, count, braveApiKey);
            if (!braveResult.error && braveResult.results.length > 0) {
                return braveResult;
            }
        }
        if (allowFreeFallback && provider !== 'searxng') {
            const searxResult = await searchSearXNGWithFallback(query, count, searxngUrl);
            if (!searxResult.error && searxResult.results.length > 0) {
                return searxResult;
            }
        }
    }
    return result;
}
function extractDomain(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}
function truncateText(text: string, maxLength: number = 200): string {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength).trim() + '...';
}
function cleanSnippet(snippet: string): string {
    if (!snippet) return '';
    return snippet
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, ' ')
        .trim();
}
export function formatSearchResults(response: SearchResponse): string {
    if (response.error) {
        return `## ❌ Search Failed\n\n**Error:** ${response.error}\n\n**Query:** "${response.query}"\n\n> Try rephrasing your search query or check your network connection.`;
    }
    if (response.results.length === 0) {
        return `## 🔍 No Results Found\n\n**Query:** "${response.query}"\n\n> No matching results were found. Try using different keywords or broader search terms.`;
    }
    const header = [
        `## 🔍 Web Search Results`,
        ``,
        `**Query:** "${response.query}"`,
        `**Results:** ${response.results.length} | **Provider:** ${response.provider}`,
        ``,
        `---`,
        ``
    ].join('\n');
    const formattedResults = response.results.map((r, i) => {
        const domain = extractDomain(r.url);
        const snippet = truncateText(cleanSnippet(r.snippet), 250);
        const sourceInfo = r.source && r.source !== response.provider ? ` (via ${r.source})` : '';
        return [
            `### ${i + 1}. ${r.title}`,
            ``,
            `🔗 [${domain}](${r.url})${sourceInfo}`,
            ``,
            `> ${snippet || 'No description available.'}`,
        ].join('\n');
    }).join('\n\n');
    const footer = [
        ``,
        `---`,
        ``,
        `*💡 Click the links above to view full content. Results are ordered by relevance.*`
    ].join('\n');
    return header + formattedResults + footer;
}
export function formatSearchResultsCompact(response: SearchResponse): string {
    if (response.error) {
        return `Search failed: ${response.error}`;
    }
    if (response.results.length === 0) {
        return `No results for: "${response.query}"`;
    }
    const results = response.results.map((r, i) => {
        const domain = extractDomain(r.url);
        const snippet = truncateText(cleanSnippet(r.snippet), 100);
        return `${i + 1}. **${r.title}** (${domain})\n   ${snippet}`;
    }).join('\n\n');
    return `**Search: "${response.query}"** (${response.results.length} results via ${response.provider})\n\n${results}`;
}
let globalSearchConfig: SearchConfig = {
    provider: 'searxng',
};
export function setSearchConfig(config: Partial<SearchConfig>): void {
    globalSearchConfig = { ...globalSearchConfig, ...config };
}
export function getSearchConfig(): SearchConfig {
    return { ...globalSearchConfig };
}
export function loadSearchConfigFromEnv(): void {
    const provider = process.env.SEARCH_PROVIDER as SearchProvider | undefined;
    const searxngUrl = process.env.SEARXNG_URL;
    const tavilyApiKey = process.env.TAVILY_API_KEY;
    const braveApiKey = process.env.BRAVE_API_KEY;
    const serperApiKey = process.env.SERPER_API_KEY;
    if (provider) globalSearchConfig.provider = provider;
    if (searxngUrl) globalSearchConfig.searxngUrl = searxngUrl;
    if (tavilyApiKey) globalSearchConfig.tavilyApiKey = tavilyApiKey;
    if (braveApiKey) globalSearchConfig.braveApiKey = braveApiKey;
    if (serperApiKey) globalSearchConfig.serperApiKey = serperApiKey;
    if (!provider) {
        if (serperApiKey) {
            globalSearchConfig.provider = 'serper';
            console.error('[WebSearch] Auto-selected provider: serper (SERPER_API_KEY found)');
        } else if (tavilyApiKey) {
            globalSearchConfig.provider = 'tavily';
            console.error('[WebSearch] Auto-selected provider: tavily (TAVILY_API_KEY found)');
        } else if (braveApiKey) {
            globalSearchConfig.provider = 'brave';
            console.error('[WebSearch] Auto-selected provider: brave (BRAVE_API_KEY found)');
        } else {
            if (isFreeWebSearchFallbackEnabled()) {
                console.error('[WebSearch] No API keys found — ENABLE_WEBSEARCH_FREE_FALLBACK=1, using SearXNG/scraping fallback (unreliable)');
            } else {
                console.error('[WebSearch] No API keys found — search_web disabled (configure SERPER_API_KEY/TAVILY_API_KEY/BRAVE_API_KEY)');
            }
        }
    }
}
loadSearchConfigFromEnv();
export function createWebSearchTool(): ToolDefinition {
    return {
        name: 'search_web',
        description: 'Search the web for up-to-date information. Use this tool when the user asks about recent news, latest updates, current events, product information, or any topic that requires real-time data from the internet. This is your primary tool for answering questions about things that may have changed since your training data.',
        effects: ['network:outbound'],
        input_schema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query. Be specific and include relevant keywords.',
                },
                count: {
                    type: 'integer',
                    description: 'Number of results to return (default: 10, max: 20).',
                },
                compact: {
                    type: 'boolean',
                    description: 'If true, returns results in a compact format with shorter snippets. Useful when you need to preserve context space.',
                },
            },
            required: ['query'],
        },
        handler: async (args: { query: string; count?: number; compact?: boolean }) => {
            const { query, count = 10, compact = false } = args;
            const actualCount = Math.min(count, 20); // Cap at 20 results
            console.error(`[WebSearch] Searching for: "${query}" (count: ${actualCount}, compact: ${compact})`);
            const response = await performSearch(query, actualCount, globalSearchConfig);
            const formatted = compact
                ? formatSearchResultsCompact(response)
                : formatSearchResults(response);
            console.error(`[WebSearch] Found ${response.results.length} results via ${response.provider}`);
            if (response.error) {
                return {
                    success: false,
                    error: response.error,
                    provider: response.provider,
                    query: response.query,
                    formatted,
                };
            }
            return formatted;
        },
    };
}
export const webSearchTool = createWebSearchTool();
