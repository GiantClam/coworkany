import { describe, expect, test } from 'bun:test';
import { STANDARD_TOOLS } from '../src/tools/standard';

describe('run_command cancellation', () => {
    test('kills the running command when task cancellation is requested', async () => {
        const runCommand = STANDARD_TOOLS.find((tool) => tool.name === 'run_command');
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
