import type { Tool } from '@mastra/core/tools';

type ToolMap = Record<string, Tool<unknown, unknown, unknown, unknown>>;
type ToolsetMap = Record<string, ToolMap>;

export type McpClientLike = {
    listTools: () => Promise<ToolMap>;
    listToolsets: () => Promise<ToolsetMap>;
    disconnect: () => Promise<void>;
};

export type McpConnectionSnapshot = {
    enabled: boolean;
    status: 'disabled' | 'idle' | 'ready' | 'degraded';
    consecutiveFailures: number;
    lastConnectedAt?: string;
    lastFailureAt?: string;
    lastReconnectAt?: string;
    cacheAgeMs?: number;
    cachedToolCount: number;
    cachedToolsetCount: number;
};

type McpConnectionManagerOptions = {
    enabled: boolean;
    createClient: () => McpClientLike;
    cacheTtlMs?: number;
    reconnectMinIntervalMs?: number;
    onFailure?: (error: unknown) => void | Promise<void>;
};

export type McpConnectionManager = {
    listToolsSafe: () => Promise<ToolMap>;
    listToolsetsSafe: () => Promise<ToolsetMap>;
    disconnectSafe: () => Promise<void>;
    forceReconnect: () => Promise<void>;
    getSnapshot: () => McpConnectionSnapshot;
    isEnabled: () => boolean;
};

export function createMcpConnectionManager(options: McpConnectionManagerOptions): McpConnectionManager {
    const cacheTtlMs = typeof options.cacheTtlMs === 'number' && Number.isFinite(options.cacheTtlMs) && options.cacheTtlMs >= 0
        ? Math.floor(options.cacheTtlMs)
        : 5_000;
    const reconnectMinIntervalMs = typeof options.reconnectMinIntervalMs === 'number'
        && Number.isFinite(options.reconnectMinIntervalMs)
        && options.reconnectMinIntervalMs >= 0
        ? Math.floor(options.reconnectMinIntervalMs)
        : 2_000;

    // Lazily create MCP clients on first use to avoid duplicate client initialization
    // during module bootstrap and to keep startup resilient when MCP is unavailable.
    let client: McpClientLike | null = null;
    let status: McpConnectionSnapshot['status'] = options.enabled ? 'idle' : 'disabled';
    let consecutiveFailures = 0;
    let lastConnectedAt: string | undefined;
    let lastFailureAt: string | undefined;
    let lastReconnectAt: string | undefined;
    let cacheUpdatedAtMs: number | undefined;
    let toolsCache: ToolMap = {};
    let toolsetsCache: ToolsetMap = {};
    let toolsRefreshInFlight: Promise<ToolMap> | null = null;
    let toolsetsRefreshInFlight: Promise<ToolsetMap> | null = null;
    let reconnectInFlight: Promise<void> | null = null;

    function nowIso(): string {
        return new Date().toISOString();
    }

    function ensureClient(): McpClientLike {
        if (!client) {
            client = options.createClient();
        }
        return client;
    }

    function markSuccess(): void {
        consecutiveFailures = 0;
        lastConnectedAt = nowIso();
        status = 'ready';
        cacheUpdatedAtMs = Date.now();
    }

    async function markFailure(error: unknown): Promise<void> {
        consecutiveFailures += 1;
        lastFailureAt = nowIso();
        status = 'degraded';
        console.warn('[Mastra MCP] request failed:', error);
        try {
            await options.onFailure?.(error);
        } catch (onFailureError) {
            console.warn('[Mastra MCP] failure hook failed:', onFailureError);
        }
    }

    function shouldRefreshCache(): boolean {
        if (cacheUpdatedAtMs === undefined) {
            return true;
        }
        return (Date.now() - cacheUpdatedAtMs) > cacheTtlMs;
    }

    function shouldReconnect(): boolean {
        if (!options.enabled) {
            return false;
        }
        if (!lastReconnectAt) {
            return true;
        }
        const elapsed = Date.now() - Date.parse(lastReconnectAt);
        return Number.isFinite(elapsed) && elapsed >= reconnectMinIntervalMs;
    }

    async function reconnectSafe(force = false): Promise<void> {
        if (!options.enabled || (!force && !shouldReconnect())) {
            return;
        }
        if (reconnectInFlight) {
            await reconnectInFlight;
            return;
        }
        reconnectInFlight = (async () => {
        const previous = client;
        client = null;
        lastReconnectAt = nowIso();
        if (previous) {
            try {
                await previous.disconnect();
            } catch (error) {
                console.warn('[Mastra MCP] reconnect disconnect failed:', error);
            }
        }
        client = options.createClient();
        status = 'idle';
        })().finally(() => {
            reconnectInFlight = null;
        });
        await reconnectInFlight;
    }

    async function refreshTools(): Promise<ToolMap> {
        if (!options.enabled) {
            return {};
        }
        if (!shouldRefreshCache() && Object.keys(toolsCache).length > 0) {
            return toolsCache;
        }
        if (toolsRefreshInFlight) {
            return await toolsRefreshInFlight;
        }
        toolsRefreshInFlight = (async () => {
            try {
                const next = await ensureClient().listTools();
                toolsCache = next;
                markSuccess();
                return next;
            } catch (error) {
                await markFailure(error);
                try {
                    await reconnectSafe();
                } catch (reconnectError) {
                    console.warn('[Mastra MCP] reconnect after listTools failure failed:', reconnectError);
                }
                try {
                    const recovered = await ensureClient().listTools();
                    toolsCache = recovered;
                    markSuccess();
                    return recovered;
                } catch (retryError) {
                    await markFailure(retryError);
                }
                return toolsCache;
            } finally {
                toolsRefreshInFlight = null;
            }
        })();
        return await toolsRefreshInFlight;
    }

    async function refreshToolsets(): Promise<ToolsetMap> {
        if (!options.enabled) {
            return {};
        }
        if (!shouldRefreshCache() && Object.keys(toolsetsCache).length > 0) {
            return toolsetsCache;
        }
        if (toolsetsRefreshInFlight) {
            return await toolsetsRefreshInFlight;
        }
        toolsetsRefreshInFlight = (async () => {
            try {
                const next = await ensureClient().listToolsets();
                toolsetsCache = next;
                markSuccess();
                return next;
            } catch (error) {
                await markFailure(error);
                try {
                    await reconnectSafe();
                } catch (reconnectError) {
                    console.warn('[Mastra MCP] reconnect after listToolsets failure failed:', reconnectError);
                }
                try {
                    const recovered = await ensureClient().listToolsets();
                    toolsetsCache = recovered;
                    markSuccess();
                    return recovered;
                } catch (retryError) {
                    await markFailure(retryError);
                }
                return toolsetsCache;
            } finally {
                toolsetsRefreshInFlight = null;
            }
        })();
        return await toolsetsRefreshInFlight;
    }

    return {
        listToolsSafe: async () => {
            if (!options.enabled) {
                return {};
            }
            return await refreshTools();
        },
        listToolsetsSafe: async () => {
            if (!options.enabled) {
                return {};
            }
            return await refreshToolsets();
        },
        disconnectSafe: async () => {
            if (!options.enabled) {
                return;
            }
            const current = client;
            client = null;
            toolsRefreshInFlight = null;
            toolsetsRefreshInFlight = null;
            status = 'idle';
            if (!current) {
                return;
            }
            try {
                await current.disconnect();
            } catch (error) {
                console.warn('[Mastra MCP] disconnect failed:', error);
            }
        },
        forceReconnect: async () => {
            if (!options.enabled) {
                return;
            }
            toolsCache = {};
            toolsetsCache = {};
            cacheUpdatedAtMs = undefined;
            await reconnectSafe(true);
        },
        getSnapshot: () => ({
            enabled: options.enabled,
            status,
            consecutiveFailures,
            lastConnectedAt,
            lastFailureAt,
            lastReconnectAt,
            cacheAgeMs: cacheUpdatedAtMs === undefined ? undefined : Math.max(0, Date.now() - cacheUpdatedAtMs),
            cachedToolCount: Object.keys(toolsCache).length,
            cachedToolsetCount: Object.keys(toolsetsCache).length,
        }),
        isEnabled: () => options.enabled,
    };
}
