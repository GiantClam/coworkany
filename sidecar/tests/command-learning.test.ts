import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { STANDARD_TOOLS, setCommandApprovalRequester } from '../src/tools/standard';

const runCommandTool = STANDARD_TOOLS.find((tool) => tool.name === 'run_command');
const commandHelpTool = STANDARD_TOOLS.find((tool) => tool.name === 'command_help');
const commandPreflightTool = STANDARD_TOOLS.find((tool) => tool.name === 'command_preflight');

function makeWorkspacePath(): string {
    const workspacePath = path.join(os.tmpdir(), `coworkany-command-learning-${randomUUID()}`);
    fs.mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
}

function cleanupWorkspace(workspacePath: string): void {
    fs.rmSync(workspacePath, { recursive: true, force: true });
}

function getProtectedCommand(workspacePath: string): string {
    if (process.platform === 'win32') {
        return 'taskkill /IM definitely-not-running.exe /F';
    }

    const filePath = path.join(workspacePath, 'sample.txt');
    fs.writeFileSync(filePath, 'sample', 'utf8');
    return 'chmod 755 sample.txt';
}

describe('command learning workflow', () => {
    let lastWorkspacePath: string | null = null;

    afterEach(() => {
        setCommandApprovalRequester(null);
        if (lastWorkspacePath) {
            cleanupWorkspace(lastWorkspacePath);
            lastWorkspacePath = null;
        }
    });

    test('run_command requires preflight for protected commands', async () => {
        expect(runCommandTool).toBeTruthy();
        if (!runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const command = getProtectedCommand(workspacePath);

        const result = await runCommandTool.handler(
            { command },
            { taskId: 'command-learning-test', workspacePath }
        ) as Record<string, any>;

        expect(result.error_type).toBe('preflight_required');
        expect(result.suggested_tool).toBe('command_preflight');
        expect(result.preflight?.help).toBeTruthy();
        expect(typeof result.preflight?.nextStep).toBe('string');
    });

    test('command_preflight returns help output and token that unlocks run_command', async () => {
        expect(commandHelpTool).toBeTruthy();
        expect(commandPreflightTool).toBeTruthy();
        expect(runCommandTool).toBeTruthy();
        if (!commandHelpTool || !commandPreflightTool || !runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const command = getProtectedCommand(workspacePath);

        const helpResult = await commandHelpTool.handler(
            { command },
            { taskId: 'command-help-test', workspacePath }
        ) as Record<string, any>;
        expect(helpResult.help?.outputSnippet || helpResult.help?.stderrSnippet).toBeTruthy();
        expect(helpResult.systemContext?.platformName).toBeTruthy();
        expect(Array.isArray(helpResult.systemContext?.recommendedHelpCommands)).toBe(true);
        expect(helpResult.commandKnowledge?.baseCommand).toBeTruthy();

        const preflightResult = await commandPreflightTool.handler(
            { command },
            { taskId: 'command-preflight-test', workspacePath }
        ) as Record<string, any>;

        expect(preflightResult.commandExists).toBe(true);
        expect(typeof preflightResult.preflightToken).toBe('string');
        expect(preflightResult.help?.outputSnippet || preflightResult.help?.stderrSnippet).toBeTruthy();
        expect(preflightResult.systemContext?.platformName).toBeTruthy();
        expect(preflightResult.commandKnowledge?.baseCommand).toBeTruthy();
        expect(preflightResult.learningPath?.sequence).toEqual(['system_status', 'command_help', 'command_preflight', 'run_command']);

        const executionResult = await runCommandTool.handler(
            {
                command,
                preflight_token: preflightResult.preflightToken,
            },
            { taskId: 'command-preflight-test', workspacePath }
        ) as Record<string, any>;

        expect(executionResult.error_type).not.toBe('preflight_required');
        expect(executionResult.command).toBe(command);
        expect(typeof executionResult.exit_code).toBe('number');
        expect(executionResult.executed_with_shell).toBe(false);
        expect(typeof executionResult.resolved_executable).toBe('string');
    });

    test('preflight tokens are single-use across tasks and cannot unlock a fresh task', async () => {
        expect(commandPreflightTool).toBeTruthy();
        expect(runCommandTool).toBeTruthy();
        if (!commandPreflightTool || !runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const command = getProtectedCommand(workspacePath);

        const preflightResult = await commandPreflightTool.handler(
            { command },
            { taskId: 'command-preflight-single-use-test', workspacePath }
        ) as Record<string, any>;

        const token = preflightResult.preflightToken;
        expect(typeof token).toBe('string');

        const firstExecution = await runCommandTool.handler(
            {
                command,
                preflight_token: token,
            },
            { taskId: 'command-preflight-single-use-test', workspacePath }
        ) as Record<string, any>;

        expect(firstExecution.error_type).not.toBe('preflight_required');

        const replayExecution = await runCommandTool.handler(
            {
                command,
                preflight_token: token,
            },
            { taskId: 'command-preflight-single-use-test-replay', workspacePath }
        ) as Record<string, any>;

        expect(replayExecution.error_type).toBe('preflight_required');
        expect(replayExecution.suggested_tool).toBe('command_preflight');
    });

    test('same reviewed command can run again in the same task without a fresh token', async () => {
        expect(commandPreflightTool).toBeTruthy();
        expect(runCommandTool).toBeTruthy();
        if (!commandPreflightTool || !runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const command = getProtectedCommand(workspacePath);
        const taskId = 'command-preflight-same-task-repeat';

        const preflightResult = await commandPreflightTool.handler(
            { command },
            { taskId, workspacePath }
        ) as Record<string, any>;

        const firstExecution = await runCommandTool.handler(
            {
                command,
                preflight_token: preflightResult.preflightToken,
            },
            { taskId, workspacePath }
        ) as Record<string, any>;

        expect(firstExecution.error_type).not.toBe('preflight_required');

        const secondExecution = await runCommandTool.handler(
            {
                command,
            },
            { taskId, workspacePath }
        ) as Record<string, any>;

        expect(secondExecution.error_type).not.toBe('preflight_required');
        expect(secondExecution.command).toBe(command);
    });

    test('repeated command_preflight for the same task reuses the active review instead of starting over', async () => {
        expect(commandPreflightTool).toBeTruthy();
        if (!commandPreflightTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const command = getProtectedCommand(workspacePath);
        const taskId = 'command-preflight-repeat-test';

        const firstPreflight = await commandPreflightTool.handler(
            { command },
            { taskId, workspacePath }
        ) as Record<string, any>;

        const secondPreflight = await commandPreflightTool.handler(
            { command },
            { taskId, workspacePath }
        ) as Record<string, any>;

        expect(typeof firstPreflight.preflightToken).toBe('string');
        expect(secondPreflight.preflightToken).toBe(firstPreflight.preflightToken);
        expect(secondPreflight.alreadyPreflightedInTask).toBe(true);
        expect(secondPreflight.nextStep).toContain('Do not call command_preflight again');
    });

    test('protected commands cannot use shell control operators even after preflight', async () => {
        expect(commandPreflightTool).toBeTruthy();
        expect(runCommandTool).toBeTruthy();
        if (!commandPreflightTool || !runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const baseCommand = getProtectedCommand(workspacePath);
        const compoundCommand = process.platform === 'win32'
            ? `${baseCommand} && echo done`
            : `${baseCommand} && echo done`;

        const preflightResult = await commandPreflightTool.handler(
            { command: compoundCommand },
            { taskId: 'command-preflight-compound-test', workspacePath }
        ) as Record<string, any>;

        expect(typeof preflightResult.preflightToken).toBe('string');

        const executionResult = await runCommandTool.handler(
            {
                command: compoundCommand,
                preflight_token: preflightResult.preflightToken,
            },
            { taskId: 'command-preflight-compound-test', workspacePath }
        ) as Record<string, any>;

        expect(executionResult.error_type).toBe('unsafe_shell_compound');
    });

    test('shell wrapper inline commands require preflight', async () => {
        expect(runCommandTool).toBeTruthy();
        if (!runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const command = process.platform === 'win32'
            ? 'powershell -NoProfile -Command "Get-Process | Select-Object -First 1"'
            : 'bash -lc "ls"';

        const result = await runCommandTool.handler(
            { command },
            { taskId: 'command-wrapper-test', workspacePath }
        ) as Record<string, any>;

        expect(result.error_type).toBe('preflight_required');
    });

    test('run_command stops when host policy denies execution', async () => {
        expect(commandPreflightTool).toBeTruthy();
        expect(runCommandTool).toBeTruthy();
        if (!commandPreflightTool || !runCommandTool) return;

        const workspacePath = makeWorkspacePath();
        lastWorkspacePath = workspacePath;
        const command = getProtectedCommand(workspacePath);

        const preflightResult = await commandPreflightTool.handler(
            { command },
            { taskId: 'command-policy-deny-test', workspacePath }
        ) as Record<string, any>;

        setCommandApprovalRequester(async (request) => ({
            requestId: request.id,
            timestamp: new Date().toISOString(),
            approved: false,
            denialReason: 'denied by test policy',
            denialCode: 'policy_blocked',
        }));

        const result = await runCommandTool.handler(
            {
                command,
                preflight_token: preflightResult.preflightToken,
            },
            { taskId: 'command-policy-deny-test', workspacePath }
        ) as Record<string, any>;

        expect(result.error_type).toBe('effect_denied');
        expect(result.error).toBe('denied by test policy');
        expect(result.denial_code).toBe('policy_blocked');
    });
});
