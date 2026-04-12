import { describe, expect, test } from 'bun:test';
import type { Tool } from '@mastra/core/tools';
import { resolveDynamicToolsetsWithTimeout, resetDynamicToolsetCacheForTests } from '../src/ipc/streaming';
import { resolveResearchTools } from '../src/mastra/agents/resolveResearchTools';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('streaming toolset resolution', () => {
    test('serves cached MCP toolsets when the latest resolution times out', async () => {
        resetDynamicToolsetCacheForTests();
        const previousTimeout = process.env.COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS;
        process.env.COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS = '10';
        let callCount = 0;
        try {
            const listMcpToolsetsFn = async () => {
                callCount += 1;
                if (callCount === 1) {
                    await sleep(30);
                    return {
                        runtime: {
                            search_web: { id: 'search_web' },
                        },
                    };
                }
                await sleep(30);
                return {
                    runtime: {
                        search_web: { id: 'search_web' },
                    },
                };
            };

            const first = await resolveDynamicToolsetsWithTimeout(true, {
                isMcpEnabledFn: () => true,
                listMcpToolsetsFn,
            });
            expect(first.loadStatus).toBe('timeout');
            expect(first.servedFromCache).toBe(false);

            await sleep(45);

            const second = await resolveDynamicToolsetsWithTimeout(true, {
                isMcpEnabledFn: () => true,
                listMcpToolsetsFn,
            });
            expect(second.loadStatus).toBe('timeout');
            expect(second.servedFromCache).toBe(true);
            expect(second.cacheAgeMs).not.toBeNull();
            expect(second.toolsets.runtime?.search_web).toBeDefined();
        } finally {
            if (typeof previousTimeout === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS = previousTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_MCP_TOOLSETS_TIMEOUT_MS;
            }
        }
    });
});

describe('researcher tools resolver', () => {
    test('keeps research tools and always provides bash fallback', async () => {
        const fakeSearchWebTool = { id: 'search_web' } as unknown as Tool<unknown, unknown, unknown, unknown>;
        const { tools, diagnostics } = await resolveResearchTools({
            listMcpToolsFn: async () => ({
                search_web: fakeSearchWebTool,
            }),
        });
        expect(tools.search_web).toBe(fakeSearchWebTool);
        expect(tools.bash).toBeDefined();
        expect(diagnostics.preferredResearchToolCount).toBe(1);
        expect(diagnostics.includesBashFallback).toBe(true);
    });

    test('keeps user-provided market tools even when names are not in built-in regex and prioritizes them before builtin search_web', async () => {
        const customMarketTool = { id: 'futu_realtime_quote' } as unknown as Tool<unknown, unknown, unknown, unknown>;
        const fakeSearchWebTool = { id: 'search_web' } as unknown as Tool<unknown, unknown, unknown, unknown>;
        const { tools } = await resolveResearchTools({
            listMcpToolsFn: async () => ({
                futu_realtime_quote: customMarketTool,
                search_web: fakeSearchWebTool,
            }),
        });

        const orderedToolNames = Object.keys(tools);
        expect(orderedToolNames[0]).toBe('futu_realtime_quote');
        expect(orderedToolNames).toContain('search_web');
        expect(orderedToolNames.at(-1)).toBe('bash');
    });
});
