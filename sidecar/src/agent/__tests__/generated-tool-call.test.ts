import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { ToolRegistry } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/standard';

function inferTemplateParams(templateCode: string): Array<{ name: string; defaultValue?: string }> {
    const params = new Map<string, { name: string; defaultValue?: string }>();
    const pattern = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*=\s*([^}]+?))?\s*\}\}/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(templateCode)) !== null) {
        const [, rawName, rawDefault] = match;
        if (!params.has(rawName)) {
            params.set(rawName, {
                name: rawName,
                defaultValue: rawDefault?.trim(),
            });
        }
    }

    return Array.from(params.values());
}

function buildGeneratedToolSpec(name: string, templateCode: string): ToolDefinition {
    const inferredParams = inferTemplateParams(templateCode);
    const properties: Record<string, unknown> = {
        timeout_ms: { type: 'integer', description: 'Timeout' },
    };
    const required: string[] = [];

    for (const param of inferredParams) {
        properties[param.name] = { type: 'string', description: 'Inferred template parameter' };
        if (!param.defaultValue) {
            required.push(param.name);
        }
    }

    const schema = {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
    };

    return {
        name,
        description: 'Auto-generated tool from learned skill',
        effects: ['code:execute', 'process:spawn'],
        input_schema: schema,
        handler: async (args) => {
            let rendered = templateCode;
            for (const param of inferredParams) {
                const value = (args?.[param.name] as string | undefined) ?? param.defaultValue;
                if (!value) {
                    return { success: false, error: `Missing required template parameters: ${param.name}` };
                }
                rendered = rendered.replace(new RegExp(`\\{\\{\\s*${param.name}(?:\\s*=\\s*[^}]+)?\\s*\\}\\}`, 'g'), value);
            }

            return {
                success: true,
                output: rendered,
                timeout: args?.timeout_ms,
            };
        },
    };
}

describe('Generated runtime tool → immediate invocation', () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    afterEach(() => {
        registry.clear();
    });

    test('generated tool infers template params and is callable immediately', async () => {
        const generatedTool = buildGeneratedToolSpec(
            'generated_postgresql_query',
            'import psycopg2\nconn = psycopg2.connect(host="{{host}}", dbname="{{database=app}}")\nprint("{{sql}}")'
        );

        registry.register('builtin', [generatedTool]);

        const retrieved = registry.getTool('generated_postgresql_query');
        expect(retrieved).toBeDefined();
        expect(retrieved?.name).toBe('generated_postgresql_query');
        const schema = retrieved?.input_schema as {
            properties: Record<string, unknown>;
            required?: string[];
        };
        expect(Object.keys(schema.properties)).toContain('host');
        expect(Object.keys(schema.properties)).toContain('database');
        expect(Object.keys(schema.properties)).toContain('sql');
        expect(schema.required).toEqual(['host', 'sql']);

        const result = await retrieved!.handler(
            { host: '127.0.0.1', sql: 'SELECT * FROM users', timeout_ms: 1500 },
            { workspacePath: '/test', taskId: 't1' }
        );
        expect(result.success).toBe(true);
        expect(result.output).toContain('psycopg2');
        expect(result.output).toContain('127.0.0.1');
        expect(result.output).toContain('SELECT * FROM users');
        expect(result.output).toContain('dbname="app"');
    });

    test('generated tool returns error when required inferred parameter missing', async () => {
        const generatedTool = buildGeneratedToolSpec(
            'generated_missing_required',
            'print("{{required_value}}")'
        );

        registry.register('builtin', [generatedTool]);
        const retrieved = registry.getTool('generated_missing_required');
        const result = await retrieved!.handler({}, { workspacePath: '/test', taskId: 't1' });

        expect(result.success).toBe(false);
        expect(String(result.error)).toContain('required_value');
    });

    test('generated tool can replace old version after source refresh', async () => {
        const originalTool: ToolDefinition = {
            name: 'generated_mongo_query',
            description: 'Original generated tool',
            effects: ['code:execute'],
            input_schema: { type: 'object', properties: {} },
            handler: async () => ({ version: 'original' }),
        };

        const newTool: ToolDefinition = {
            name: 'generated_mongo_query',
            description: 'New improved version',
            effects: ['code:execute'],
            input_schema: { type: 'object', properties: {} },
            handler: async () => ({ version: 'new' }),
        };

        registry.register('builtin', [originalTool]);
        registry.unregisterBySource('builtin', ['generated_mongo_query']);
        registry.register('builtin', [newTool]);

        const retrieved = registry.getTool('generated_mongo_query');
        const result = await retrieved!.handler({}, { workspacePath: '/test', taskId: 't1' });
        expect(result.version).toBe('new');
    });

    test('generated tool from precipitation can be retrieved via skill ID', async () => {
        const skillId = 'learn_postgresql_connection';
        const runtimeTools = new Map<string, ToolDefinition>();

        const runtimeTool: ToolDefinition = {
            name: `generated_${skillId}`,
            description: `Runtime tool derived from skill: ${skillId}`,
            effects: ['code:execute'],
            input_schema: {
                type: 'object',
                properties: {
                    prompt: { type: 'string' },
                },
            },
            handler: async () => ({ skillId, executed: true }),
        };

        runtimeTools.set(skillId, runtimeTool);
        registry.register('builtin', [runtimeTool]);

        const retrieved = registry.getTool(`generated_${skillId}`);
        expect(retrieved).toBeDefined();

        const result = await retrieved!.handler({ prompt: 'test' }, { workspacePath: '/test', taskId: 't1' });
        expect(result.executed).toBe(true);
        expect(result.skillId).toBe(skillId);
    });

    test('generated tool respects effect restrictions', () => {
        const restrictedTool: ToolDefinition = {
            name: 'generated_restricted_tool',
            description: 'Tool with limited effects',
            effects: ['filesystem:read'],
            input_schema: { type: 'object', properties: {} },
            handler: async () => ({}),
        };

        registry.register('builtin', [restrictedTool]);

        const allTools = registry.getAllTools();
        const restricted = allTools.find(t => t.name === 'generated_restricted_tool');
        expect(restricted?.effects).toContain('filesystem:read');
    });
});
