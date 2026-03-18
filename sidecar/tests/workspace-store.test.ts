import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceStore } from '../src/storage/workspaceStore';

function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('WorkspaceStore persistence root', () => {
    test('loads legacy workspaces.json into app-data storage and migrates paths under workspaces/', () => {
        const appDataDir = makeTempDir('coworkany-app-data-');
        const legacyRoot = makeTempDir('coworkany-legacy-root-');
        const legacyWorkspaceDir = path.join(legacyRoot, 'legacy-workspace');

        fs.mkdirSync(legacyWorkspaceDir, { recursive: true });
        fs.writeFileSync(path.join(legacyWorkspaceDir, 'hello.txt'), 'world');

        const legacyConfigPath = path.join(legacyRoot, 'workspaces.json');
        fs.writeFileSync(
            legacyConfigPath,
            JSON.stringify({
                workspaces: [
                    {
                        id: 'legacy-id',
                        name: 'Legacy Workspace',
                        path: legacyWorkspaceDir,
                        createdAt: '2026-03-18T00:00:00.000Z',
                        lastAccessedAt: '2026-03-18T00:00:00.000Z',
                    },
                ],
                activeWorkspaceId: 'legacy-id',
            })
        );

        const store = new WorkspaceStore(appDataDir, legacyConfigPath);
        const workspaces = store.list();

        expect(workspaces).toHaveLength(1);
        expect(store.getActive()?.id).toBe('legacy-id');

        const migrated = workspaces[0];
        expect(migrated.path).toStartWith(path.join(appDataDir, 'workspaces'));
        expect(fs.existsSync(path.join(appDataDir, 'workspaces.json'))).toBe(true);
        expect(fs.existsSync(path.join(migrated.path, 'hello.txt'))).toBe(true);
        expect(fs.existsSync(path.join(migrated.path, '.coworkany', 'skills'))).toBe(true);
        expect(fs.existsSync(path.join(migrated.path, '.coworkany', 'mcp'))).toBe(true);
    });

    test('recovers unmanaged workspace directories already present under app-data/workspaces', () => {
        const appDataDir = makeTempDir('coworkany-app-data-recover-');
        const orphanDir = path.join(appDataDir, 'workspaces', 'workspace_1773750167733');

        fs.mkdirSync(path.join(orphanDir, '.coworkany', 'skills'), { recursive: true });
        fs.mkdirSync(path.join(orphanDir, '.coworkany', 'mcp'), { recursive: true });

        const store = new WorkspaceStore(appDataDir);
        const workspaces = store.list();

        expect(workspaces).toHaveLength(1);
        expect(workspaces[0]?.path).toBe(orphanDir);
        expect(workspaces[0]?.name).toBe('New workspace');
        expect(workspaces[0]?.autoNamed).toBe(true);
        expect(fs.existsSync(path.join(appDataDir, 'workspaces.json'))).toBe(true);
    });
});
