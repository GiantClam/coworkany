import { describe, expect, test } from 'bun:test';
import { mcp } from '../src/mastra/mcp/clients';
import { deleteFilesTool, sendEmailTool } from '../src/mastra/tools/approval-tools';
import {
    bashApprovalTool,
    bashTool,
    isDangerousCommand,
    needsApprovalForCommand,
} from '../src/mastra/tools/bash';

describe('Phase 2: Tool System', () => {
    test('bash tool executes safe command', async () => {
        const output = await bashTool.execute?.({ command: 'echo hello' }, {});
        expect(output).toBeDefined();
        expect(output?.exitCode).toBe(0);
        expect(output?.stdout.trim()).toBe('hello');
    });

    test('bash tool returns non-zero for failed command', async () => {
        const output = await bashTool.execute?.({ command: 'ls /path/that/does/not/exist' }, {});
        expect(output).toBeDefined();
        expect((output?.exitCode ?? 0) !== 0).toBe(true);
    });

    test('bash tool timeout returns quickly', async () => {
        const output = await bashTool.execute?.({ command: 'sleep 2', timeout: 100 }, {});
        expect(output).toBeDefined();
        expect((output?.exitCode ?? 0) !== 0).toBe(true);
    });

    test('dangerous command detection works', () => {
        expect(isDangerousCommand('rm -rf /')).toBe(true);
        expect(isDangerousCommand('sudo rm -rf /tmp/a')).toBe(true);
        expect(isDangerousCommand('echo safe')).toBe(false);
    });

    test('approval command detection works', () => {
        expect(needsApprovalForCommand('rm -r ./tmp')).toBe(true);
        expect(needsApprovalForCommand('brew install ffmpeg')).toBe(true);
        expect(needsApprovalForCommand('git status')).toBe(false);
    });

    test('bash approval tool marked as requireApproval', () => {
        expect(bashApprovalTool.requireApproval).toBe(true);
    });

    test('approval tools marked as requireApproval', () => {
        expect(deleteFilesTool.requireApproval).toBe(true);
        expect(sendEmailTool.requireApproval).toBe(true);
    });

    test('input schema validation works', () => {
        expect(bashTool.inputSchema?.safeParse({ command: 'ls' }).success).toBe(true);
        expect(bashTool.inputSchema?.safeParse({}).success).toBe(false);
        expect(deleteFilesTool.inputSchema?.safeParse({ paths: ['/tmp/a'], reason: 'cleanup' }).success).toBe(true);
    });

    test('MCP client instance created', () => {
        expect(mcp).toBeDefined();
    });
});
