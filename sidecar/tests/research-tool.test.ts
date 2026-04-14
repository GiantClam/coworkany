import { afterEach, describe, expect, test } from 'bun:test';
import {
    augmentSearchQueryForDomain,
    filterSearchResultsByQuality,
    inferSearchDomain,
    runWebSearch,
} from '../src/mastra/tools/research';
import type { RuntimeSearchConfigResolution, RuntimeSearchProvider } from '../src/config/runtimeConfig';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
});

function makeRuntimeConfig(input: {
    provider: RuntimeSearchProvider;
    serperApiKey?: string;
    exaApiKey?: string;
    tavilyApiKey?: string;
    braveApiKey?: string;
}): RuntimeSearchConfigResolution {
    return {
        settings: {
            provider: input.provider,
            serperApiKey: input.serperApiKey,
            exaApiKey: input.exaApiKey,
            tavilyApiKey: input.tavilyApiKey,
            braveApiKey: input.braveApiKey,
        },
        loadedFromPath: null,
        candidatePaths: [],
        sources: {
            provider: 'test',
            serperApiKey: input.serperApiKey ? 'test' : 'unset',
            exaApiKey: input.exaApiKey ? 'test' : 'unset',
            tavilyApiKey: input.tavilyApiKey ? 'test' : 'unset',
            braveApiKey: input.braveApiKey ? 'test' : 'unset',
        },
        conflicts: [],
    };
}

describe('research tool quality policy', () => {
    test('detects query domain for market/weather/news/general', () => {
        expect(inferSearchDomain('今天 minimax 的港股股价怎么样？')).toBe('market');
        expect(inferSearchDomain('今天天气怎么样')).toBe('weather');
        expect(inferSearchDomain('今天有哪些 AI 新闻')).toBe('news');
        expect(inferSearchDomain('帮我写一份简洁日报')).toBe('general');
    });

    test('augments domain query with authoritative site filters', () => {
        const marketQuery = augmentSearchQueryForDomain('今天 minimax 的港股股价怎么样？');
        expect(marketQuery).toContain('site:hkex.com.hk');
        expect(marketQuery).toContain('site:finance.yahoo.com');

        const generalQuery = augmentSearchQueryForDomain('帮我写一份简洁日报');
        expect(generalQuery).toBe('帮我写一份简洁日报');
    });

    test('prefers authoritative market hosts when available', () => {
        const filtered = filterSearchResultsByQuality(
            '今天 minimax 的港股股价怎么样？',
            [
                {
                    title: '论坛讨论',
                    url: 'https://www.zhihu.com/question/123',
                    snippet: 'noise',
                },
                {
                    title: 'HKEX 公告',
                    url: 'https://www.hkex.com.hk/News/Market-Data',
                    snippet: 'official',
                },
            ],
            5,
        );

        expect(filtered).toHaveLength(1);
        expect(filtered[0]?.url).toContain('hkex.com.hk');
    });

    test('drops low-signal-only market results', () => {
        const filtered = filterSearchResultsByQuality(
            '今天 minimax 的港股股价怎么样？',
            [
                {
                    title: '讨论帖 1',
                    url: 'https://www.zhihu.com/question/123',
                    snippet: 'noise',
                },
                {
                    title: '讨论帖 2',
                    url: 'https://www.reddit.com/r/stocks/comments/abc',
                    snippet: 'noise',
                },
            ],
            5,
        );

        expect(filtered).toEqual([]);
    });

    test('prefers configured Serper provider over other configured providers', async () => {
        globalThis.fetch = async (input, init) => {
            expect(String(input)).toBe('https://google.serper.dev/search');
            const headers = new Headers(init?.headers);
            expect(headers.get('x-api-key')).toBe('serper-test-key');
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            expect(typeof body.q).toBe('string');
            return new Response(JSON.stringify({
                organic: [
                    {
                        title: 'AP News AI update',
                        link: 'https://apnews.com/article/ai-update',
                        snippet: 'Fresh AI update.',
                    },
                ],
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        };

        const result = await runWebSearch({
            query: 'latest AI news',
            runtimeConfig: makeRuntimeConfig({
                provider: 'serper',
                serperApiKey: 'serper-test-key',
            }),
        });

        expect(result.provider).toBe('serper');
        expect(result.results[0]?.url).toBe('https://apnews.com/article/ai-update');
    });

    test('supports Exa provider using compact highlights content', async () => {
        globalThis.fetch = async (input, init) => {
            expect(String(input)).toBe('https://api.exa.ai/search');
            const headers = new Headers(init?.headers);
            expect(headers.get('x-api-key')).toBe('exa-test-key');
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, any>;
            expect(body.type).toBe('auto');
            expect(body.num_results).toBe(5);
            expect(body.contents?.highlights?.max_characters).toBe(1200);
            return new Response(JSON.stringify({
                results: [
                    {
                        title: 'Reuters AI safety briefing',
                        url: 'https://www.reuters.com/world/us/ai-safety',
                        highlights: ['Compact summary from Exa'],
                        publishedDate: '2026-04-12T00:00:00.000Z',
                    },
                ],
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        };

        const result = await runWebSearch({
            query: 'latest AI safety research',
            runtimeConfig: makeRuntimeConfig({
                provider: 'exa',
                exaApiKey: 'exa-test-key',
            }),
        });

        expect(result.provider).toBe('exa');
        expect(result.results[0]?.snippet).toContain('Compact summary from Exa');
    });

    test('falls back from configured Serper to Exa when Serper fails', async () => {
        const calls: string[] = [];
        globalThis.fetch = async (input, init) => {
            calls.push(String(input));
            if (String(input) === 'https://google.serper.dev/search') {
                throw new Error('serper_unavailable');
            }
            if (String(input) === 'https://api.exa.ai/search') {
                const headers = new Headers(init?.headers);
                expect(headers.get('x-api-key')).toBe('exa-fallback-key');
                return new Response(JSON.stringify({
                    results: [
                        {
                            title: 'Bloomberg market recap',
                            url: 'https://www.bloomberg.com/news/articles/market-recap',
                            highlights: ['Exa fallback result'],
                        },
                    ],
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            throw new Error(`unexpected_url:${String(input)}`);
        };

        const result = await runWebSearch({
            query: 'latest market news',
            runtimeConfig: makeRuntimeConfig({
                provider: 'serper',
                serperApiKey: 'serper-primary-key',
                exaApiKey: 'exa-fallback-key',
            }),
        });

        expect(calls).toEqual([
            'https://google.serper.dev/search',
            'https://api.exa.ai/search',
        ]);
        expect(result.provider).toBe('exa');
        expect(result.results[0]?.url).toContain('bloomberg.com');
    });

    test('marks search unavailable immediately when no provider API key is configured', async () => {
        let called = false;
        globalThis.fetch = async () => {
            called = true;
            throw new Error('fetch_should_not_be_called');
        };

        const result = await runWebSearch({
            query: 'latest ai model releases',
            runtimeConfig: makeRuntimeConfig({
                provider: 'exa',
            }),
        });

        expect(called).toBe(false);
        expect(result.provider).toBe('exa');
        expect(result.results).toEqual([]);
        expect(result.error).toBe('unavailable:no_configured_search_api_key');
    });
});
