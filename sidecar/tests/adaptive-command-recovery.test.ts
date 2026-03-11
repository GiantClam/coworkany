import { describe, expect, test } from 'bun:test';
import { AdaptiveExecutor, type ExecutionStep } from '../src/agent/adaptiveExecutor';

describe('adaptive command recovery', () => {
    test('run_command auto-retries with the returned preflight token', async () => {
        const executor = new AdaptiveExecutor({
            maxRetries: 2,
            retryDelay: 0,
            enableAlternativeStrategies: true,
        });

        const step: ExecutionStep = {
            id: 'run-command-preflight-recovery',
            description: 'Execute protected command',
            toolName: 'run_command',
            args: { command: 'schtasks /query' },
        };

        let attempts = 0;

        const result = await executor.executeWithRetry(step, async (_toolName, args) => {
            attempts += 1;

            if (attempts === 1) {
                return JSON.stringify({
                    error: 'preflight_required',
                    error_type: 'preflight_required',
                    preflight: {
                        preflightToken: 'preflight_token_from_tool',
                    },
                });
            }

            expect(args.preflight_token).toBe('preflight_token_from_tool');

            return JSON.stringify({
                command: 'schtasks /query',
                exit_code: 0,
                stdout: 'TaskName  Next Run Time',
                stderr: '',
                executed_with_shell: false,
            });
        });

        expect(result.success).toBe(true);
        expect(attempts).toBe(2);
    });
});
