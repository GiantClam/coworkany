import { describe, expect, test } from 'bun:test';
import type { Agent } from '@mastra/core/agent';
import { executeFrozenTask } from '../src/mastra/workflows/steps/execute-task';

describe('execute-task workflow step', () => {
    test('uses task-scoped resource id instead of shared org resource', async () => {
        const calls: Array<{ thread: string; resource: string }> = [];
        const coworker = {
            generate: async (_query: string, options: { memory?: { thread?: string; resource?: string } }) => {
                calls.push({
                    thread: options.memory?.thread ?? '',
                    resource: options.memory?.resource ?? '',
                });
                return {
                    text: 'ok',
                    finishReason: 'stop',
                };
            },
        } as unknown as Agent;

        await executeFrozenTask({
            coworker,
            task: {
                frozen: { id: 'frozen-task-a' } as any,
                executionPlan: { steps: [] } as any,
                executionQuery: 'first',
            },
            workspacePath: '/tmp/ws',
        });

        await executeFrozenTask({
            coworker,
            task: {
                frozen: { id: 'frozen-task-b' } as any,
                executionPlan: { steps: [] } as any,
                executionQuery: 'second',
            },
            workspacePath: '/tmp/ws',
        });

        expect(calls).toHaveLength(2);
        expect(calls[0]?.resource).toBe('employee-frozen-task-a');
        expect(calls[1]?.resource).toBe('employee-frozen-task-b');
        expect(calls[0]?.resource).not.toBe(calls[1]?.resource);
        expect(calls[0]?.thread).toBe('control-plane-frozen-task-a');
        expect(calls[1]?.thread).toBe('control-plane-frozen-task-b');
    });
});
