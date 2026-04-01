import { describe, expect, test } from 'bun:test';
import { createMcpConnectionManager, type McpClientLike } from '../src/mastra/mcp/connectionManager';

function createFakeClient(input?: {
    tools?: Record<string, unknown>;
    toolsets?: Record<string, Record<string, unknown>>;
    failToolsets?: boolean;
}): McpClientLike & { calls: { listTools: number; listToolsets: number; disconnect: number } } {
    const calls = {
        listTools: 0,
        listToolsets: 0,
        disconnect: 0,
    };
    return {
        calls,
        listTools: async () => {
            calls.listTools += 1;
            return (input?.tools ?? {}) as Record<string, never>;
        },
        listToolsets: async () => {
            calls.listToolsets += 1;
            if (input?.failToolsets) {
                throw new Error('toolsets_failed');
            }
            return (input?.toolsets ?? {}) as Record<string, Record<string, never>>;
        },
        disconnect: async () => {
            calls.disconnect += 1;
        },
    };
}

describe('mastra mcp connection manager', () => {
    test('returns empty values when MCP disabled', async () => {
        const manager = createMcpConnectionManager({
            enabled: false,
            createClient: () => createFakeClient(),
        });

        expect(await manager.listToolsSafe()).toEqual({});
        expect(await manager.listToolsetsSafe()).toEqual({});
        expect(manager.getSnapshot().status).toBe('disabled');
    });

    test('caches toolsets within TTL window', async () => {
        const fake = createFakeClient({
            toolsets: {
                playwright: {
                    click: {} as never,
                },
            },
        });
        const manager = createMcpConnectionManager({
            enabled: true,
            cacheTtlMs: 60_000,
            createClient: () => fake,
        });

        const first = await manager.listToolsetsSafe();
        const second = await manager.listToolsetsSafe();

        expect(Object.keys(first)).toContain('playwright');
        expect(Object.keys(second)).toContain('playwright');
        expect(fake.calls.listToolsets).toBe(1);
        expect(manager.getSnapshot().cachedToolsetCount).toBe(1);
    });

    test('reconnects after listToolsets failure and keeps runtime alive', async () => {
        const first = createFakeClient({ failToolsets: true });
        const second = createFakeClient({
            toolsets: {
                playwright: {
                    screenshot: {} as never,
                },
            },
        });
        const clients = [first, second];
        const manager = createMcpConnectionManager({
            enabled: true,
            cacheTtlMs: 0,
            reconnectMinIntervalMs: 0,
            createClient: () => clients.shift() ?? second,
        });

        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            const failedResult = await manager.listToolsetsSafe();
            expect(failedResult).toEqual({});
            expect(manager.getSnapshot().status).toBe('idle');

            const recovered = await manager.listToolsetsSafe();
            expect(Object.keys(recovered)).toContain('playwright');
            expect(first.calls.disconnect).toBeGreaterThanOrEqual(1);
            expect(manager.getSnapshot().status).toBe('ready');
        } finally {
            console.warn = originalWarn;
        }
    });
});
