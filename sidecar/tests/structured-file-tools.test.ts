import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { STANDARD_TOOLS } from '../src/tools/standard';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-structured-tools-'));
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

function getTool(name: string) {
    const tool = STANDARD_TOOLS.find((candidate) => candidate.name === name);
    if (!tool) {
        throw new Error(`Tool not found: ${name}`);
    }
    return tool;
}

describe('structured file tools', () => {
    test('create_directory creates nested directories', async () => {
        const workspacePath = makeTempDir();
        const tool = getTool('create_directory');

        const result = await tool.handler(
            { path: './organized/screenshots' },
            { workspacePath, taskId: 'task-1' }
        );

        expect((result as any).success).toBe(true);
        expect(fs.existsSync(path.join(workspacePath, 'organized', 'screenshots'))).toBe(true);
    });

    test('move_file moves files into a destination path', async () => {
        const workspacePath = makeTempDir();
        const sourcePath = path.join(workspacePath, 'image.png');
        fs.writeFileSync(sourcePath, 'png-data', 'utf-8');
        const tool = getTool('move_file');

        const result = await tool.handler(
            {
                source_path: './image.png',
                destination_path: './sorted/image.png',
            },
            { workspacePath, taskId: 'task-2' }
        );

        expect((result as any).success).toBe(true);
        expect(fs.existsSync(sourcePath)).toBe(false);
        expect(fs.readFileSync(path.join(workspacePath, 'sorted', 'image.png'), 'utf-8')).toBe('png-data');
    });

    test('compute_file_hash returns the same hash for identical content', async () => {
        const workspacePath = makeTempDir();
        fs.writeFileSync(path.join(workspacePath, 'a.png'), 'same-bytes', 'utf-8');
        fs.writeFileSync(path.join(workspacePath, 'b.png'), 'same-bytes', 'utf-8');
        const tool = getTool('compute_file_hash');

        const first = await tool.handler(
            { path: './a.png' },
            { workspacePath, taskId: 'task-h1' }
        );
        const second = await tool.handler(
            { path: './b.png' },
            { workspacePath, taskId: 'task-h2' }
        );

        expect((first as any).success).toBe(true);
        expect((second as any).success).toBe(true);
        expect((first as any).hash).toBe((second as any).hash);
    });

    test('delete_path removes a file', async () => {
        const workspacePath = makeTempDir();
        const filePath = path.join(workspacePath, 'remove-me.txt');
        fs.writeFileSync(filePath, 'bye', 'utf-8');
        const tool = getTool('delete_path');

        const result = await tool.handler(
            { path: './remove-me.txt' },
            { workspacePath, taskId: 'task-del1' }
        );

        expect((result as any).success).toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    test('batch_delete_paths removes multiple files in one call', async () => {
        const workspacePath = makeTempDir();
        fs.writeFileSync(path.join(workspacePath, 'a.txt'), 'a', 'utf-8');
        fs.writeFileSync(path.join(workspacePath, 'b.txt'), 'b', 'utf-8');
        const tool = getTool('batch_delete_paths');

        const result = await tool.handler(
            {
                deletes: [
                    { path: './a.txt' },
                    { path: './b.txt' },
                ],
            },
            { workspacePath, taskId: 'task-del2' }
        );

        expect((result as any).success).toBe(true);
        expect(fs.existsSync(path.join(workspacePath, 'a.txt'))).toBe(false);
        expect(fs.existsSync(path.join(workspacePath, 'b.txt'))).toBe(false);
    });

    test('list_dir supports recursive traversal with relative paths', async () => {
        const workspacePath = makeTempDir();
        fs.mkdirSync(path.join(workspacePath, 'nested', 'inner'), { recursive: true });
        fs.writeFileSync(path.join(workspacePath, 'nested', 'inner', 'a.pdf'), 'a', 'utf-8');
        const tool = getTool('list_dir');

        const result = await tool.handler(
            { path: '.', recursive: true, max_depth: 4 },
            { workspacePath, taskId: 'task-list-recursive' }
        );

        expect(Array.isArray(result)).toBe(true);
        expect((result as any[]).some((entry) => entry.path === 'nested/inner/a.pdf')).toBe(true);
    });

    test('batch_move_files moves multiple files in one call', async () => {
        const workspacePath = makeTempDir();
        fs.writeFileSync(path.join(workspacePath, 'a.png'), 'a', 'utf-8');
        fs.writeFileSync(path.join(workspacePath, 'b.png'), 'b', 'utf-8');
        const tool = getTool('batch_move_files');

        const result = await tool.handler(
            {
                moves: [
                    {
                        source_path: './a.png',
                        destination_path: './images/a.png',
                    },
                    {
                        source_path: './b.png',
                        destination_path: './images/b.png',
                    },
                ],
            },
            { workspacePath, taskId: 'task-3' }
        );

        expect((result as any).success).toBe(true);
        expect(fs.readFileSync(path.join(workspacePath, 'images', 'a.png'), 'utf-8')).toBe('a');
        expect(fs.readFileSync(path.join(workspacePath, 'images', 'b.png'), 'utf-8')).toBe('b');
    });
});
