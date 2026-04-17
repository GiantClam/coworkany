import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { cleanupTransientWorkspaceArtifacts } from '../src/ipc/streaming';

const tempDirs: string[] = [];

async function exists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function makeWorkspace(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-transient-clean-'));
    tempDirs.push(dir);
    return dir;
}

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        await fs.rm(dir, { recursive: true, force: true });
    }
});

describe('cleanupTransientWorkspaceArtifacts', () => {
    test('removes transient python and pytest artifacts from workspace', async () => {
        const workspacePath = await makeWorkspace();
        const stableFile = path.join(workspacePath, 'result.md');
        const pycFile = path.join(workspacePath, 'orphan.pyc');
        const nestedDir = path.join(workspacePath, 'nested');
        const pycacheDir = path.join(nestedDir, '__pycache__');
        const pytestCacheDir = path.join(nestedDir, '.pytest_cache');
        const pyoFile = path.join(nestedDir, 'module.pyo');

        await fs.mkdir(pycacheDir, { recursive: true });
        await fs.mkdir(pytestCacheDir, { recursive: true });
        await fs.writeFile(stableFile, '# stable\n', 'utf8');
        await fs.writeFile(pycFile, 'compiled', 'utf8');
        await fs.writeFile(path.join(pycacheDir, 'a.cpython-312.pyc'), 'compiled', 'utf8');
        await fs.writeFile(path.join(pytestCacheDir, 'state.json'), '{}', 'utf8');
        await fs.writeFile(pyoFile, 'optimized', 'utf8');

        const removed = await cleanupTransientWorkspaceArtifacts({
            workspacePath,
            requiredOutputPaths: [stableFile],
        });

        expect(removed.length).toBeGreaterThanOrEqual(4);
        expect(await exists(stableFile)).toBe(true);
        expect(await exists(pycFile)).toBe(false);
        expect(await exists(pycacheDir)).toBe(false);
        expect(await exists(pytestCacheDir)).toBe(false);
        expect(await exists(pyoFile)).toBe(false);
    });

    test('does not delete required output paths even when extension matches transient patterns', async () => {
        const workspacePath = await makeWorkspace();
        const requiredPyc = path.join(workspacePath, 'deliverable.pyc');
        await fs.writeFile(requiredPyc, 'must-keep', 'utf8');

        const removed = await cleanupTransientWorkspaceArtifacts({
            workspacePath,
            requiredOutputPaths: [requiredPyc],
        });

        expect(await exists(requiredPyc)).toBe(true);
        expect(removed).not.toContain(requiredPyc);
    });
});
