import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceStore } from '../src/storage/workspaceStore';
import { handleWorkspaceCommand, type WorkspaceCommandDeps } from '../src/handlers/workspaces';

const tempPaths: string[] = [];

afterEach(() => {
    while (tempPaths.length > 0) {
        const target = tempPaths.pop();
        if (target) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
});

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempPaths.push(dir);
    return dir;
}

function createDeps(appDataDir?: string): WorkspaceCommandDeps & { store: WorkspaceStore } {
    const resolvedAppDataDir = appDataDir ?? makeTempDir('coworkany-workspace-app-');
    const store = new WorkspaceStore(resolvedAppDataDir);
    return {
        store,
        workspaceStore: store,
        getResolvedAppDataRoot: () => resolvedAppDataDir,
    };
}

describe('workspace commands handler', () => {
    test('create_workspace allocates managed default path when requested path is default', async () => {
        const deps = createDeps();

        const response = await handleWorkspaceCommand({
            id: 'cmd-w1',
            type: 'create_workspace',
            payload: {
                name: 'My Demo Workspace',
                path: 'default',
            },
        } as any, deps);

        expect(response?.type).toBe('create_workspace_response');
        expect((response as any).payload.success).toBe(true);
        const workspace = (response as any).payload.workspace;
        expect(workspace.path).toStartWith(path.join(deps.getResolvedAppDataRoot(), 'workspaces'));
        expect(fs.existsSync(path.join(workspace.path, '.coworkany', 'skills'))).toBe(true);
        expect(fs.existsSync(path.join(workspace.path, '.coworkany', 'mcp'))).toBe(true);
    });

    test('list/update/delete workspace commands round-trip through store', async () => {
        const deps = createDeps();
        const workspace = deps.store.create('Initial Name', path.join(deps.getResolvedAppDataRoot(), 'manual-workspace'));

        const listResponse = await handleWorkspaceCommand({
            id: 'cmd-w2',
            type: 'list_workspaces',
            payload: {},
        } as any, deps);

        const updateResponse = await handleWorkspaceCommand({
            id: 'cmd-w3',
            type: 'update_workspace',
            payload: {
                id: workspace.id,
                updates: {
                    name: 'Renamed Workspace',
                },
            },
        } as any, deps);

        const deleteResponse = await handleWorkspaceCommand({
            id: 'cmd-w4',
            type: 'delete_workspace',
            payload: {
                id: workspace.id,
            },
        } as any, deps);

        expect((listResponse as any).payload.workspaces).toHaveLength(1);
        expect((updateResponse as any).payload.success).toBe(true);
        expect((updateResponse as any).payload.workspace.name).toBe('Renamed Workspace');
        expect((deleteResponse as any).payload.success).toBe(true);
        expect(deps.store.list()).toHaveLength(0);
    });

    test('returns null for non-workspace commands', async () => {
        const deps = createDeps();
        const response = await handleWorkspaceCommand({
            id: 'cmd-w5',
            type: 'list_claude_skills',
            payload: {},
        } as any, deps);

        expect(response).toBeNull();
    });
});
