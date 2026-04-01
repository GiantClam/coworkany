import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpServerSecurityStore, toMastraServerMap } from '../src/mastra/mcp/security';

const tempDirs: string[] = [];

function createTempWorkspace(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
});

describe('mastra mcp security store', () => {
    test('includes managed builtin server in allowed set', () => {
        const workspaceRoot = createTempWorkspace('coworkany-mcp-security-');
        const store = new McpServerSecurityStore(workspaceRoot);
        const snapshot = store.buildSnapshot();

        expect(snapshot.servers.some((server) => server.id === 'playwright')).toBe(true);
        expect(snapshot.allowedServerIds.includes('playwright')).toBe(true);
    });

    test('requires explicit approval for user-scope servers', () => {
        const workspaceRoot = createTempWorkspace('coworkany-mcp-security-user-scope-');
        const store = new McpServerSecurityStore(workspaceRoot);

        const upserted = store.upsert({
            id: 'my-user-server',
            command: 'npx',
            args: ['-y', 'example-server'],
            scope: 'user',
            enabled: true,
        });
        expect(upserted.success).toBe(true);

        const beforeApproval = store.buildSnapshot();
        expect(beforeApproval.allowedServerIds.includes('my-user-server')).toBe(false);
        expect(beforeApproval.blockedServerIds.includes('my-user-server')).toBe(true);

        const approved = store.setApproval('my-user-server', true);
        expect(approved.success).toBe(true);

        const afterApproval = store.buildSnapshot();
        expect(afterApproval.allowedServerIds.includes('my-user-server')).toBe(true);

        const serverMap = toMastraServerMap(afterApproval);
        expect(Object.keys(serverMap)).toContain('my-user-server');
    });

    test('persists workspace servers and reloads from disk', () => {
        const workspaceRoot = createTempWorkspace('coworkany-mcp-security-persist-');
        const store = new McpServerSecurityStore(workspaceRoot);

        const result = store.upsert({
            id: 'persisted-server',
            command: 'node',
            args: ['server.js'],
            scope: 'project',
            enabled: true,
        });
        expect(result.success).toBe(true);

        const reloaded = new McpServerSecurityStore(workspaceRoot);
        const snapshot = reloaded.buildSnapshot();
        const persisted = snapshot.servers.find((server) => server.id === 'persisted-server');
        expect(persisted).toBeDefined();
        expect(persisted?.scope).toBe('project');
    });
});
