import type { StoredToolpack } from '../storage/toolpackStore';
import type { ToolDefinition } from '../tools/standard';

export type RuntimeToolsetMap = Record<string, Record<string, unknown>>;

export type RuntimeToolResolver = (toolName: string) => ToolDefinition | undefined;
export type RuntimeToolpackState = {
    status: 'configured' | 'resolved' | 'callable' | 'blocked';
    blockedReason?: string;
    callableToolCount: number;
    resolvedToolCount: number;
    unresolvedTools: string[];
};

type BuildInternalRuntimeToolsetsInput = {
    toolpacks: StoredToolpack[];
    resolveTool: RuntimeToolResolver;
};

function normalizeToolpackId(toolpack: StoredToolpack): string {
    const fromManifest = typeof toolpack.manifest.id === 'string' ? toolpack.manifest.id.trim() : '';
    if (fromManifest.length > 0) {
        return fromManifest;
    }
    const fromName = typeof toolpack.manifest.name === 'string' ? toolpack.manifest.name.trim() : '';
    if (fromName.length > 0) {
        return fromName;
    }
    return 'unknown';
}

function normalizeToolpackServerCandidates(toolpack: StoredToolpack): string[] {
    const candidates = new Set<string>();
    const id = normalizeToolpackId(toolpack).trim().toLowerCase();
    if (id.length > 0) {
        candidates.add(id);
    }
    const name = typeof toolpack.manifest.name === 'string'
        ? toolpack.manifest.name.trim().toLowerCase()
        : '';
    if (name.length > 0) {
        candidates.add(name);
    }
    return [...candidates.values()];
}

function getDeclaredTools(toolpack: StoredToolpack): string[] {
    return Array.isArray(toolpack.manifest.tools)
        ? toolpack.manifest.tools.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
}

export function describeRuntimeToolpackState(input: {
    toolpack: StoredToolpack;
    resolveTool: RuntimeToolResolver;
    mcpToolsets?: RuntimeToolsetMap;
    mcpAllowedServerIds?: string[];
    mcpBlockedServerIds?: string[];
}): RuntimeToolpackState {
    const toolpack = input.toolpack;
    if (!toolpack.enabled) {
        return {
            status: 'configured',
            blockedReason: 'disabled_by_user',
            callableToolCount: 0,
            resolvedToolCount: 0,
            unresolvedTools: [],
        };
    }

    const declaredTools = getDeclaredTools(toolpack);
    if (declaredTools.length === 0) {
        return {
            status: 'blocked',
            blockedReason: 'no_declared_tools',
            callableToolCount: 0,
            resolvedToolCount: 0,
            unresolvedTools: [],
        };
    }

    if (toolpack.manifest.runtime === 'internal') {
        const resolvedTools = declaredTools.filter((toolName) => Boolean(input.resolveTool(toolName)));
        const unresolvedTools = declaredTools.filter((toolName) => !resolvedTools.includes(toolName));
        if (resolvedTools.length === 0) {
            return {
                status: 'blocked',
                blockedReason: 'internal_tools_unresolved',
                callableToolCount: 0,
                resolvedToolCount: 0,
                unresolvedTools,
            };
        }
        if (unresolvedTools.length > 0) {
            return {
                status: 'resolved',
                blockedReason: 'partial_internal_tools_unresolved',
                callableToolCount: resolvedTools.length,
                resolvedToolCount: resolvedTools.length,
                unresolvedTools,
            };
        }
        return {
            status: 'callable',
            callableToolCount: resolvedTools.length,
            resolvedToolCount: resolvedTools.length,
            unresolvedTools: [],
        };
    }

    const mcpToolsets = input.mcpToolsets ?? {};
    const allowedServerIds = new Set((input.mcpAllowedServerIds ?? []).map((value) => value.trim().toLowerCase()));
    const blockedServerIds = new Set((input.mcpBlockedServerIds ?? []).map((value) => value.trim().toLowerCase()));
    const serverCandidates = normalizeToolpackServerCandidates(toolpack);
    const matchedServerId = serverCandidates.find((candidate) => Object.prototype.hasOwnProperty.call(mcpToolsets, candidate));
    const declaredByMcp = matchedServerId
        ? Object.keys(mcpToolsets[matchedServerId] ?? {})
        : [];
    const resolvedTools = declaredTools.filter((toolName) => declaredByMcp.includes(toolName));
    const unresolvedTools = declaredTools.filter((toolName) => !resolvedTools.includes(toolName));

    const serverBlocked = serverCandidates.find((candidate) => blockedServerIds.has(candidate));
    if (serverBlocked) {
        return {
            status: 'blocked',
            blockedReason: 'mcp_server_blocked_by_policy',
            callableToolCount: 0,
            resolvedToolCount: resolvedTools.length,
            unresolvedTools,
        };
    }

    const serverAllowed = serverCandidates.find((candidate) => allowedServerIds.has(candidate));
    if (serverAllowed && !matchedServerId) {
        return {
            status: 'resolved',
            blockedReason: 'mcp_server_ready_but_tools_not_loaded',
            callableToolCount: 0,
            resolvedToolCount: 0,
            unresolvedTools,
        };
    }

    if (!matchedServerId && !serverAllowed) {
        return {
            status: 'configured',
            blockedReason: 'mcp_server_not_registered',
            callableToolCount: 0,
            resolvedToolCount: 0,
            unresolvedTools,
        };
    }

    if (resolvedTools.length === 0) {
        return {
            status: 'blocked',
            blockedReason: 'declared_tools_unavailable_in_mcp_runtime',
            callableToolCount: 0,
            resolvedToolCount: 0,
            unresolvedTools,
        };
    }

    if (unresolvedTools.length > 0) {
        return {
            status: 'resolved',
            blockedReason: 'partial_mcp_tools_unavailable',
            callableToolCount: resolvedTools.length,
            resolvedToolCount: resolvedTools.length,
            unresolvedTools,
        };
    }

    return {
        status: 'callable',
        callableToolCount: resolvedTools.length,
        resolvedToolCount: resolvedTools.length,
        unresolvedTools: [],
    };
}

export function buildInternalRuntimeToolsets(input: BuildInternalRuntimeToolsetsInput): RuntimeToolsetMap {
    const toolsets: RuntimeToolsetMap = {};
    for (const toolpack of input.toolpacks) {
        if (!toolpack.enabled) {
            continue;
        }
        const declaredTools = Array.isArray(toolpack.manifest.tools)
            ? toolpack.manifest.tools.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            : [];
        if (declaredTools.length === 0) {
            continue;
        }
        const callableTools: Record<string, unknown> = {};
        for (const toolName of declaredTools) {
            const resolved = input.resolveTool(toolName);
            if (!resolved) {
                continue;
            }
            callableTools[toolName] = {
                id: toolName,
                source: 'internal',
                toolpackId: normalizeToolpackId(toolpack),
                toolpackName: toolpack.manifest.name,
                description: resolved.description ?? '',
                effects: resolved.effects,
            };
        }
        if (Object.keys(callableTools).length === 0) {
            continue;
        }
        const serverId = `internal:${normalizeToolpackId(toolpack)}`;
        toolsets[serverId] = callableTools;
    }
    return toolsets;
}

export function countToolsInToolsets(toolsets: RuntimeToolsetMap): number {
    return Object.values(toolsets).reduce((count, serverTools) => (
        count + Object.keys(serverTools || {}).length
    ), 0);
}
