import { describe, expect, test } from 'bun:test';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import { CORE_BASELINE_TOOL_IDS } from '../src/data/coreToolpack';
import { resolveAgentToolsForRequest } from '../src/mastra/agents/resolveAgentToolsForRequest';

const mcpFixtureTool = createTool({
    id: 'mcp_fixture_search',
    description: 'fixture mcp tool',
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async () => ({ ok: true }),
});

describe('agent tool surfaces', () => {
    test('chat surface exposes no side-effect or extension tools', async () => {
        const tools = await resolveAgentToolsForRequest({
            surface: 'chat',
            env: { COWORKANY_RUNTIME_PROFILE: 'full' } as NodeJS.ProcessEnv,
            includeMcp: true,
            listMcpToolsFn: async () => ({ mcp_fixture_search: mcpFixtureTool }),
        });

        expect(Object.keys(tools)).toEqual([]);
    });

    test('task-core surface exposes only the baseline execution tools', async () => {
        const tools = await resolveAgentToolsForRequest({
            surface: 'task-core',
            env: { COWORKANY_RUNTIME_PROFILE: 'full' } as NodeJS.ProcessEnv,
            includeMcp: true,
            listMcpToolsFn: async () => ({ mcp_fixture_search: mcpFixtureTool }),
        });

        expect(Object.keys(tools).sort()).toEqual([...CORE_BASELINE_TOOL_IDS].sort());
    });

    test('core profile downgrades task-full to task-core and suppresses MCP', async () => {
        const tools = await resolveAgentToolsForRequest({
            surface: 'task-full',
            env: { COWORKANY_RUNTIME_PROFILE: 'core' } as NodeJS.ProcessEnv,
            includeMcp: true,
            includeEnterprise: true,
            listMcpToolsFn: async () => ({ mcp_fixture_search: mcpFixtureTool }),
        });

        expect(Object.keys(tools).sort()).toEqual([...CORE_BASELINE_TOOL_IDS].sort());
        expect(tools.mcp_fixture_search).toBeUndefined();
        expect(tools.voice_speak).toBeUndefined();
        expect(tools.delete_files).toBeUndefined();
    });

    test('full task surface can include builtin, enterprise, and MCP tools', async () => {
        const tools = await resolveAgentToolsForRequest({
            surface: 'task-full',
            env: { COWORKANY_RUNTIME_PROFILE: 'full' } as NodeJS.ProcessEnv,
            includeMcp: true,
            includeEnterprise: true,
            listMcpToolsFn: async () => ({ mcp_fixture_search: mcpFixtureTool }),
        });

        expect(tools.run_command).toBeDefined();
        expect(tools.search_web).toBeDefined();
        expect(tools.voice_speak).toBeDefined();
        expect(tools.delete_files).toBeDefined();
        expect(tools.mcp_fixture_search).toBeDefined();
    });
});
