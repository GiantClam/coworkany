import { describe, expect, test } from 'bun:test';
import { MCPGateway } from '../src/mcp/gateway';

function seedGateway(): MCPGateway {
    const gateway = new MCPGateway();
    (gateway as any).servers.set('github-server', {
        name: 'github-server',
        client: {
            callTool: async ({ name, arguments: args }: any) => ({
                content: { name, args },
            }),
        },
        manifest: {
            name: 'github-server',
            effects: ['filesystem:write', 'network:outbound'],
        },
        riskScore: 10,
        authenticated: true,
        healthStatus: 'healthy',
    });
    (gateway as any).toolRegistry.set('github-server:write_file', {
        server: 'github-server',
        tool: {
            name: 'write_file',
            description: 'Write a file',
            inputSchema: { type: 'object', properties: {} },
        },
    });
    (gateway as any).toolRegistry.set('github-server:fetch_url', {
        server: 'github-server',
        tool: {
            name: 'fetch_url',
            description: 'Fetch a URL',
            inputSchema: { type: 'object', properties: {} },
        },
    });
    return gateway;
}

describe('mcp gateway runtime isolation', () => {
    test('denies connector calls from servers not enabled for the task session', async () => {
        const gateway = seedGateway();
        gateway.setSessionPolicy('task-1', {
            allowedServerNames: [],
            allowedWorkspacePaths: ['/tmp/ws'],
            writableWorkspacePaths: ['/tmp/ws'],
            networkAccess: 'none',
            allowedDomains: [],
        });

        await expect(gateway.callTool({
            sessionId: 'task-1',
            serverName: 'github-server',
            toolName: 'write_file',
            arguments: { path: '/tmp/ws/file.txt' },
            effectType: 'filesystem:write',
        })).rejects.toThrow('not enabled for this task session');
    });

    test('denies filesystem writes outside the task isolation roots', async () => {
        const gateway = seedGateway();
        gateway.setSessionPolicy('task-2', {
            allowedServerNames: ['github-server'],
            allowedWorkspacePaths: ['/tmp/ws'],
            writableWorkspacePaths: ['/tmp/ws'],
            networkAccess: 'none',
            allowedDomains: [],
        });

        await expect(gateway.callTool({
            sessionId: 'task-2',
            serverName: 'github-server',
            toolName: 'write_file',
            arguments: { path: '/tmp/outside/file.txt' },
            effectType: 'filesystem:write',
        })).rejects.toThrow('outside the task session isolation roots');
    });

    test('allows in-scope connector calls that stay within the session policy', async () => {
        const gateway = seedGateway();
        gateway.setSessionPolicy('task-3', {
            allowedServerNames: ['github-server'],
            allowedWorkspacePaths: ['/tmp/ws'],
            writableWorkspacePaths: ['/tmp/ws'],
            networkAccess: 'restricted',
            allowedDomains: ['api.github.com'],
        });

        await expect(gateway.callTool({
            sessionId: 'task-3',
            serverName: 'github-server',
            toolName: 'write_file',
            arguments: { path: '/tmp/ws/file.txt' },
            effectType: 'filesystem:write',
        })).resolves.toEqual({
            name: 'write_file',
            args: { path: '/tmp/ws/file.txt' },
        });

        await expect(gateway.callTool({
            sessionId: 'task-3',
            serverName: 'github-server',
            toolName: 'fetch_url',
            arguments: { url: 'https://api.github.com/repos/openai/openai' },
            effectType: 'network:outbound',
        })).resolves.toEqual({
            name: 'fetch_url',
            args: { url: 'https://api.github.com/repos/openai/openai' },
        });

        await expect(gateway.callTool({
            sessionId: 'task-3',
            serverName: 'github-server',
            toolName: 'fetch_url',
            arguments: { url: 'https://example.com' },
            effectType: 'network:outbound',
        })).rejects.toThrow('outside the task session allowlist');
    });
});
