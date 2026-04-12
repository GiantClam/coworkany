import { describe, expect, test } from 'bun:test';
import type { StoredToolpack } from '../src/storage/toolpackStore';
import { buildInternalRuntimeToolsets, countToolsInToolsets } from '../src/mastra/runtimeToolCatalog';
import type { ToolDefinition } from '../src/tools/standard';

const NOOP_TOOL: ToolDefinition = {
    name: 'list_dir',
    input_schema: { type: 'object' },
    effects: ['filesystem:read'],
    handler: async () => ([]),
};

describe('runtime tool catalog', () => {
    test('only exposes callable internal tools from enabled toolpacks', () => {
        const toolpacks: StoredToolpack[] = [
            {
                manifest: {
                    id: 'builtin-websearch',
                    name: 'websearch',
                    version: '1.0.0',
                    tools: ['search_web', 'list_dir'],
                    runtime: 'internal',
                },
                enabled: true,
                workingDir: '',
                installedAt: '2026-04-10T00:00:00.000Z',
                isBuiltin: true,
            },
            {
                manifest: {
                    id: 'builtin-disabled',
                    name: 'disabled-pack',
                    version: '1.0.0',
                    tools: ['list_dir'],
                    runtime: 'internal',
                },
                enabled: false,
                workingDir: '',
                installedAt: '2026-04-10T00:00:00.000Z',
                isBuiltin: true,
            },
        ];

        const toolsets = buildInternalRuntimeToolsets({
            toolpacks,
            resolveTool: (toolName) => (toolName === 'list_dir' ? NOOP_TOOL : undefined),
        });

        expect(Object.keys(toolsets)).toEqual(['internal:builtin-websearch']);
        expect(toolsets['internal:builtin-websearch']?.list_dir).toBeDefined();
        expect(toolsets['internal:builtin-websearch']?.search_web).toBeUndefined();
        expect(countToolsInToolsets(toolsets)).toBe(1);
    });
});
