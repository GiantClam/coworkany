import { describe, expect, test } from 'bun:test';
import { executeJavaScriptTool } from '../src/tools/codeExecution';

describe('execute_javascript cancellation', () => {
    test('stops the running script when task cancellation is requested', async () => {
        let cancellationHandler: ((reason: string) => void) | undefined;

        const pending = executeJavaScriptTool.handler(
            {
                code: 'setInterval(function(){}, 1000);',
                timeout_ms: 15000,
            },
            {
                workspacePath: process.cwd(),
                taskId: 'task-cancel-js-exec',
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

        const result = await pending;

        expect(result).toContain('Execution failed');
        expect(result).toContain('Task cancelled by user');
    });
});
