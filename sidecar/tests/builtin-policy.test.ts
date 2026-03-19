import { describe, expect, test } from 'bun:test';
import { buildBuiltinEffectRequest } from '../src/tools/builtinPolicy';
import type { ToolDefinition } from '../src/tools/standard';

function makeTool(name: string): ToolDefinition {
    return {
        name,
        description: name,
        input_schema: { type: 'object', properties: {} },
        effects: [],
        handler: async () => ({}),
    };
}

describe('builtin tool policy bridge integration', () => {
    test('requests policy evaluation for host-folder reads outside the workspace', () => {
        const request = buildBuiltinEffectRequest({
            tool: makeTool('list_dir'),
            args: { path: '/Users/tester/Downloads' },
            context: {
                workspacePath: '/tmp/workspace',
                taskId: 'task-1',
            },
        });

        expect(request).toBeTruthy();
        expect(request?.effectType).toBe('filesystem:read');
        expect(request?.payload.path).toBe('/Users/tester/Downloads');
    });

    test('always requests policy evaluation for run_command', () => {
        const request = buildBuiltinEffectRequest({
            tool: makeTool('run_command'),
            args: { command: 'find . -type f' },
            context: {
                workspacePath: '/tmp/workspace',
                taskId: 'task-2',
            },
        });

        expect(request).toBeTruthy();
        expect(request?.effectType).toBe('shell:write');
        expect(request?.payload.command).toBe('find . -type f');
    });

    test('does not request policy evaluation for workspace-only reads', () => {
        const request = buildBuiltinEffectRequest({
            tool: makeTool('list_dir'),
            args: { path: './src' },
            context: {
                workspacePath: '/tmp/workspace',
                taskId: 'task-3',
            },
        });

        expect(request).toBeNull();
    });

    test('requests policy evaluation for host-folder file hashing outside the workspace', () => {
        const request = buildBuiltinEffectRequest({
            tool: makeTool('compute_file_hash'),
            args: { path: '/Users/tester/Downloads/a.png' },
            context: {
                workspacePath: '/tmp/workspace',
                taskId: 'task-4',
            },
        });

        expect(request).toBeTruthy();
        expect(request?.effectType).toBe('filesystem:read');
        expect(request?.payload.path).toBe('/Users/tester/Downloads/a.png');
    });

    test('marks host-folder deletions as delete operations for policy evaluation', () => {
        const request = buildBuiltinEffectRequest({
            tool: makeTool('delete_path'),
            args: { path: '/Users/tester/Downloads/a.png' },
            context: {
                workspacePath: '/tmp/workspace',
                taskId: 'task-5',
            },
        });

        expect(request).toBeTruthy();
        expect(request?.effectType).toBe('filesystem:write');
        expect(request?.payload.path).toBe('/Users/tester/Downloads/a.png');
        expect(request?.payload.operation).toBe('delete');
    });

    test('requests policy evaluation for workspace writes too', () => {
        const request = buildBuiltinEffectRequest({
            tool: makeTool('write_to_file'),
            args: { path: './notes/todo.txt' },
            context: {
                workspacePath: '/tmp/workspace',
                taskId: 'task-6',
            },
        });

        expect(request).toBeTruthy();
        expect(request?.effectType).toBe('filesystem:write');
        expect(request?.payload.path).toBe('/tmp/workspace/notes/todo.txt');
        expect(request?.payload.operation).toBe('write');
    });
});
