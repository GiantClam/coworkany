import { describe, expect, test } from 'bun:test';
import { createRuntimeCommandDispatcher } from '../src/ipc/runtimeCommandDispatcher';
import type { IpcCommand } from '../src/protocol';

function createCommand(commandId: string, taskId: string): IpcCommand {
    return {
        id: commandId,
        timestamp: new Date().toISOString(),
        type: 'start_task',
        payload: {
            taskId,
            title: `task-${taskId}`,
            userQuery: `run-${commandId}`,
            context: {},
        },
    } as IpcCommand;
}

describe('IPC runtime command dispatcher', () => {
    test('serializes long runtime commands within the same task', async () => {
        const order: string[] = [];
        const release: Array<() => void> = [];
        const done: Array<Promise<void>> = [];

        const dispatcher = createRuntimeCommandDispatcher({
            runRuntimeCommand: async (command) => {
                order.push(`start:${command.id}`);
                await new Promise<void>((resolve) => {
                    release.push(resolve);
                });
                order.push(`end:${command.id}`);
                return true;
            },
            onRuntimeCommandError: () => {},
        });

        const cmd1 = createCommand('cmd-1', 'task-a');
        const cmd2 = createCommand('cmd-2', 'task-a');

        done.push(new Promise<void>((resolve) => {
            dispatcher.dispatchLongRuntimeCommandInBackground(cmd1);
            setTimeout(resolve, 0);
        }));
        dispatcher.dispatchLongRuntimeCommandInBackground(cmd2);

        await Promise.all(done);
        expect(order).toEqual(['start:cmd-1']);

        const first = release.shift();
        first?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(order).toEqual(['start:cmd-1', 'end:cmd-1', 'start:cmd-2']);

        const second = release.shift();
        second?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(order).toEqual(['start:cmd-1', 'end:cmd-1', 'start:cmd-2', 'end:cmd-2']);
    });

    test('allows long runtime commands from different tasks to run concurrently', async () => {
        const starts: string[] = [];
        const releases = new Map<string, () => void>();
        const completions: string[] = [];

        const dispatcher = createRuntimeCommandDispatcher({
            runRuntimeCommand: async (command) => {
                starts.push(String(command.id));
                await new Promise<void>((resolve) => {
                    releases.set(String(command.id), resolve);
                });
                completions.push(String(command.id));
                return true;
            },
            onRuntimeCommandError: () => {},
        });

        dispatcher.dispatchLongRuntimeCommandInBackground(createCommand('cmd-a1', 'task-a'));
        dispatcher.dispatchLongRuntimeCommandInBackground(createCommand('cmd-b1', 'task-b'));

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(starts.sort()).toEqual(['cmd-a1', 'cmd-b1']);

        releases.get('cmd-a1')?.();
        releases.get('cmd-b1')?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(completions.sort()).toEqual(['cmd-a1', 'cmd-b1']);
    });

    test('continues queue after previous command failure and reports runtime error', async () => {
        const runtimeErrors: string[] = [];
        const runOrder: string[] = [];
        let shouldFail = true;

        const dispatcher = createRuntimeCommandDispatcher({
            runRuntimeCommand: async (command) => {
                runOrder.push(String(command.id));
                if (shouldFail) {
                    shouldFail = false;
                    throw new Error('simulated_failure');
                }
                return true;
            },
            onRuntimeCommandError: (_command, error) => {
                runtimeErrors.push(error instanceof Error ? error.message : String(error));
            },
        });

        dispatcher.dispatchLongRuntimeCommandInBackground(createCommand('cmd-fail', 'task-a'));
        dispatcher.dispatchLongRuntimeCommandInBackground(createCommand('cmd-next', 'task-a'));

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(runOrder).toEqual(['cmd-fail', 'cmd-next']);
        expect(runtimeErrors).toContain('simulated_failure');
    });

    test('handles long runtime command without task id directly', async () => {
        const runIds: string[] = [];
        const runtimeErrors: string[] = [];
        const command = {
            id: 'cmd-no-task',
            timestamp: new Date().toISOString(),
            type: 'start_task',
            payload: {},
        } as IpcCommand;

        const dispatcher = createRuntimeCommandDispatcher({
            runRuntimeCommand: async (cmd) => {
                runIds.push(String(cmd.id));
                throw new Error('direct_failure');
            },
            onRuntimeCommandError: (_command, error) => {
                runtimeErrors.push(error instanceof Error ? error.message : String(error));
            },
        });

        dispatcher.dispatchLongRuntimeCommandInBackground(command);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(runIds).toEqual(['cmd-no-task']);
        expect(runtimeErrors).toContain('direct_failure');
    });
});
