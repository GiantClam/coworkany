import type { Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';

const MCP_ENABLED = process.env.COWORKANY_ENABLE_MCP === '1';

export const mcp = new MCPClient({
    timeout: 10_000,
    servers: {
        playwright: {
            command: 'npx',
            args: ['-y', '@playwright/mcp@latest'],
        },
    },
});

export async function listMcpToolsSafe(): Promise<Record<string, Tool<unknown, unknown, unknown, unknown>>> {
    if (!MCP_ENABLED) {
        return {};
    }

    try {
        return await mcp.listTools();
    } catch (error) {
        console.warn('[Mastra MCP] listTools failed, falling back to no MCP tools:', error);
        return {};
    }
}

export function isMcpEnabled(): boolean {
    return MCP_ENABLED;
}
