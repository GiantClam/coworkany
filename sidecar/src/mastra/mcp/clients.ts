import type { Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { jsonSchemaToZod } from '@mastra/schema-compat/json-to-zod';
import { z } from 'zod/v4';
import {
    createMcpConnectionManager,
    type McpClientLike,
    type McpConnectionSnapshot,
} from './connectionManager';
import {
    McpServerSecurityStore,
    type McpServerScope,
    type McpServerSecuritySnapshot,
} from './security';

const MCP_ENABLED = process.env.COWORKANY_ENABLE_MCP === '1';
const WORKSPACE_ROOT = process.cwd();
const MCP_CLIENT_TIMEOUT_MS = (() => {
    const raw = Number.parseInt(process.env.COWORKANY_MCP_SERVER_TIMEOUT_MS ?? '', 10);
    if (!Number.isFinite(raw)) {
        return 10_000;
    }
    return Math.min(60_000, Math.max(1_000, Math.floor(raw)));
})();
const MCP_AUTO_DISABLE_FAILURE_THRESHOLD = (() => {
    const raw = Number.parseInt(process.env.COWORKANY_MCP_AUTO_DISABLE_FAILURE_THRESHOLD ?? '', 10);
    if (!Number.isFinite(raw)) {
        return 2;
    }
    return Math.min(10, Math.max(1, Math.floor(raw)));
})();
const MCP_SERVER_QUARANTINE_MS = (() => {
    const raw = Number.parseInt(process.env.COWORKANY_MCP_SERVER_QUARANTINE_MS ?? '', 10);
    if (!Number.isFinite(raw)) {
        return 180_000;
    }
    return Math.min(30 * 60_000, Math.max(1_000, Math.floor(raw)));
})();
const MCP_EMPTY_TOOLSET_RECOVERY_INTERVAL_MS = (() => {
    const raw = Number.parseInt(process.env.COWORKANY_MCP_EMPTY_TOOLSET_RECOVERY_INTERVAL_MS ?? '', 10);
    if (!Number.isFinite(raw)) {
        return 5_000;
    }
    return Math.min(60_000, Math.max(500, Math.floor(raw)));
})();
const mcpServerSecurityStore = new McpServerSecurityStore(WORKSPACE_ROOT);
let currentSecuritySnapshot = mcpServerSecurityStore.buildSnapshot();
let currentSecuritySignature = currentSecuritySnapshot.signature;
let mcpClientInstanceCounter = 0;
const mcpServerFailureCounts = new Map<string, number>();
const mcpServerQuarantineUntilMs = new Map<string, number>();
const schemaCompatibilityPatchedTools = new Set<string>();
let lastEmptyToolsetRecoveryAtMs = 0;
const JSON_SCHEMA_DRAFT_2020_12_PATTERN = /draft\/2020-12/iu;

function normalizeServerId(value: string): string {
    return value.trim().toLowerCase();
}

function extractMcpServerIdFromError(error: unknown): string | null {
    const text = String(error ?? '');
    const patterns = [
        /Could not connect to MCP server\s+([a-z0-9._-]+)/iu,
        /Failed to reconnect to MCP server\s+([a-z0-9._-]+)/iu,
        /MCP Server\s+([a-z0-9._-]+)\s+timeout/iu,
        /MCP server\s+([a-z0-9._-]+)/iu,
    ];
    for (const pattern of patterns) {
        const matched = text.match(pattern);
        if (matched?.[1]) {
            return normalizeServerId(matched[1]);
        }
    }
    return null;
}

function isSkippableMcpServerFailure(error: unknown): boolean {
    const text = String(error ?? '').toLowerCase();
    return text.includes('request timed out')
        || text.includes('connection closed')
        || text.includes('could not determine executable to run')
        || text.includes('not found - get https://registry.npmjs.org/')
        || text.includes('mcp_client_connect_failed')
        || text.includes('mcp_client_get_toolsets_failed');
}

function isServerQuarantined(serverId: string): boolean {
    const until = mcpServerQuarantineUntilMs.get(serverId);
    if (typeof until !== 'number') {
        return false;
    }
    if (until <= Date.now()) {
        mcpServerQuarantineUntilMs.delete(serverId);
        return false;
    }
    return true;
}

function quarantineServer(serverId: string, reason: unknown): boolean {
    const until = Date.now() + MCP_SERVER_QUARANTINE_MS;
    const previous = mcpServerQuarantineUntilMs.get(serverId) ?? 0;
    mcpServerQuarantineUntilMs.set(serverId, until);
    console.warn('[Mastra MCP] quarantined unhealthy MCP server; skipping it temporarily.', {
        serverId,
        quarantineMs: MCP_SERVER_QUARANTINE_MS,
        reason: String(reason),
    });
    return previous < Date.now();
}

function clearServerQuarantine(serverId: string): void {
    mcpServerQuarantineUntilMs.delete(serverId);
}

function toEffectiveMastraServerMap(snapshot: McpServerSecuritySnapshot): Record<string, {
    command: string;
    args: string[];
    env?: Record<string, string>;
}> {
    const allowed = new Set(
        snapshot.allowedServerIds.filter((serverId) => !isServerQuarantined(serverId)),
    );
    const output: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
    for (const server of snapshot.servers) {
        if (!allowed.has(server.id)) {
            continue;
        }
        output[server.id] = {
            command: server.command,
            args: server.args,
            env: server.env,
        };
    }
    return output;
}

function createDefaultClient(snapshot = currentSecuritySnapshot): McpClientLike {
    mcpClientInstanceCounter += 1;
    return new MCPClient({
        id: `coworkany-mcp-${process.pid}-${mcpClientInstanceCounter}`,
        timeout: MCP_CLIENT_TIMEOUT_MS,
        servers: toEffectiveMastraServerMap(snapshot),
    });
}

async function maybeAutoDisableUnhealthyServer(error: unknown): Promise<void> {
    if (!MCP_ENABLED) {
        return;
    }
    const serverId = extractMcpServerIdFromError(error);
    if (!serverId) {
        return;
    }
    const isSkippableFailure = isSkippableMcpServerFailure(error);
    if (isSkippableFailure) {
        const newlyQuarantined = quarantineServer(serverId, error);
        if (newlyQuarantined) {
            try {
                await mcpConnectionManager.forceReconnect();
            } catch (reconnectError) {
                console.warn('[Mastra MCP] reconnect after server quarantine failed:', reconnectError);
            }
        }
    }
    const snapshot = reloadSecuritySnapshot();
    const server = snapshot.servers.find((entry) => entry.id === serverId);
    if (!server || server.scope === 'managed' || !server.enabled) {
        return;
    }

    const nextFailures = (mcpServerFailureCounts.get(serverId) ?? 0) + 1;
    mcpServerFailureCounts.set(serverId, nextFailures);
    if (nextFailures < MCP_AUTO_DISABLE_FAILURE_THRESHOLD) {
        return;
    }

    const result = mcpServerSecurityStore.setEnabled(serverId, false);
    if (!result.success) {
        return;
    }
    const updated = reloadSecuritySnapshot();
    currentSecuritySignature = updated.signature;
    mcpServerFailureCounts.delete(serverId);
    clearServerQuarantine(serverId);
    console.warn('[Mastra MCP] auto-disabled unhealthy workspace MCP server', {
        serverId,
        failures: nextFailures,
        threshold: MCP_AUTO_DISABLE_FAILURE_THRESHOLD,
    });
    await mcpConnectionManager.forceReconnect();
}

const mcpConnectionManager = createMcpConnectionManager({
    enabled: MCP_ENABLED,
    cacheTtlMs: Number.parseInt(process.env.COWORKANY_MCP_TOOLSETS_CACHE_TTL_MS ?? '5000', 10),
    reconnectMinIntervalMs: Number.parseInt(process.env.COWORKANY_MCP_RECONNECT_MIN_INTERVAL_MS ?? '2000', 10),
    createClient: () => createDefaultClient(),
    onFailure: (error) => {
        void maybeAutoDisableUnhealthyServer(error);
    },
});

// Backward-compatible MCP export for tests and legacy callsites.
// This delegates to the connection manager instead of eagerly constructing clients.
export const mcp: McpClientLike = {
    listTools: async () => await mcpConnectionManager.listToolsSafe(),
    listToolsets: async () => await mcpConnectionManager.listToolsetsSafe(),
    disconnect: async () => await mcpConnectionManager.disconnectSafe(),
};

function mergeToolsetsIntoTools(
    toolsets: Record<string, Record<string, Tool<unknown, unknown, unknown, unknown>>>,
): Record<string, Tool<unknown, unknown, unknown, unknown>> {
    const tools: Record<string, Tool<unknown, unknown, unknown, unknown>> = {};
    for (const serverTools of Object.values(toolsets)) {
        for (const [toolName, tool] of Object.entries(serverTools)) {
            tools[toolName] = patchMcpToolForSchemaCompatibility(toolName, tool);
        }
    }
    return tools;
}

function safeReadMcpToolInputJsonSchema(
    tool: Tool<unknown, unknown, unknown, unknown>,
): Record<string, unknown> | null {
    try {
        const inputSchemaFactory = (
            tool as {
                inputSchema?: {
                    ['~standard']?: {
                        jsonSchema?: {
                            input?: (options?: { target?: 'input' | 'output' }) => unknown;
                        };
                    };
                };
            }
        ).inputSchema?.['~standard']?.jsonSchema?.input;
        if (typeof inputSchemaFactory !== 'function') {
            return null;
        }
        const schema = inputSchemaFactory({ target: 'input' });
        if (!schema || typeof schema !== 'object') {
            return null;
        }
        return schema as Record<string, unknown>;
    } catch {
        return null;
    }
}

function stripJsonSchemaDraftMetadata(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => stripJsonSchemaDraftMetadata(entry));
    }
    if (!value || typeof value !== 'object') {
        return value;
    }
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (key === '$schema') {
            continue;
        }
        output[key] = stripJsonSchemaDraftMetadata(nestedValue);
    }
    return output;
}

function toDraftAwareInputSchema(schema: Record<string, unknown>): unknown {
    const sanitized = stripJsonSchemaDraftMetadata(schema) as Record<string, unknown>;
    try {
        const serializedZodSchema = jsonSchemaToZod(sanitized);
        if (typeof serializedZodSchema !== 'string' || serializedZodSchema.trim().length === 0) {
            return sanitized;
        }
        const compiled = Function(
            'z',
            `"use strict"; return (${serializedZodSchema});`,
        )(z) as { safeParse?: unknown };
        if (typeof compiled?.safeParse === 'function') {
            return compiled;
        }
    } catch {
        // Fall back to sanitized JSON schema when conversion fails.
    }
    return sanitized;
}

function patchMcpToolForSchemaCompatibility(
    toolName: string,
    tool: Tool<unknown, unknown, unknown, unknown>,
): Tool<unknown, unknown, unknown, unknown> {
    const inputJsonSchema = safeReadMcpToolInputJsonSchema(tool);
    if (!inputJsonSchema) {
        return tool;
    }
    const declaredDraft = typeof inputJsonSchema?.$schema === 'string'
        ? inputJsonSchema.$schema
        : '';
    if (!declaredDraft || !JSON_SCHEMA_DRAFT_2020_12_PATTERN.test(declaredDraft)) {
        return tool;
    }

    if (!schemaCompatibilityPatchedTools.has(toolName)) {
        schemaCompatibilityPatchedTools.add(toolName);
        console.warn('[Mastra MCP] patched tool input schema for draft-2020-12 compatibility.', {
            toolName,
            declaredDraft,
        });
    }

    // Mutate the existing tool instance instead of cloning:
    // Tool.execute() closes over `this.inputSchema`, so cloning would not change validation behavior.
    (
        tool as {
            inputSchema?: unknown;
        }
    ).inputSchema = toDraftAwareInputSchema(inputJsonSchema);

    return tool;
}

export const __mcpSchemaCompatForTests = {
    safeReadMcpToolInputJsonSchema,
    toDraftAwareInputSchema,
    patchMcpToolForSchemaCompatibility,
};

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
        Object.entries(raw).filter(([serverId]) => (
            allowedIds.has(serverId) && !isServerQuarantined(serverId)
        )),
    );
    if (Object.keys(filtered).length > 0 || allowedIds.size === 0) {
        return filtered;
    }

    const nowMs = Date.now();
    if (nowMs - lastEmptyToolsetRecoveryAtMs < MCP_EMPTY_TOOLSET_RECOVERY_INTERVAL_MS) {
        return filtered;
    }
    lastEmptyToolsetRecoveryAtMs = nowMs;
    console.warn('[Mastra MCP] toolsets empty while servers are allowed; forcing reconnect to refresh runtime toolsets.', {
        allowedServerCount: allowedIds.size,
        recoveryIntervalMs: MCP_EMPTY_TOOLSET_RECOVERY_INTERVAL_MS,
    });
    try {
        await mcpConnectionManager.forceReconnect();
        const retried = await mcpConnectionManager.listToolsetsSafe();
        return Object.fromEntries(
            Object.entries(retried).filter(([serverId]) => (
                allowedIds.has(serverId) && !isServerQuarantined(serverId)
            )),
        );
    } catch (error) {
        console.warn('[Mastra MCP] forced reconnect after empty toolsets failed:', error);
        return filtered;
    }
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
        mcpServerFailureCounts.delete(normalizeServerId(input.id));
        clearServerQuarantine(normalizeServerId(input.id));
    }
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
    if (result.success && enabled) {
        mcpServerFailureCounts.delete(normalizeServerId(id));
        clearServerQuarantine(normalizeServerId(id));
    }
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
        mcpServerFailureCounts.delete(normalizeServerId(id));
        clearServerQuarantine(normalizeServerId(id));
    }
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
