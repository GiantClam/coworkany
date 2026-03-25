import { afterEach, describe, expect, test } from 'bun:test';
import { getNewsTool } from '../src/tools/personal/news';

const originalFetch = globalThis.fetch;
const originalNewsApiKey = process.env.NEWS_API_KEY;
const originalNewsRssFallback = process.env.ENABLE_NEWS_RSS_FALLBACK;

function restoreEnvironment(): void {
    globalThis.fetch = originalFetch;
    if (typeof originalNewsApiKey === 'undefined') {
        delete process.env.NEWS_API_KEY;
    } else {
        process.env.NEWS_API_KEY = originalNewsApiKey;
    }
    if (typeof originalNewsRssFallback === 'undefined') {
        delete process.env.ENABLE_NEWS_RSS_FALLBACK;
    } else {
        process.env.ENABLE_NEWS_RSS_FALLBACK = originalNewsRssFallback;
    }
}

afterEach(() => {
    restoreEnvironment();
});

describe('get_news RSS fallback', () => {
    test('uses Google News search RSS and parses mixed CDATA/plain tags', async () => {
        delete process.env.NEWS_API_KEY;
        process.env.ENABLE_NEWS_RSS_FALLBACK = '1';

        const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
<item>
  <title><![CDATA[MiniMax jumps 18% after funding round - Reuters]]></title>
  <link>https://example.com/reuters-minimax</link>
  <pubDate>Tue, 24 Mar 2026 17:10:00 GMT</pubDate>
  <description><![CDATA[<a href="https://example.com">Funding round details</a> with market reaction.]]></description>
</item>
<item>
  <title>MiniMax partners with cloud giant</title>
  <link>https://example.com/bloomberg-minimax</link>
  <pubDate>Tue, 24 Mar 2026 10:23:00 GMT</pubDate>
  <description>Partnership expands enterprise distribution.</description>
  <source>Bloomberg</source>
</item>
</channel></rss>`;

        const calledUrls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            calledUrls.push(String(input));
            return new Response(rssXml, {
                status: 200,
                headers: { 'content-type': 'application/rss+xml' },
            });
        }) as typeof fetch;

        const handler = getNewsTool.handler as (args: any) => Promise<any>;
        const result = await handler({
            query: 'MiniMax stock price surge today reason',
            max_results: 2,
        });

        expect(calledUrls[0]).toContain('news.google.com/rss/search');
        expect(calledUrls[0]).toContain('MiniMax%20stock%20price%20surge%20today%20reason');
        expect(result.success).toBe(true);
        expect(result.articles).toHaveLength(2);
        expect(result.articles[0].title).toBe('MiniMax jumps 18% after funding round');
        expect(result.articles[0].source).toBe('Reuters');
        expect(result.articles[1].title).toBe('MiniMax partners with cloud giant');
        expect(result.articles[1].source).toBe('Bloomberg');
        expect(result.quality?.degraded).toBe(false);
    });

    test('adds degraded-quality warning when RSS metadata is mostly missing', async () => {
        delete process.env.NEWS_API_KEY;
        process.env.ENABLE_NEWS_RSS_FALLBACK = '1';

        const lowQualityRssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss><channel>
<item><title></title><link>https://news.google.com/a</link><pubDate>Tue, 24 Mar 2026 17:10:00 GMT</pubDate><description>...</description></item>
<item><title></title><link>https://news.google.com/b</link><pubDate>Tue, 24 Mar 2026 16:10:00 GMT</pubDate><description>...</description></item>
<item><title></title><link>https://news.google.com/c</link><pubDate>Tue, 24 Mar 2026 15:10:00 GMT</pubDate><description>...</description></item>
</channel></rss>`;

        globalThis.fetch = (async () => {
            return new Response(lowQualityRssXml, {
                status: 200,
                headers: { 'content-type': 'application/rss+xml' },
            });
        }) as typeof fetch;

        const handler = getNewsTool.handler as (args: any) => Promise<any>;
        const result = await handler({
            query: 'MiniMax stock price surge',
            max_results: 3,
        });

        expect(result.success).toBe(true);
        expect(result.articles).toHaveLength(3);
        expect(result.quality?.degraded).toBe(true);
        expect(String(result.warning || '')).toContain('degraded');
    });

    test('fails fast when NEWS_API_KEY is missing and RSS fallback is disabled', async () => {
        delete process.env.NEWS_API_KEY;
        delete process.env.ENABLE_NEWS_RSS_FALLBACK;

        const handler = getNewsTool.handler as (args: any) => Promise<any>;
        const result = await handler({
            query: 'MiniMax stock price surge',
            max_results: 3,
        });

        expect(result.success).toBe(false);
        expect(String(result.error || '')).toContain('RSS fallback is disabled');
    });
});
