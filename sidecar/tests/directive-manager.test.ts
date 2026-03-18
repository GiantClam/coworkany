import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DirectiveManager } from '../src/agent/directives/directiveManager';

const tempDirs: string[] = [];

function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-directives-'));
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

describe('directive manager', () => {
    test('persists custom directives and builds prompt additions by priority', () => {
        const root = makeTempDir();
        const manager = new DirectiveManager(root);

        manager.upsertDirective({
            id: 'ts-no-any',
            name: 'No Any',
            content: 'Do not use any.',
            enabled: true,
            priority: 3,
            trigger: 'typescript',
        });
        manager.upsertDirective({
            id: 'concise',
            name: 'Concise',
            content: 'Keep answers concise.',
            enabled: true,
            priority: 1,
        });

        const prompt = manager.getSystemPromptAdditions('please write TypeScript code');
        expect(prompt).toContain('[No Any] Do not use any.');
        expect(prompt).toContain('[Concise] Keep answers concise.');

        const reloaded = new DirectiveManager(root);
        expect(reloaded.listDirectives().map((directive) => directive.id)).toContain('ts-no-any');
    });
});
