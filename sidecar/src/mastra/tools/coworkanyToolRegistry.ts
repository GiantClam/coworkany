import type { RequestContext } from '@mastra/core/request-context';
import { createTool, type Tool, type ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod/v4';
import { CORE_BASELINE_TOOL_IDS } from '../../data/coreToolpack';
import { resolveRuntimeCapabilityProfile } from '../../config/runtimeProfile';
import { STANDARD_TOOLS, type ToolContext, type ToolDefinition, type ToolEffect } from '../../tools/standard';
import { crawlUrlTool, extractContentTool, searchWebTool } from './research';

type AnyMastraTool = Tool<any, any, any, any>;

export type CoworkAnyToolCapability =
    | 'filesystem_read'
    | 'artifact_write'
    | 'command_execution'
    | 'web_research'
    | 'voice_output'
    | 'memory';

export type CoworkAnyToolEvidenceKind = CoworkAnyToolCapability | 'none';

export type CoworkAnyToolRiskLevel = 'low' | 'medium' | 'high';

export type CoworkAnyMastraToolMetadata = {
    id: string;
    description?: string;
    aliases: string[];
    source: 'standard' | 'builtin';
    effects: ToolEffect[];
    capabilities: CoworkAnyToolCapability[];
    evidenceKind: CoworkAnyToolEvidenceKind;
    riskLevel: CoworkAnyToolRiskLevel;
};

export type CoworkAnyMastraToolRegistration = {
    id: string;
    tool: AnyMastraTool;
    metadata: CoworkAnyMastraToolMetadata;
};

const standardToolIds = new Set(STANDARD_TOOLS.map((tool) => tool.name));
const coreToolIds = new Set<string>(CORE_BASELINE_TOOL_IDS);
const builtinFeatureToolIds = new Set(['search_web', 'crawl_url', 'extract_content']);

const inputSchemas: Record<string, z.ZodTypeAny> = {
    list_dir: z.object({
        path: z.string().optional(),
        recursive: z.boolean().optional(),
        max_depth: z.number().int().positive().optional(),
    }),
    view_file: z.object({
        path: z.string().min(1),
        start_line: z.number().int().positive().optional(),
        end_line: z.number().int().positive().optional(),
    }),
    write_to_file: z.object({
        path: z.string().min(1),
        content: z.string(),
    }),
    replace_file_content: z.object({
        path: z.string().min(1),
        target_content: z.string(),
        replacement_content: z.string(),
    }),
    move_file: z.object({
        source_path: z.string().min(1),
        destination_path: z.string().min(1),
        overwrite: z.boolean().optional(),
    }),
    delete_path: z.object({
        path: z.string().min(1),
        recursive: z.boolean().optional(),
        force: z.boolean().optional(),
    }),
    create_directory: z.object({
        path: z.string().min(1),
    }),
    compute_file_hash: z.object({
        path: z.string().min(1),
        algorithm: z.string().optional(),
    }),
    batch_delete_paths: z.object({
        deletes: z.array(z.object({
            path: z.string().min(1),
            recursive: z.boolean().optional(),
            force: z.boolean().optional(),
        })),
    }),
    batch_move_files: z.object({
        moves: z.array(z.object({
            source_path: z.string().min(1),
            destination_path: z.string().min(1),
            overwrite: z.boolean().optional(),
        })),
    }),
    run_command: z.object({
        command: z.string().min(1),
        cwd: z.string().optional(),
        timeout_ms: z.number().int().positive().optional(),
    }),
    remember: z.object({
        key: z.string().optional(),
        value: z.unknown().optional(),
        content: z.string().optional(),
        category: z.string().optional(),
    }),
    recall: z.object({
        key: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().positive().optional(),
    }),
    voice_speak: z.object({
        text: z.string().min(1),
        voice: z.string().optional(),
        speed: z.number().positive().optional(),
    }),
};

function getRequestContextValue(context: ToolExecutionContext, key: string): unknown {
    return (context.requestContext as RequestContext | undefined)?.get(key);
}

function resolveStandardToolContext(context: ToolExecutionContext): ToolContext {
    const workspacePath = getRequestContextValue(context, 'workspacePath');
    const taskId = getRequestContextValue(context, 'taskId');
    const abortSignal = context.abortSignal;
    return {
        workspacePath: typeof workspacePath === 'string' && workspacePath.trim().length > 0
            ? workspacePath
            : process.cwd(),
        taskId: typeof taskId === 'string' && taskId.trim().length > 0
            ? taskId
            : `mastra-tool-${Date.now()}`,
        onCancel: abortSignal
            ? (waiter) => {
                const listener = () => waiter('Tool execution cancelled');
                if (abortSignal.aborted) {
                    listener();
                    return () => undefined;
                }
                abortSignal.addEventListener('abort', listener, { once: true });
                return () => abortSignal.removeEventListener('abort', listener);
            }
            : undefined,
    };
}

function inferCapabilities(tool: ToolDefinition): CoworkAnyToolCapability[] {
    const capabilities = new Set<CoworkAnyToolCapability>();
    if (tool.effects.includes('filesystem:read')) {
        capabilities.add('filesystem_read');
    }
    if (tool.effects.includes('filesystem:write') || tool.effects.includes('filesystem:delete')) {
        capabilities.add('artifact_write');
    }
    if (tool.effects.includes('process:spawn') || tool.effects.includes('code:execute')) {
        capabilities.add('command_execution');
    }
    if (tool.effects.includes('ui:notify') || tool.name === 'voice_speak') {
        capabilities.add('voice_output');
    }
    if (tool.effects.includes('state:remember') || tool.effects.includes('knowledge:read') || tool.effects.includes('knowledge:update')) {
        capabilities.add('memory');
    }
    return [...capabilities];
}

function inferEvidenceKind(tool: ToolDefinition, capabilities: CoworkAnyToolCapability[]): CoworkAnyToolEvidenceKind {
    if (tool.name === 'run_command') return 'command_execution';
    if (tool.name === 'voice_speak') return 'voice_output';
    if (tool.name === 'remember' || tool.name === 'recall') return 'memory';
    if (tool.effects.includes('filesystem:write') || tool.effects.includes('filesystem:delete')) return 'artifact_write';
    if (tool.effects.includes('filesystem:read')) return 'filesystem_read';
    return capabilities[0] ?? 'none';
}

function inferRiskLevel(tool: ToolDefinition): CoworkAnyToolRiskLevel {
    if (tool.name === 'delete_path' || tool.effects.includes('filesystem:delete')) {
        return 'high';
    }
    if (
        tool.effects.includes('filesystem:write')
        || tool.effects.includes('process:spawn')
        || tool.effects.includes('code:execute')
    ) {
        return 'medium';
    }
    return 'low';
}

function buildMetadata(tool: ToolDefinition): CoworkAnyMastraToolMetadata {
    const capabilities = inferCapabilities(tool);
    return {
        id: tool.name,
        description: tool.description,
        aliases: tool.name === 'run_command' ? ['bash', 'shell', 'terminal'] : [],
        source: 'standard',
        effects: [...tool.effects],
        capabilities,
        evidenceKind: inferEvidenceKind(tool, capabilities),
        riskLevel: inferRiskLevel(tool),
    };
}

function createCoworkAnyStandardMastraTool(tool: ToolDefinition): CoworkAnyMastraToolRegistration {
    const metadata = buildMetadata(tool);
    return {
        id: tool.name,
        metadata,
        tool: createTool({
            id: tool.name,
            description: tool.description ?? tool.name,
            inputSchema: inputSchemas[tool.name] ?? z.record(z.string(), z.unknown()),
            outputSchema: z.unknown(),
            execute: async (input, context) => {
                return await tool.handler(input, resolveStandardToolContext(context));
            },
        }) as AnyMastraTool,
    };
}

const registrations = new Map<string, CoworkAnyMastraToolRegistration>(
    STANDARD_TOOLS.map((tool) => {
        const registration = createCoworkAnyStandardMastraTool(tool);
        return [registration.id, registration];
    }),
);

function addBuiltinMastraToolRegistration(input: {
    id: string;
    tool: AnyMastraTool;
    description: string;
    effects: ToolEffect[];
    capabilities: CoworkAnyToolCapability[];
    evidenceKind: CoworkAnyToolEvidenceKind;
    riskLevel?: CoworkAnyToolRiskLevel;
}): void {
    registrations.set(input.id, {
        id: input.id,
        tool: input.tool,
        metadata: {
            id: input.id,
            description: input.description,
            aliases: [],
            source: 'builtin',
            effects: input.effects,
            capabilities: input.capabilities,
            evidenceKind: input.evidenceKind,
            riskLevel: input.riskLevel ?? 'low',
        },
    });
}

addBuiltinMastraToolRegistration({
    id: 'search_web',
    tool: searchWebTool as AnyMastraTool,
    description: 'Search the web and return top results with links and snippets.',
    effects: ['network:outbound'],
    capabilities: ['web_research'],
    evidenceKind: 'web_research',
});

addBuiltinMastraToolRegistration({
    id: 'crawl_url',
    tool: crawlUrlTool as AnyMastraTool,
    description: 'Fetch a web page and return extracted readable text.',
    effects: ['network:outbound'],
    capabilities: ['web_research'],
    evidenceKind: 'web_research',
});

addBuiltinMastraToolRegistration({
    id: 'extract_content',
    tool: extractContentTool as AnyMastraTool,
    description: 'Extract readable text content from HTML or a URL.',
    effects: ['network:outbound'],
    capabilities: ['web_research'],
    evidenceKind: 'web_research',
});

const aliasToRegistrationId = new Map<string, string>();
for (const registration of registrations.values()) {
    for (const alias of registration.metadata.aliases) {
        aliasToRegistrationId.set(alias, registration.id);
    }
}

function resolveRegistrationId(id: string): string {
    return aliasToRegistrationId.get(id) ?? id;
}

export function listCoworkAnyMastraToolRegistrations(): CoworkAnyMastraToolRegistration[] {
    return [...registrations.values()];
}

export function getCoworkAnyMastraToolRegistration(id: string): CoworkAnyMastraToolRegistration | undefined {
    return registrations.get(resolveRegistrationId(id));
}

export function resolveCoworkAnyMastraToolMetadata(id: string): CoworkAnyMastraToolMetadata | undefined {
    return getCoworkAnyMastraToolRegistration(id)?.metadata;
}

export function resolveCoworkAnyMastraTools(options?: {
    env?: NodeJS.ProcessEnv;
    include?: readonly string[];
}): Record<string, AnyMastraTool> {
    const requestedIds = options?.include
        ? new Set(options.include)
        : resolveRuntimeCapabilityProfile(options?.env ?? process.env) === 'core'
            ? coreToolIds
            : new Set([...standardToolIds, ...builtinFeatureToolIds]);
    const tools: Record<string, AnyMastraTool> = {};
    for (const id of requestedIds) {
        const registration = registrations.get(id);
        if (registration) {
            tools[id] = registration.tool;
        }
    }
    return tools;
}
