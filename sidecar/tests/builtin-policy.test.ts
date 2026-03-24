import { describe, expect, test } from 'bun:test';
import { buildBuiltinEffectRequest } from '../src/tools/builtinPolicy';
import type { ToolDefinition } from '../src/tools/standard';

const TOOL_CONTEXT = {
    workspacePath: '/tmp/workspace',
    taskId: 'task-test',
};

describe('builtinPolicy', () => {
    test('maps execute_opencli_capability to shell:write with deterministic command payload', () => {
        const tool: ToolDefinition = {
            name: 'execute_opencli_capability',
            description: 'Execute opencli capability',
            effects: ['process:spawn'],
            input_schema: { type: 'object' },
            handler: async () => ({ success: true }),
        };

        const effect = buildBuiltinEffectRequest({
            tool,
            args: {
                capability: 'gh.repo.list',
                arguments: ['--owner', 'openai'],
            },
            context: TOOL_CONTEXT,
        });

        expect(effect).toBeTruthy();
        expect(effect?.effectType).toBe('shell:write');
        expect(effect?.payload.command).toBe('opencli exec gh.repo.list --owner openai');
    });

    test('maps install_cli_from_registry to shell:write with managed installer command payload', () => {
        const tool: ToolDefinition = {
            name: 'install_cli_from_registry',
            description: 'Install allowlisted cli',
            effects: ['process:spawn'],
            input_schema: { type: 'object' },
            handler: async () => ({ success: true }),
        };

        const effect = buildBuiltinEffectRequest({
            tool,
            args: {
                cli_id: 'opencli-cli',
            },
            context: TOOL_CONTEXT,
        });

        expect(effect).toBeTruthy();
        expect(effect?.effectType).toBe('shell:write');
        expect(effect?.payload.command).toBe('npm install -g @jackwener/opencli');
    });

    test('maps install_cli_from_registry with custom cli_id to generic managed install payload', () => {
        const tool: ToolDefinition = {
            name: 'install_cli_from_registry',
            description: 'Install configured cli',
            effects: ['process:spawn'],
            input_schema: { type: 'object' },
            handler: async () => ({ success: true }),
        };

        const effect = buildBuiltinEffectRequest({
            tool,
            args: {
                cli_id: 'acme-cli',
            },
            context: TOOL_CONTEXT,
        });

        expect(effect).toBeTruthy();
        expect(effect?.effectType).toBe('shell:write');
        expect(effect?.payload.command).toBe('managed-cli install acme-cli');
    });
});
