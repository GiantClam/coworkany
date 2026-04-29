import { describe, expect, test } from 'bun:test';
import { COWORKANY_BUILTIN_TOOL_DEFINITIONS } from '../src/tools/builtinTools';

describe('run_command cancellation', () => {
    test('automatically retries command-not-found once with a safe alternative', async () => {
        const runCommand = COWORKANY_BUILTIN_TOOL_DEFINITIONS.find((tool) => tool.name === 'run_command');
        if (!runCommand) {
            throw new Error('run_command tool not found');
        }

        const result = await runCommand.handler(
            {
                command: `python99 -c "print('auto-retry-ok')"`,
                timeout_ms: 5000,
            },
            {
                workspacePath: process.cwd(),
                taskId: 'task-command-auto-retry',
            }
        ) as Record<string, unknown>;

        expect(result.retry_attempted).toBe(true);
        expect(typeof result.retry_command).toBe('string');
        expect((result.retry_command as string).startsWith('python3 ')).toBe(true);
        expect(result.resolved_by_retry).toBe(true);
        expect(result.exit_code).toBe(0);

        const attempts = Array.isArray(result.attempts) ? result.attempts : [];
        expect(attempts.length).toBe(2);
    });

    test('returns directly executable fallback commands for command-not-found errors', async () => {
        const runCommand = COWORKANY_BUILTIN_TOOL_DEFINITIONS.find((tool) => tool.name === 'run_command');
        if (!runCommand) {
            throw new Error('run_command tool not found');
        }

        const result = await runCommand.handler(
            {
                command: 'python ./.coworkany/test-workspace/s2-calculator.py',
                timeout_ms: 5000,
            },
            {
                workspacePath: process.cwd(),
                taskId: 'task-command-recovery-shape',
            }
        ) as Record<string, unknown>;

        if (result.exit_code === 0) {
            // Environment already provides `python`; recovery hints are unnecessary in this case.
            return;
        }

        expect(result.error_type).toBe('not_found');
        const alternatives = Array.isArray(result.alternative_commands)
            ? result.alternative_commands as string[]
            : [];
        expect(alternatives.some((candidate) => candidate.startsWith('python3 '))).toBe(true);
    });

    test('does not short-circuit sudo commands into opened_in_terminal guidance', async () => {
        const runCommand = COWORKANY_BUILTIN_TOOL_DEFINITIONS.find((tool) => tool.name === 'run_command');
        if (!runCommand) {
            throw new Error('run_command tool not found');
        }

        const result = await runCommand.handler(
            {
                command: 'sudo shutdown -h +1',
                timeout_ms: 5000,
            },
            {
                workspacePath: process.cwd(),
                taskId: 'task-command-sudo-non-interactive',
            }
        ) as Record<string, unknown>;

        expect(result.status).not.toBe('opened_in_terminal');
        expect(typeof result.exit_code).toBe('number');
    });

    test('kills the running command when task cancellation is requested', async () => {
        const runCommand = COWORKANY_BUILTIN_TOOL_DEFINITIONS.find((tool) => tool.name === 'run_command');
        if (!runCommand) {
            throw new Error('run_command tool not found');
        }

        let cancellationHandler: ((reason: string) => void) | undefined;
        const command = `${JSON.stringify(process.execPath)} -e "setInterval(function(){}, 1000)"`;

        const pending = runCommand.handler(
            {
                command,
                timeout_ms: 15000,
            },
            {
                workspacePath: process.cwd(),
                taskId: 'task-cancel-run-command',
                onCancel: (waiter) => {
                    cancellationHandler = waiter;
                    return () => {
                        if (cancellationHandler === waiter) {
                            cancellationHandler = undefined;
                        }
                    };
                },
            }
        );

        await new Promise((resolve) => setTimeout(resolve, 250));
        cancellationHandler?.('Task cancelled by user');

        const result = await pending as Record<string, unknown>;

        expect(result.cancelled).toBe(true);
        expect(result.error_type).toBe('cancelled');
        expect(result.exit_code).toBe(-1);
    });
});
