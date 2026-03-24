import { type ToolDefinition } from './standard';
import { type MCPGateway } from '../mcp/gateway';
import { applyDisabledToolFilter } from './disableTools';
import {
    buildCapabilityDescriptor,
    detectCapabilityConflicts,
    type CapabilityConflict,
    type CapabilityDescriptor,
    type CapabilityProvider,
} from './capabilityCatalog';

export type DuplicateResolutionPolicy =
    | 'prefer_mcp'
    | 'prefer_builtin'
    | 'prefer_opencli'
    | 'skip_conflicts';
export type OverlapResolutionPolicy =
    | 'keep_all'
    | 'prefer_mcp'
    | 'prefer_builtin'
    | 'prefer_opencli'
    | 'prefer_non_interactive'
    | 'skip_overlaps';

export type TaskToolResolverConfig = {
    enabledToolpacks?: string[];
    disabledTools?: string[];
    duplicateResolution?: DuplicateResolutionPolicy;
    overlapResolution?: OverlapResolutionPolicy;
};

export type OpencliCapabilityEntry = {
    id: string;
    description?: string;
    sourceId?: string;
};

export type TaskToolResolverDeps = {
    config?: TaskToolResolverConfig;
    standardTools: ToolDefinition[];
    builtinTools: ToolDefinition[];
    controlPlaneTools: ToolDefinition[];
    knowledgeTools: ToolDefinition[];
    personalTools: ToolDefinition[];
    databaseTools: ToolDefinition[];
    enhancedBrowserTools: ToolDefinition[];
    selfLearningTools: ToolDefinition[];
    extraBuiltinTools?: ToolDefinition[];
    opencliCapabilities?: OpencliCapabilityEntry[];
    opencliExecutorToolName?: string;
    mcpGateway: MCPGateway;
};

type TaskToolCandidate = {
    descriptor: CapabilityDescriptor;
    tool: ToolDefinition;
};

export type TaskToolResolutionResult = {
    tools: ToolDefinition[];
    capabilityCatalog: CapabilityDescriptor[];
    conflicts: CapabilityConflict[];
    skippedToolNames: string[];
    skippedSemanticKeys: string[];
};

export function resolveToolsForTask(deps: TaskToolResolverDeps): ToolDefinition[] {
    return resolveToolsForTaskWithDiagnostics(deps).tools;
}

export function resolveToolsForTaskWithDiagnostics(deps: TaskToolResolverDeps): TaskToolResolutionResult {
    const builtinTools: ToolDefinition[] = [
        ...deps.standardTools,
        ...deps.builtinTools,
        ...deps.controlPlaneTools,
        ...deps.knowledgeTools,
        ...deps.personalTools,
        ...deps.databaseTools,
        ...deps.enhancedBrowserTools,
        ...(deps.extraBuiltinTools ?? []),
        ...deps.selfLearningTools,
    ];

    const candidates: TaskToolCandidate[] = [];

    for (const tool of builtinTools) {
        candidates.push({
            descriptor: buildCapabilityDescriptor({
                provider: 'builtin',
                toolName: tool.name,
                description: tool.description,
                effects: tool.effects,
                inputSchema: tool.input_schema,
            }),
            tool,
        });
    }

    const opencliExecutorToolName = deps.opencliExecutorToolName ?? 'execute_opencli_capability';
    const opencliExecutorTool = builtinTools.find((tool) => tool.name === opencliExecutorToolName);
    const opencliTools = buildOpencliVirtualTools({
        capabilities: deps.opencliCapabilities ?? [],
        executorTool: opencliExecutorTool,
    });
    candidates.push(...opencliTools);

    const enabledToolpacks = deps.config?.enabledToolpacks || [];
    const availableMcpTools = deps.mcpGateway.getAvailableTools();

    for (const { server, tool } of availableMcpTools) {
        const isEnabled = enabledToolpacks.some((id) => id.includes(server) || id === server);
        if (!isEnabled) {
            continue;
        }

        const mappedTool: ToolDefinition = {
            name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema as Record<string, unknown>,
            effects: ['network:outbound'],
            handler: async (args, context) => {
                return deps.mcpGateway.callTool({
                    sessionId: context.taskId,
                    toolName: tool.name,
                    serverName: server,
                    arguments: args,
                });
            },
        };

        candidates.push({
            descriptor: buildCapabilityDescriptor({
                provider: 'mcp',
                toolName: tool.name,
                sourceId: server,
                description: tool.description || '',
                effects: mappedTool.effects,
                inputSchema: mappedTool.input_schema,
            }),
            tool: mappedTool,
        });
    }

    const capabilityCatalog = candidates.map((candidate) => candidate.descriptor);
    const conflicts = detectCapabilityConflicts(capabilityCatalog);

    const duplicateResolution = deps.config?.duplicateResolution ?? 'prefer_mcp';
    const byName = new Map<string, TaskToolCandidate[]>();

    for (const candidate of candidates) {
        const bucket = byName.get(candidate.descriptor.toolName) ?? [];
        bucket.push(candidate);
        byName.set(candidate.descriptor.toolName, bucket);
    }

    const selectedCandidates: TaskToolCandidate[] = [];
    const skippedToolNames: string[] = [];

    for (const [toolName, bucket] of byName.entries()) {
        if (bucket.length === 1) {
            selectedCandidates.push(bucket[0]!);
            continue;
        }

        if (duplicateResolution === 'skip_conflicts') {
            skippedToolNames.push(toolName);
            continue;
        }

        const preferredProvider: CapabilityProvider = duplicateResolution === 'prefer_builtin'
            ? 'builtin'
            : duplicateResolution === 'prefer_opencli'
                ? 'opencli'
            : 'mcp';
        const ranked = bucket
            .slice()
            .sort((left, right) => {
                const leftScore = providerScore(left.descriptor.provider, preferredProvider);
                const rightScore = providerScore(right.descriptor.provider, preferredProvider);
                if (leftScore !== rightScore) {
                    return rightScore - leftScore;
                }
                return left.descriptor.capabilityId.localeCompare(right.descriptor.capabilityId);
            });

        selectedCandidates.push(ranked[0]!);
    }

    const overlapResolution = deps.config?.overlapResolution ?? 'keep_all';
    const skippedSemanticKeys: string[] = [];
    const resolvedCandidates = resolveSemanticOverlaps({
        candidates: selectedCandidates,
        overlapResolution,
        duplicateResolution,
        onSkipSemanticKey: (semanticKey) => {
            skippedSemanticKeys.push(semanticKey);
        },
    });

    return {
        tools: applyDisabledToolFilter(
            resolvedCandidates.map((candidate) => candidate.tool),
            deps.config?.disabledTools,
        ),
        capabilityCatalog,
        conflicts,
        skippedToolNames,
        skippedSemanticKeys,
    };
}

function buildOpencliVirtualTools(input: {
    capabilities: OpencliCapabilityEntry[];
    executorTool?: ToolDefinition;
}): TaskToolCandidate[] {
    const { capabilities, executorTool } = input;
    if (!executorTool || capabilities.length === 0) {
        return [];
    }

    const seenToolNames = new Set<string>();
    const candidates: TaskToolCandidate[] = [];

    for (const capability of capabilities) {
        const rawId = capability.id.trim();
        if (!rawId) {
            continue;
        }

        const baseToolName = `opencli_${sanitizeToolName(rawId)}`;
        const toolName = dedupeToolName(baseToolName, seenToolNames);
        seenToolNames.add(toolName);

        const mappedTool: ToolDefinition = {
            name: toolName,
            description: capability.description?.trim()
                ? `${capability.description.trim()} (OpenCLI: ${rawId})`
                : `Execute OpenCLI capability "${rawId}".`,
            input_schema: {
                type: 'object',
                properties: {
                    arguments: {
                        type: 'array',
                        items: { type: 'string' },
                        description: `Arguments forwarded to OpenCLI capability "${rawId}".`,
                    },
                    cwd: {
                        type: 'string',
                        description: 'Optional working directory.',
                    },
                    timeout_ms: {
                        type: 'number',
                        description: 'Optional timeout in milliseconds.',
                    },
                },
            },
            effects: executorTool.effects,
            handler: async (args, context) => {
                const payload = typeof args === 'object' && args !== null
                    ? args as Record<string, unknown>
                    : {};
                return executorTool.handler(
                    {
                        capability: rawId,
                        arguments: Array.isArray(payload.arguments)
                            ? payload.arguments
                                .filter((entry): entry is string => typeof entry === 'string')
                                .map((entry) => entry.trim())
                                .filter(Boolean)
                            : [],
                        cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
                        timeout_ms: typeof payload.timeout_ms === 'number' ? payload.timeout_ms : undefined,
                    },
                    context,
                );
            },
        };

        candidates.push({
            descriptor: buildCapabilityDescriptor({
                provider: 'opencli',
                toolName: mappedTool.name,
                sourceId: capability.sourceId ?? rawId,
                description: mappedTool.description,
                effects: mappedTool.effects,
                inputSchema: mappedTool.input_schema,
            }),
            tool: mappedTool,
        });
    }

    return candidates;
}

function sanitizeToolName(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function dedupeToolName(base: string, seen: Set<string>): string {
    if (!seen.has(base)) {
        return base;
    }

    let index = 2;
    let candidate = `${base}_${index}`;
    while (seen.has(candidate)) {
        index += 1;
        candidate = `${base}_${index}`;
    }
    return candidate;
}

function providerScore(provider: CapabilityProvider, preferredProvider: CapabilityProvider): number {
    if (provider === preferredProvider) {
        return 100;
    }

    switch (provider) {
        case 'builtin':
            return 50;
        case 'mcp':
            return 40;
        case 'opencli':
            return 30;
        case 'cli':
            return 20;
        default:
            return 0;
    }
}

function resolveSemanticOverlaps(input: {
    candidates: TaskToolCandidate[];
    overlapResolution: OverlapResolutionPolicy;
    duplicateResolution: DuplicateResolutionPolicy;
    onSkipSemanticKey: (semanticKey: string) => void;
}): TaskToolCandidate[] {
    if (input.overlapResolution === 'keep_all') {
        return input.candidates;
    }

    const bySemantic = new Map<string, TaskToolCandidate[]>();
    for (const candidate of input.candidates) {
        const key = candidate.descriptor.semanticKey;
        const bucket = bySemantic.get(key) ?? [];
        bucket.push(candidate);
        bySemantic.set(key, bucket);
    }

    const next: TaskToolCandidate[] = [];
    for (const [semanticKey, bucket] of bySemantic.entries()) {
        const uniqueToolNames = new Set(bucket.map((item) => item.descriptor.toolName));
        if (bucket.length === 1 || uniqueToolNames.size <= 1) {
            next.push(...bucket);
            continue;
        }

        if (input.overlapResolution === 'skip_overlaps') {
            input.onSkipSemanticKey(semanticKey);
            continue;
        }

        const preferredProvider: CapabilityProvider =
            input.overlapResolution === 'prefer_builtin'
                ? 'builtin'
                : input.overlapResolution === 'prefer_opencli'
                    ? 'opencli'
                : 'mcp';

        const ranked = bucket.slice().sort((left, right) => {
            const leftScore = scoreSemanticCandidate(
                left,
                input.overlapResolution,
                preferredProvider,
                input.duplicateResolution,
            );
            const rightScore = scoreSemanticCandidate(
                right,
                input.overlapResolution,
                preferredProvider,
                input.duplicateResolution,
            );
            if (leftScore !== rightScore) {
                return rightScore - leftScore;
            }
            return left.descriptor.capabilityId.localeCompare(right.descriptor.capabilityId);
        });

        next.push(ranked[0]!);
    }

    return next;
}

function scoreSemanticCandidate(
    candidate: TaskToolCandidate,
    overlapResolution: OverlapResolutionPolicy,
    preferredProvider: CapabilityProvider,
    duplicateResolution: DuplicateResolutionPolicy,
): number {
    let score = 0;

    if (overlapResolution === 'prefer_non_interactive') {
        score += candidate.descriptor.interactionMode === 'non_interactive' ? 200 : 0;
    } else {
        score += providerScore(candidate.descriptor.provider, preferredProvider);
    }

    const duplicatePreferredProvider: CapabilityProvider =
        duplicateResolution === 'prefer_builtin'
            ? 'builtin'
            : duplicateResolution === 'prefer_opencli'
                ? 'opencli'
                : 'mcp';
    score += providerScore(candidate.descriptor.provider, duplicatePreferredProvider) * 0.1;
    score += candidate.descriptor.interactionMode === 'non_interactive' ? 1 : 0;

    return score;
}
