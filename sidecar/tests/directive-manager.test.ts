import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DirectiveManager } from '../src/directives/directiveManager';

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

    test('injects active persona style requirements into system prompt', () => {
        const root = makeTempDir();
        fs.writeFileSync(path.join(root, 'directives.json'), JSON.stringify({
            directives: [
                {
                    id: 'natural-reminder',
                    name: 'Natural Reminder',
                    content: 'Rewrite reminder confirmations naturally instead of echoing raw input.',
                    enabled: true,
                    priority: 2,
                },
            ],
            personas: [
                {
                    id: 'care-coach',
                    name: 'Care Coach',
                    description: 'Warm and caring assistant who sounds like a thoughtful friend.',
                    directives: ['natural-reminder'],
                },
            ],
            activePersonaId: 'care-coach',
        }, null, 2));

        const manager = new DirectiveManager(root);
        const prompt = manager.getSystemPromptAdditions('remind me to drink water every minute');

        expect(prompt).toContain('## Active Persona');
        expect(prompt).toContain('Name: Care Coach');
        expect(prompt).toContain('Warm and caring assistant');
        expect(prompt).toContain('For every user-facing reply');
        expect(prompt).toContain('[Natural Reminder] Rewrite reminder confirmations naturally instead of echoing raw input.');
    });

    test('keeps persona style injection even when no directive is enabled', () => {
        const root = makeTempDir();
        fs.writeFileSync(path.join(root, 'directives.json'), JSON.stringify({
            directives: [],
            personas: [
                {
                    id: 'minimal',
                    name: 'Minimal Coach',
                    description: 'Short and direct coaching voice.',
                    directives: [],
                },
            ],
            activePersonaId: 'minimal',
        }, null, 2));

        const manager = new DirectiveManager(root);
        const prompt = manager.getSystemPromptAdditions('set a reminder');

        expect(prompt).toContain('## Active Persona');
        expect(prompt).toContain('Name: Minimal Coach');
        expect(prompt).not.toContain('## User Directives (Identity & Rules)');
    });
});
