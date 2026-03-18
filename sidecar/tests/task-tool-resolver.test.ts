import { describe, expect, test } from 'bun:test';
import { resolveToolsForTask } from '../src/tools/taskToolResolver';
import { type ToolDefinition } from '../src/tools/standard';

function makeTool(name: string): ToolDefinition {
    return {
        name,
        description: `${name} description`,
        effects: [],
        input_schema: { type: 'object', properties: {} },
        handler: async () => ({ success: true, name }),
    };
}

describe('taskToolResolver', () => {
    test('returns builtin task tools when no MCP toolpack is enabled', () => {
        const builtin = makeTool('builtin_only');

        const tools = resolveToolsForTask({
            standardTools: [builtin],
            builtinTools: [],
            controlPlaneTools: [],
            knowledgeTools: [],
            personalTools: [],
            databaseTools: [],
            enhancedBrowserTools: [],
            selfLearningTools: [],
            mcpGateway: {
                getAvailableTools: () => [],
                callTool: async () => ({ success: true }),
            } as any,
        });

        expect(tools.map((tool) => tool.name)).toContain('builtin_only');
    });

    test('lets enabled MCP tools override builtin tools with the same name', async () => {
        const builtin = makeTool('shared_tool');

        const tools = resolveToolsForTask({
            config: { enabledToolpacks: ['github-server'] },
            standardTools: [builtin],
            builtinTools: [],
            controlPlaneTools: [],
            knowledgeTools: [],
            personalTools: [],
            databaseTools: [],
            enhancedBrowserTools: [],
            selfLearningTools: [],
            mcpGateway: {
                getAvailableTools: () => [
                    {
                        server: 'github-server',
                        tool: {
                            name: 'shared_tool',
                            description: 'mcp override',
                            inputSchema: { type: 'object', properties: {} },
                        },
                    },
                ],
                callTool: async ({ serverName, toolName, arguments: args }: any) => ({
                    serverName,
                    toolName,
                    args,
                }),
            } as any,
        });

        expect(tools).toHaveLength(1);
        expect(tools[0]?.description).toBe('mcp override');
        await expect(
            tools[0]?.handler({ id: 1 }, { taskId: 'task-1', workspacePath: '/tmp' } as any)
        ).resolves.toEqual({
            serverName: 'github-server',
            toolName: 'shared_tool',
            args: { id: 1 },
        });
    });
});
