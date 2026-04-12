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

    test('does not eagerly create MCP client before first tool request', async () => {
        let createCalls = 0;
        const manager = createMcpConnectionManager({
            enabled: true,
            createClient: () => {
                createCalls += 1;
                return createFakeClient();
            },
        });

        expect(createCalls).toBe(0);
        await manager.listToolsetsSafe();
        expect(createCalls).toBe(1);
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

    test('recovers in the same call after listToolsets failure when reconnect target is healthy', async () => {
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
            const recovered = await manager.listToolsetsSafe();
            expect(Object.keys(recovered)).toContain('playwright');
            expect(first.calls.disconnect).toBeGreaterThanOrEqual(1);
            expect(manager.getSnapshot().status).toBe('ready');
        } finally {
            console.warn = originalWarn;
        }
    });

    test('invokes onFailure callback when MCP request fails', async () => {
        const fake = createFakeClient({ failToolsets: true });
        const failures: string[] = [];
        const manager = createMcpConnectionManager({
            enabled: true,
            cacheTtlMs: 0,
            reconnectMinIntervalMs: 0,
            createClient: () => fake,
            onFailure: (error) => {
                failures.push(String(error));
            },
        });

        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            await manager.listToolsetsSafe();
        } finally {
            console.warn = originalWarn;
        }

        expect(failures.length).toBeGreaterThanOrEqual(1);
        expect(failures[0]).toContain('toolsets_failed');
    });

    test('stays alive when createClient throws and returns cached fallback', async () => {
        let createAttempts = 0;
        const failures: string[] = [];
        const manager = createMcpConnectionManager({
            enabled: true,
            cacheTtlMs: 0,
            reconnectMinIntervalMs: 0,
            createClient: () => {
                createAttempts += 1;
                throw new Error('client_init_failed');
            },
            onFailure: (error) => {
                failures.push(String(error));
            },
        });

        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            const toolsets = await manager.listToolsetsSafe();
            expect(toolsets).toEqual({});
            expect(manager.getSnapshot().status).toBe('degraded');
        } finally {
            console.warn = originalWarn;
        }

        expect(createAttempts).toBeGreaterThan(0);
        expect(failures.some((entry) => entry.includes('client_init_failed'))).toBe(true);
    });
});
