import { type ToolDefinition } from './standard';
import { type MCPGateway } from '../mcp/gateway';
import { applyDisabledToolFilter } from './disableTools';

export type TaskToolResolverConfig = {
    enabledToolpacks?: string[];
    disabledTools?: string[];
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
    mcpGateway: MCPGateway;
};

export function resolveToolsForTask(deps: TaskToolResolverDeps): ToolDefinition[] {
    const tools: ToolDefinition[] = [
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

    const enabledToolpacks = deps.config?.enabledToolpacks || [];
    const availableMcpTools = deps.mcpGateway.getAvailableTools();

    for (const { server, tool } of availableMcpTools) {
        const isEnabled = enabledToolpacks.some((id) => id.includes(server) || id === server);
        if (!isEnabled) {
            continue;
        }

        const existingIndex = tools.findIndex((candidate) => candidate.name === tool.name);
        if (existingIndex >= 0) {
            tools.splice(existingIndex, 1);
        }

        tools.push({
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
        });
    }

    return applyDisabledToolFilter(tools, deps.config?.disabledTools);
}
