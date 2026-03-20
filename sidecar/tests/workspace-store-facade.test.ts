import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWorkspaceStoreFacade } from '../src/storage/workspaceStoreFacade';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('createWorkspaceStoreFacade', () => {
    test('switches to the current app data root after bootstrap-style updates', () => {
        const startupRoot = makeTempDir('coworkany-workspace-startup-root-');
        const runtimeRoot = makeTempDir('coworkany-workspace-runtime-root-');
        const runtimeWorkspacePath = path.join(runtimeRoot, 'managed-workspace');

        fs.writeFileSync(
            path.join(runtimeRoot, 'workspaces.json'),
            JSON.stringify({
                workspaces: [
                    {
                        id: 'runtime-workspace',
                        name: 'Runtime Workspace',
                        path: runtimeWorkspacePath,
                        createdAt: '2026-03-20T00:00:00.000Z',
                        lastAccessedAt: '2026-03-20T00:00:00.000Z',
                        autoNamed: false,
                        defaultSkills: [],
                        defaultToolpacks: ['builtin-websearch'],
                    },
                ],
            })
        );

        let currentRoot = startupRoot;
        const workspaceStore = createWorkspaceStoreFacade(() => currentRoot);

        expect(workspaceStore.list()).toEqual([]);

        currentRoot = runtimeRoot;

        const workspaces = workspaceStore.list();
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]?.id).toBe('runtime-workspace');
        expect(workspaces[0]?.path).toBe(runtimeWorkspacePath);
    });
});
