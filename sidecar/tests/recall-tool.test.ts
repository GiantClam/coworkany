import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { COWORKANY_BUILTIN_TOOL_DEFINITIONS } from '../src/tools/builtinTools';

const tempDirs: string[] = [];

function makeWorkspace(): string {
    const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-recall-tool-'));
    tempDirs.push(workspacePath);
    fs.mkdirSync(path.join(workspacePath, '.coworkany'), { recursive: true });
    return workspacePath;
}

afterEach(() => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (!dir) {
            continue;
        }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

describe('recall tool matching behavior', () => {
    test('falls back to fuzzy key matching when exact key is absent', async () => {
        const workspacePath = makeWorkspace();
        const memoryPath = path.join(workspacePath, '.coworkany', 'memory.json');
        fs.writeFileSync(memoryPath, JSON.stringify([
            {
                key: 'favorite_lang',
                value: 'TypeScript',
                category: 'preferences',
                timestamp: new Date().toISOString(),
            },
        ], null, 2), 'utf-8');

        const recallTool = COWORKANY_BUILTIN_TOOL_DEFINITIONS.find((tool) => tool.name === 'recall');
        expect(recallTool).toBeDefined();
        const result = await recallTool!.handler(
            {
                key: 'favorite_programming_language',
                query: 'favorite programming language',
                limit: 5,
            },
            {
                workspacePath,
                taskId: 'test-recall-fuzzy',
            },
        ) as { success: boolean; count: number; items: Array<{ value: string }> };

        expect(result.success).toBe(true);
        expect(result.count).toBeGreaterThan(0);
        expect(result.items[0]?.value.toLowerCase()).toContain('typescript');
    });

    test('prefers exact key hits when available', async () => {
        const workspacePath = makeWorkspace();
        const memoryPath = path.join(workspacePath, '.coworkany', 'memory.json');
        fs.writeFileSync(memoryPath, JSON.stringify([
            {
                key: 'favorite_lang',
                value: 'TypeScript',
                timestamp: new Date().toISOString(),
            },
            {
                key: 'favorite_programming_language',
                value: 'Rust',
                timestamp: new Date().toISOString(),
            },
        ], null, 2), 'utf-8');

        const recallTool = COWORKANY_BUILTIN_TOOL_DEFINITIONS.find((tool) => tool.name === 'recall');
        expect(recallTool).toBeDefined();
        const result = await recallTool!.handler(
            {
                key: 'favorite_programming_language',
                query: 'favorite programming language',
                limit: 1,
            },
            {
                workspacePath,
                taskId: 'test-recall-exact',
            },
        ) as { count: number; items: Array<{ value: string }> };

        expect(result.count).toBe(1);
        expect(result.items[0]?.value).toBe('Rust');
    });
});
