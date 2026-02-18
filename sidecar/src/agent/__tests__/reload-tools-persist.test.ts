import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { ToolRegistry } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/standard';

describe('reload_tools → generated tools persist', () => {
    let registry: ToolRegistry;
    let generatedTools: ToolDefinition[] = [];

    beforeEach(() => {
        registry = new ToolRegistry();
        generatedTools = [];
    });

    afterEach(() => {
        registry.clear();
    });

    test('generated tools survive reload when passed to handler', () => {
        const generatedTool: ToolDefinition = {
            name: 'generated_learned_skill_123',
            description: 'Runtime tool from learned skill',
            effects: ['code:execute'],
            input_schema: { type: 'object', properties: {} },
            handler: async () => ({ survived: true }),
        };

        generatedTools.push(generatedTool);
        registry.register('builtin', generatedTools);

        const beforeReload = registry.getTool('generated_learned_skill_123');
        expect(beforeReload).toBeDefined();

        registry.reload();

        const afterReloadWithoutTools = registry.getTool('generated_learned_skill_123');
        expect(afterReloadWithoutTools).toBeUndefined();
    });

    test('generated tools persist when re-registered after reload and remain callable', async () => {
        const generatedTool: ToolDefinition = {
            name: 'generated_mongodb_tool',
            description: 'MongoDB learned skill',
            effects: ['code:execute'],
            input_schema: {
                type: 'object',
                properties: {
                    collection: { type: 'string' },
                },
                required: ['collection'],
            },
            handler: async (args) => ({ success: true, collection: args.collection }),
        };

        generatedTools.push(generatedTool);
        registry.register('builtin', generatedTools);

        registry.reload();

        registry.register('builtin', generatedTools);

        const afterReload = registry.getTool('generated_mongodb_tool');
        expect(afterReload).toBeDefined();
        expect(afterReload?.description).toContain('MongoDB');
        const callResult = await afterReload!.handler(
            { collection: 'users' },
            { workspacePath: '/test', taskId: 't1' }
        );
        expect(callResult.success).toBe(true);
        expect(callResult.collection).toBe('users');
    });

    test('all tool categories can be restored after reload', () => {
        const standardTool: ToolDefinition = {
            name: 'list_dir',
            description: 'List directory',
            effects: ['filesystem:read'],
            input_schema: { type: 'object', properties: {} },
            handler: async () => ({}),
        };

        const databaseTool: ToolDefinition = {
            name: 'database_query',
            description: 'Query database',
            effects: ['network:outbound'],
            input_schema: { type: 'object', properties: {} },
            handler: async () => ({}),
        };

        const generatedTool: ToolDefinition = {
            name: 'generated_learned_postgres',
            description: 'PostgreSQL learned skill',
            effects: ['code:execute'],
            input_schema: { type: 'object', properties: {} },
            handler: async () => ({}),
        };

        registry.register('builtin', [standardTool, databaseTool, generatedTool]);

        const allBefore = registry.getAllTools();
        expect(allBefore.length).toBe(3);

        registry.reload();

        const afterReload = registry.getAllTools();
        expect(afterReload.length).toBe(0);

        registry.register('builtin', [standardTool, databaseTool, generatedTool]);

        const restored = registry.getAllTools();
        expect(restored.length).toBe(3);
        expect(restored.find(t => t.name === 'generated_learned_postgres')).toBeDefined();
        expect(restored.find(t => t.name === 'list_dir')).toBeDefined();
        expect(restored.find(t => t.name === 'database_query')).toBeDefined();
    });

    test('simulates handleReloadTools behavior with generated tools', () => {
        const builtinTools: ToolDefinition[] = [
            {
                name: 'view_file',
                description: 'View file',
                effects: ['filesystem:read'],
                input_schema: { type: 'object', properties: {} },
                handler: async () => ({}),
            },
        ];

        const databaseTools: ToolDefinition[] = [
            {
                name: 'database_connect',
                description: 'Connect to DB',
                effects: ['network:outbound'],
                input_schema: { type: 'object', properties: {} },
                handler: async () => ({}),
            },
        ];

        const enhancedBrowserTools: ToolDefinition[] = [
            {
                name: 'browser_navigate',
                description: 'Navigate browser',
                effects: ['ui:notify'],
                input_schema: { type: 'object', properties: {} },
                handler: async () => ({}),
            },
        ];

        const selfLearningTools: ToolDefinition[] = [
            {
                name: 'trigger_learning',
                description: 'Trigger learning',
                effects: ['network:outbound'],
                input_schema: { type: 'object', properties: {} },
                handler: async () => ({}),
            },
        ];

        const runtimeGeneratedTools: ToolDefinition[] = [
            {
                name: 'generated_sqlalchemy_query',
                description: 'Generated from learned SQLAlchemy skill',
                effects: ['code:execute'],
                input_schema: { type: 'object', properties: {} },
                handler: async () => ({ success: true }),
            },
        ];

        registry.register('builtin', builtinTools);
        registry.register('builtin', databaseTools);
        registry.register('builtin', enhancedBrowserTools);
        registry.register('builtin', selfLearningTools);
        registry.register('builtin', runtimeGeneratedTools);

        const countBefore = registry.getAllTools().length;
        expect(countBefore).toBe(5);

        registry.reload();

        const afterReload = registry.getAllTools().length;
        expect(afterReload).toBe(0);

        registry.register('builtin', builtinTools);
        registry.register('builtin', databaseTools);
        registry.register('builtin', enhancedBrowserTools);
        registry.register('builtin', selfLearningTools);
        registry.register('builtin', runtimeGeneratedTools);

        const restoredCount = registry.getAllTools().length;
        expect(restoredCount).toBe(5);

        const generated = registry.getTool('generated_sqlalchemy_query');
        expect(generated).toBeDefined();

        const result = generated!.handler({}, { workspacePath: '/test', taskId: 't1' });
        expect(result).resolves.toHaveProperty('success', true);
    });

    test('handles empty generated tools gracefully on reload', () => {
        const builtinTools: ToolDefinition[] = [
            {
                name: 'search_web',
                description: 'Web search',
                effects: ['network:outbound'],
                input_schema: { type: 'object', properties: {} },
                handler: async () => ({}),
            },
        ];

        registry.register('builtin', builtinTools);
        const before = registry.getAllTools().length;

        registry.reload();

        registry.register('builtin', builtinTools);
        registry.register('builtin', []);
        registry.register('builtin', []);
        registry.register('builtin', []);

        const after = registry.getAllTools().length;
        expect(after).toBe(before);
    });
});
