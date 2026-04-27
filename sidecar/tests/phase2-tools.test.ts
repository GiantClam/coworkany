import { describe, expect, test } from 'bun:test';
import { mcp } from '../src/mastra/mcp/clients';
import { deleteFilesTool, sendEmailTool } from '../src/mastra/tools/approval-tools';
import { resolveCoworkAnyMastraTools } from '../src/mastra/tools/coworkanyToolRegistry';
import { checkCommand } from '../src/tools/commandSandbox';

async function runCommand(input: { command: string; timeout_ms?: number }) {
    const tool = resolveCoworkAnyMastraTools({ include: ['run_command'] }).run_command;
    expect(tool?.execute).toBeDefined();
    return await tool.execute?.(input, {} as any) as Record<string, any>;
}

describe('Phase 2: Tool System', () => {
    test('run_command tool executes safe command', async () => {
        const output = await runCommand({ command: 'echo hello' });
        expect(output).toBeDefined();
        expect(output?.exit_code).toBe(0);
        expect(output?.stdout.trim()).toBe('hello');
    });

    test('run_command tool returns non-zero for failed command', async () => {
        const output = await runCommand({ command: 'ls /path/that/does/not/exist' });
        expect(output).toBeDefined();
        expect((output?.exit_code ?? 0) !== 0).toBe(true);
    });

    test('run_command tool returns command recovery hints for missing commands', async () => {
        const output = await runCommand({ command: '__coworkany_missing_cmd__ --version' });
        expect(output).toBeDefined();
        expect((output?.exit_code ?? 0) !== 0).toBe(true);
        expect(output?.error_type).toBe('not_found');
        expect(typeof output?.suggested_fix).toBe('string');
        expect((output?.probe_commands?.length ?? 0) > 0).toBe(true);
    });

    test('run_command tool timeout returns quickly', async () => {
        const output = await runCommand({ command: 'sleep 2', timeout_ms: 100 });
        expect(output).toBeDefined();
        expect((output?.exit_code ?? 0) !== 0).toBe(true);
    });

    test('dangerous command detection works', () => {
        expect(checkCommand('rm -rf /').allowed).toBe(false);
        expect(checkCommand('rm -rf ~/tmp').allowed).toBe(false);
        expect(checkCommand('sudo shutdown -h +1').allowed).toBe(true);
        expect(checkCommand('echo safe').riskLevel).toBe('safe');
    });

    test('interactive command detection works', () => {
        expect(checkCommand('sudo shutdown -h +1').needsInteraction).toBe(true);
        expect(checkCommand('shutdown -h +1').needsInteraction).toBe(true);
        expect(checkCommand('git status').needsInteraction).toBe(false);
    });

    test('approval tools marked as requireApproval', () => {
        expect(deleteFilesTool.requireApproval).toBe(true);
        expect(sendEmailTool.requireApproval).toBe(true);
    });

    test('input schema validation works', () => {
        const runCommandTool = resolveCoworkAnyMastraTools({ include: ['run_command'] }).run_command;
        expect(runCommandTool.inputSchema?.safeParse({ command: 'ls' }).success).toBe(true);
        expect(runCommandTool.inputSchema?.safeParse({}).success).toBe(false);
        expect(deleteFilesTool.inputSchema?.safeParse({ paths: ['/tmp/a'], reason: 'cleanup' }).success).toBe(true);
    });

    test('MCP client instance created', () => {
        expect(mcp).toBeDefined();
    });
});
