import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RequestContext } from '@mastra/core/request-context';
import type { StoredToolpack } from '../src/storage/toolpackStore';
import { buildInternalRuntimeToolsets, countToolsInToolsets } from '../src/mastra/runtimeToolCatalog';
import type { ToolDefinition } from '../src/tools/core/types';
import { resolveRuntimeInternalTool } from '../src/mastra/internalToolResolver';
import { resolveCoworkAnyMastraTools } from '../src/mastra/tools/coworkanyToolRegistry';

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

    test('resolves builtin search_web via internal fallback metadata', () => {
        const toolpacks: StoredToolpack[] = [
            {
                manifest: {
                    id: 'builtin-websearch',
                    name: 'websearch',
                    version: '1.0.0',
                    tools: ['search_web'],
                    runtime: 'internal',
                },
                enabled: true,
                workingDir: '',
                installedAt: '2026-04-10T00:00:00.000Z',
                isBuiltin: true,
            },
        ];

        const toolsets = buildInternalRuntimeToolsets({
            toolpacks,
            resolveTool: resolveRuntimeInternalTool,
        });

        expect(toolsets['internal:builtin-websearch']?.search_web).toBeDefined();
        expect(countToolsInToolsets(toolsets)).toBe(1);
    });

    test('core profile resolves baseline CoworkAny builtin tools as Mastra tools', () => {
        const tools = resolveCoworkAnyMastraTools({
            env: { COWORKANY_RUNTIME_PROFILE: 'core' } as NodeJS.ProcessEnv,
        });

        expect(Object.keys(tools).sort()).toEqual([
            'list_dir',
            'replace_file_content',
            'run_command',
            'view_file',
            'write_to_file',
        ]);
    });

    test('full profile resolves all CoworkAny builtin tools as Mastra tools', () => {
        const tools = resolveCoworkAnyMastraTools({
            env: { COWORKANY_RUNTIME_PROFILE: 'full' } as NodeJS.ProcessEnv,
        });

        expect(Object.keys(tools).sort()).toEqual([
            'batch_delete_paths',
            'batch_move_files',
            'compute_file_hash',
            'crawl_url',
            'create_directory',
            'delete_path',
            'extract_content',
            'list_dir',
            'move_file',
            'recall',
            'remember',
            'replace_file_content',
            'run_command',
            'search_web',
            'view_file',
            'voice_speak',
            'write_to_file',
        ]);
    });

    test('builtin research tools expose web research metadata through internal resolver', () => {
        const resolved = resolveRuntimeInternalTool('search_web');

        expect(resolved?.name).toBe('search_web');
        expect(resolved?.effects).toContain('network:outbound');
    });

    test('CoworkAny builtin tool aliases resolve to canonical Mastra tool metadata', () => {
        const resolved = resolveRuntimeInternalTool('bash');

        expect(resolved?.name).toBe('run_command');
        expect(resolved?.effects).toContain('process:spawn');
        expect(resolved?.effects).toContain('code:execute');
    });

    test('CoworkAny builtin Mastra tools execute with CoworkAny request context', async () => {
        const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-mastra-builtin-tool-'));
        fs.writeFileSync(path.join(workspace, 'note.txt'), 'hello from builtin mastra tool', 'utf8');
        const requestContext = new RequestContext();
        requestContext.set('workspacePath', workspace);
        requestContext.set('taskId', 'task-builtin-mastra-tool');
        const tools = resolveCoworkAnyMastraTools({ include: ['view_file'] });
        const viewFile = tools.view_file;

        expect(viewFile?.execute).toBeDefined();
        const result = await viewFile?.execute?.(
            { path: 'note.txt' },
            { requestContext } as any,
        );

        expect(result).toBe('hello from builtin mastra tool');
    });
});
