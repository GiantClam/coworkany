import type { ToolpackManifest } from '../protocol';

export const CORE_TOOLPACK_ID = 'standard-tools';

export const CORE_BASELINE_TOOL_IDS = [
    'view_file',
    'list_dir',
    'write_to_file',
    'replace_file_content',
    'run_command',
] as const;

export function createCoreToolpackManifest(): ToolpackManifest {
    return {
        id: CORE_TOOLPACK_ID,
        name: 'Standard Tools',
        version: '1.0.0',
        description: 'Core loop and harness tools for workspace inspection, controlled edits, and command execution.',
        tools: [...CORE_BASELINE_TOOL_IDS],
        runtime: 'internal',
        effects: ['filesystem:read', 'filesystem:write', 'shell:write'],
        tags: ['core', 'harness', 'standard'],
    };
}
