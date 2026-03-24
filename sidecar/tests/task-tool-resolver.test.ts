import { describe, expect, test } from 'bun:test';
import { resolveToolsForTask, resolveToolsForTaskWithDiagnostics } from '../src/tools/taskToolResolver';
import { type ToolDefinition } from '../src/tools/standard';

function makeTool(name: string, description?: string): ToolDefinition {
    return {
        name,
        description: description ?? `${name} description`,
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

    test('can prefer builtin tools when duplicateResolution=prefer_builtin', () => {
        const builtin = makeTool('shared_tool', 'builtin version');

        const result = resolveToolsForTaskWithDiagnostics({
            config: {
                enabledToolpacks: ['github-server'],
                duplicateResolution: 'prefer_builtin',
            },
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
                callTool: async () => ({ success: true }),
            } as any,
        });

        expect(result.tools).toHaveLength(1);
        expect(result.tools[0]?.description).toBe('builtin version');
    });

    test('can prefer opencli tools when duplicateResolution=prefer_opencli', () => {
        const builtin = makeTool('opencli_gh_repo_list', 'builtin version');
        const opencliExecutor = makeTool('execute_opencli_capability', 'Execute OpenCLI capability');
        opencliExecutor.handler = async (args) => ({
            provider: 'opencli',
            args,
        });

        const result = resolveToolsForTaskWithDiagnostics({
            config: {
                enabledToolpacks: ['github-server'],
                duplicateResolution: 'prefer_opencli',
            },
            standardTools: [builtin, opencliExecutor],
            builtinTools: [],
            controlPlaneTools: [],
            knowledgeTools: [],
            personalTools: [],
            databaseTools: [],
            enhancedBrowserTools: [],
            selfLearningTools: [],
            opencliCapabilities: [
                {
                    id: 'gh.repo.list',
                    description: 'OpenCLI repository listing',
                },
            ],
            mcpGateway: {
                getAvailableTools: () => [
                    {
                        server: 'github-server',
                        tool: {
                            name: 'opencli_gh_repo_list',
                            description: 'mcp version',
                            inputSchema: { type: 'object', properties: {} },
                        },
                    },
                ],
                callTool: async () => ({ provider: 'mcp' }),
            } as any,
        });

        expect(result.tools).toHaveLength(2);
        const selected = result.tools.find((tool) => tool.name === 'opencli_gh_repo_list');
        expect(selected).toBeTruthy();
        expect(selected?.description).toContain('OpenCLI');
        expect(result.conflicts.some((conflict) => conflict.kind === 'duplicate')).toBe(true);
    });

    test('can skip conflicting duplicate tools when duplicateResolution=skip_conflicts', () => {
        const builtin = makeTool('shared_tool');

        const result = resolveToolsForTaskWithDiagnostics({
            config: {
                enabledToolpacks: ['github-server'],
                duplicateResolution: 'skip_conflicts',
            },
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
                callTool: async () => ({ success: true }),
            } as any,
        });

        expect(result.tools).toHaveLength(0);
        expect(result.skippedToolNames).toEqual(['shared_tool']);
        expect(result.conflicts.some((conflict) => conflict.kind === 'duplicate')).toBe(true);
    });

    test('filters disabled tools from resolved task tools', () => {
        const builtin = makeTool('install_coworkany_skill_from_marketplace');
        const safeTool = makeTool('run_command');

        const tools = resolveToolsForTask({
            config: { disabledTools: ['install_coworkany_skill_from_marketplace'] },
            standardTools: [builtin, safeTool],
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

        const names = tools.map((tool) => tool.name);
        expect(names).not.toContain('install_coworkany_skill_from_marketplace');
        expect(names).toContain('run_command');
    });

    test('builds capability catalog and conflict diagnostics', () => {
        const result = resolveToolsForTaskWithDiagnostics({
            config: { enabledToolpacks: ['github-server'] },
            standardTools: [makeTool('shared_tool')],
            builtinTools: [makeTool('list_dir')],
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
                callTool: async () => ({ success: true }),
            } as any,
        });

        expect(result.capabilityCatalog.length).toBeGreaterThanOrEqual(3);
        expect(result.conflicts.some((conflict) => conflict.kind === 'duplicate')).toBe(true);
        expect(result.conflicts.some((conflict) => conflict.kind === 'replaceable')).toBe(true);
        expect(result.skippedSemanticKeys).toEqual([]);
    });

    test('keeps semantic overlaps by default', () => {
        const result = resolveToolsForTaskWithDiagnostics({
            config: { enabledToolpacks: ['fs-server'] },
            standardTools: [makeTool('list_dir')],
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
                        server: 'fs-server',
                        tool: {
                            name: 'list_directory',
                            description: 'List directory entries via mcp.',
                            inputSchema: { type: 'object', properties: {} },
                        },
                    },
                ],
                callTool: async () => ({ success: true }),
            } as any,
        });

        const names = result.tools.map((tool) => tool.name).sort();
        expect(names).toEqual(['list_dir', 'list_directory']);
    });

    test('can prefer mcp tool for semantic overlaps when overlapResolution=prefer_mcp', () => {
        const result = resolveToolsForTaskWithDiagnostics({
            config: {
                enabledToolpacks: ['fs-server'],
                overlapResolution: 'prefer_mcp',
            },
            standardTools: [makeTool('list_dir')],
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
                        server: 'fs-server',
                        tool: {
                            name: 'list_directory',
                            description: 'List directory entries via mcp.',
                            inputSchema: { type: 'object', properties: {} },
                        },
                    },
                ],
                callTool: async () => ({ success: true }),
            } as any,
        });

        const names = result.tools.map((tool) => tool.name);
        expect(names).toEqual(['list_directory']);
        expect(result.skippedSemanticKeys).toEqual([]);
    });

    test('builds executable opencli virtual tools when capabilities are provided', async () => {
        const executeOpencli = makeTool('execute_opencli_capability', 'Execute OpenCLI capability');
        executeOpencli.handler = async (args) => ({
            ok: true,
            received: args,
        });

        const result = resolveToolsForTaskWithDiagnostics({
            standardTools: [executeOpencli],
            builtinTools: [],
            controlPlaneTools: [],
            knowledgeTools: [],
            personalTools: [],
            databaseTools: [],
            enhancedBrowserTools: [],
            selfLearningTools: [],
            opencliCapabilities: [
                {
                    id: 'gh.repo.list',
                    description: 'List repositories from GitHub',
                },
            ],
            mcpGateway: {
                getAvailableTools: () => [],
                callTool: async () => ({ success: true }),
            } as any,
        });

        const names = result.tools.map((tool) => tool.name);
        expect(names).toContain('opencli_gh_repo_list');
        expect(result.capabilityCatalog.some((item) => item.provider === 'opencli')).toBe(true);

        const opencliTool = result.tools.find((tool) => tool.name === 'opencli_gh_repo_list');
        await expect(
            opencliTool?.handler(
                {
                    arguments: ['--owner', 'openai'],
                    cwd: '.',
                    timeout_ms: 3000,
                },
                { taskId: 'task-1', workspacePath: '/tmp' } as any,
            )
        ).resolves.toEqual({
            ok: true,
            received: {
                capability: 'gh.repo.list',
                arguments: ['--owner', 'openai'],
                cwd: '.',
                timeout_ms: 3000,
            },
        });
    });

    test('overlap resolution can prefer builtin over opencli virtual tools', () => {
        const result = resolveToolsForTaskWithDiagnostics({
            config: {
                overlapResolution: 'prefer_builtin',
            },
            standardTools: [makeTool('list_dir')],
            builtinTools: [makeTool('execute_opencli_capability')],
            controlPlaneTools: [],
            knowledgeTools: [],
            personalTools: [],
            databaseTools: [],
            enhancedBrowserTools: [],
            selfLearningTools: [],
            opencliCapabilities: [
                {
                    id: 'list.dir',
                    description: 'List directory entries via OpenCLI',
                },
            ],
            mcpGateway: {
                getAvailableTools: () => [],
                callTool: async () => ({ success: true }),
            } as any,
        });

        const names = result.tools.map((tool) => tool.name);
        expect(names).toContain('list_dir');
        expect(names).not.toContain('opencli_list_dir');
    });

    test('overlap resolution can prefer opencli over builtin and mcp', () => {
        const result = resolveToolsForTaskWithDiagnostics({
            config: {
                enabledToolpacks: ['fs-server'],
                overlapResolution: 'prefer_opencli',
            },
            standardTools: [makeTool('list_dir')],
            builtinTools: [makeTool('execute_opencli_capability')],
            controlPlaneTools: [],
            knowledgeTools: [],
            personalTools: [],
            databaseTools: [],
            enhancedBrowserTools: [],
            selfLearningTools: [],
            opencliCapabilities: [
                {
                    id: 'list.dir',
                    description: 'List directory entries via OpenCLI',
                },
            ],
            mcpGateway: {
                getAvailableTools: () => [
                    {
                        server: 'fs-server',
                        tool: {
                            name: 'list_directory',
                            description: 'List directory entries via mcp.',
                            inputSchema: { type: 'object', properties: {} },
                        },
                    },
                ],
                callTool: async () => ({ success: true }),
            } as any,
        });

        const names = result.tools.map((tool) => tool.name);
        expect(names).toContain('opencli_list_dir');
        expect(names).not.toContain('list_dir');
        expect(names).not.toContain('list_directory');
    });
});
