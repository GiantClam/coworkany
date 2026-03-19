import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceStore } from '../src/storage/workspaceStore';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('WorkspaceStore persistence root', () => {
    test('only loads workspaces declared in workspaces.json', () => {
        const appDataDir = makeTempDir('coworkany-app-data-file-only-');
        const declaredDir = path.join(appDataDir, 'declared-workspace');
        const orphanDir = path.join(appDataDir, 'workspaces', 'orphan-workspace');

        fs.mkdirSync(path.join(declaredDir, '.coworkany', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(declaredDir, '.coworkany', 'mcp'), { recursive: true });
        fs.mkdirSync(path.join(orphanDir, '.coworkany', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(orphanDir, '.coworkany', 'mcp'), { recursive: true });

        fs.writeFileSync(
            path.join(appDataDir, 'workspaces.json'),
            JSON.stringify({
                workspaces: [
                    {
                        id: 'declared-id',
                        name: 'Declared Workspace',
                        path: declaredDir,
                        createdAt: '2026-03-19T00:00:00.000Z',
                        lastAccessedAt: '2026-03-19T00:00:00.000Z',
                        autoNamed: false,
                        defaultSkills: [],
                        defaultToolpacks: ['builtin-websearch'],
                    },
                ],
            })
        );

        const store = new WorkspaceStore(appDataDir);
        const workspaces = store.list();

        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]?.id).toBe('declared-id');
        expect(workspaces[0]?.path).toBe(declaredDir);
        expect(workspaces.find((workspace) => workspace.path === orphanDir)).toBeUndefined();
    });
});
