import { describe, expect, test } from 'bun:test';
import {
    buildCapabilityDescriptor,
    detectCapabilityConflicts,
    type CapabilityDescriptor,
} from '../src/tools/capabilityCatalog';

function descriptor(input: Partial<CapabilityDescriptor> & Pick<CapabilityDescriptor, 'provider' | 'toolName'>): CapabilityDescriptor {
    return buildCapabilityDescriptor({
        provider: input.provider,
        toolName: input.toolName,
        sourceId: input.sourceId,
        description: input.description,
        effects: input.effects,
        inputSchema: input.inputSchema,
    });
}

describe('capabilityCatalog', () => {
    test('infers semantic key and interaction mode from tool metadata', () => {
        const result = descriptor({
            provider: 'builtin',
            toolName: 'run_command',
            description: 'Execute shell command with interactive terminal support.',
            effects: ['process:spawn'],
        });

        expect(result.semanticKey).toBe('execute.process');
        expect(result.interactionMode).toBe('tty_required');
    });

    test('detects duplicate and replaceable conflicts by same tool name', () => {
        const conflicts = detectCapabilityConflicts([
            descriptor({ provider: 'builtin', toolName: 'shared_tool' }),
            descriptor({ provider: 'mcp', toolName: 'shared_tool', sourceId: 'demo-server' }),
        ]);

        expect(conflicts.some((conflict) => conflict.kind === 'duplicate')).toBe(true);
        expect(conflicts.some((conflict) => conflict.kind === 'replaceable')).toBe(true);
    });

    test('detects overlap and mutex conflicts for semantic-equivalent tools', () => {
        const conflicts = detectCapabilityConflicts([
            descriptor({ provider: 'builtin', toolName: 'list_dir', description: 'List directory entries.' }),
            descriptor({ provider: 'mcp', toolName: 'list_directory', sourceId: 'fs-server', description: 'List directory entries with interactive mode.' }),
            descriptor({ provider: 'mcp', toolName: 'list_directory_interactive', sourceId: 'fs-server', description: 'Interactive prompt required to list directory.', effects: ['process:spawn'] }),
        ]);

        expect(conflicts.some((conflict) => conflict.kind === 'overlap')).toBe(true);
        expect(conflicts.some((conflict) => conflict.kind === 'mutex')).toBe(true);
    });
});
