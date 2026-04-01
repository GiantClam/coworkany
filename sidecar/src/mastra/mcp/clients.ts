import type { Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import {
    createMcpConnectionManager,
    type McpClientLike,
    type McpConnectionSnapshot,
} from './connectionManager';
import {
    McpServerSecurityStore,
    toMastraServerMap,
    type McpServerScope,
    type McpServerSecuritySnapshot,
} from './security';

const MCP_ENABLED = process.env.COWORKANY_ENABLE_MCP === '1';
const WORKSPACE_ROOT = process.cwd();
const mcpServerSecurityStore = new McpServerSecurityStore(WORKSPACE_ROOT);
let currentSecuritySnapshot = mcpServerSecurityStore.buildSnapshot();
let currentSecuritySignature = currentSecuritySnapshot.signature;

function createDefaultClient(snapshot = currentSecuritySnapshot): McpClientLike {
    return new MCPClient({
        timeout: 10_000,
        servers: toMastraServerMap(snapshot),
    });
}

export let mcp = createDefaultClient();

const mcpConnectionManager = createMcpConnectionManager({
    enabled: MCP_ENABLED,
    cacheTtlMs: Number.parseInt(process.env.COWORKANY_MCP_TOOLSETS_CACHE_TTL_MS ?? '5000', 10),
    reconnectMinIntervalMs: Number.parseInt(process.env.COWORKANY_MCP_RECONNECT_MIN_INTERVAL_MS ?? '2000', 10),
    createClient: () => {
        mcp = createDefaultClient();
        return mcp;
    },
});

function mergeToolsetsIntoTools(
    toolsets: Record<string, Record<string, Tool<unknown, unknown, unknown, unknown>>>,
): Record<string, Tool<unknown, unknown, unknown, unknown>> {
    const tools: Record<string, Tool<unknown, unknown, unknown, unknown>> = {};
    for (const serverTools of Object.values(toolsets)) {
        for (const [toolName, tool] of Object.entries(serverTools)) {
            tools[toolName] = tool;
        }
    }
    return tools;
}

function reloadSecuritySnapshot(): McpServerSecuritySnapshot {
    mcpServerSecurityStore.reload();
    currentSecuritySnapshot = mcpServerSecurityStore.buildSnapshot();
    return currentSecuritySnapshot;
}

async function ensureMcpSecurityFresh(): Promise<McpServerSecuritySnapshot> {
    const next = reloadSecuritySnapshot();
    if (next.signature !== currentSecuritySignature) {
        currentSecuritySignature = next.signature;
        await mcpConnectionManager.forceReconnect();
    }
    return next;
}

export async function listMcpToolsSafe(): Promise<Record<string, Tool<unknown, unknown, unknown, unknown>>> {
    const toolsets = await listMcpToolsetsSafe();
    return mergeToolsetsIntoTools(toolsets);
}

export async function listMcpToolsetsSafe(): Promise<Record<string, Record<string, Tool<unknown, unknown, unknown, unknown>>>> {
    if (!MCP_ENABLED) {
        return {};
    }
    const securitySnapshot = await ensureMcpSecurityFresh();
    const raw = await mcpConnectionManager.listToolsetsSafe();
    const allowedIds = new Set(securitySnapshot.allowedServerIds);
    const filtered = Object.fromEntries(
        Object.entries(raw).filter(([serverId]) => allowedIds.has(serverId)),
    );
    return filtered;
}

export async function disconnectMcpSafe(): Promise<void> {
    await mcpConnectionManager.disconnectSafe();
}

export async function refreshMcpConnections(): Promise<void> {
    await mcpConnectionManager.forceReconnect();
}

export function getMcpConnectionSnapshot(): McpConnectionSnapshot {
    return mcpConnectionManager.getSnapshot();
}

export function getMcpSecuritySnapshot(): McpServerSecuritySnapshot {
    return reloadSecuritySnapshot();
}

export async function upsertMcpServerDefinition(input: {
    id: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    scope?: McpServerScope;
    enabled?: boolean;
    approved?: boolean;
    description?: string;
}): Promise<{ success: boolean; error?: string; snapshot: McpServerSecuritySnapshot }> {
    const result = mcpServerSecurityStore.upsert(input);
    const snapshot = reloadSecuritySnapshot();
    currentSecuritySignature = snapshot.signature;
    if (result.success) {
        await mcpConnectionManager.forceReconnect();
    }
    return {
        success: result.success,
        error: result.error,
        snapshot,
    };
}

export async function setMcpServerEnabledPolicy(
    id: string,
    enabled: boolean,
): Promise<{ success: boolean; error?: string; snapshot: McpServerSecuritySnapshot }> {
    const result = mcpServerSecurityStore.setEnabled(id, enabled);
    const snapshot = reloadSecuritySnapshot();
    currentSecuritySignature = snapshot.signature;
    if (result.success) {
        await mcpConnectionManager.forceReconnect();
    }
    return {
        success: result.success,
        error: result.error,
        snapshot,
    };
}

export async function setMcpServerApprovalPolicy(
    id: string,
    approved: boolean,
): Promise<{ success: boolean; error?: string; snapshot: McpServerSecuritySnapshot }> {
    const result = mcpServerSecurityStore.setApproval(id, approved);
    const snapshot = reloadSecuritySnapshot();
    currentSecuritySignature = snapshot.signature;
    if (result.success) {
        await mcpConnectionManager.forceReconnect();
    }
    return {
        success: result.success,
        error: result.error,
        snapshot,
    };
}

export async function removeMcpServerDefinition(
    id: string,
): Promise<{ success: boolean; error?: string; snapshot: McpServerSecuritySnapshot }> {
    const result = mcpServerSecurityStore.remove(id);
    const snapshot = reloadSecuritySnapshot();
    currentSecuritySignature = snapshot.signature;
    if (result.success) {
        await mcpConnectionManager.forceReconnect();
    }
    return {
        success: result.success,
        error: result.error,
        snapshot,
    };
}

export function isMcpEnabled(): boolean {
    return mcpConnectionManager.isEnabled();
}
