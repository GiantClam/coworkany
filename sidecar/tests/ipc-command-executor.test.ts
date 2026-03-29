import { describe, expect, test } from 'bun:test';
import { createCommandExecutor } from '../src/ipc/commandExecutor';
import type { IpcCommand } from '../src/protocol';

function makeCommand(type: string): IpcCommand {
    return {
        id: `cmd-${type}`,
        timestamp: new Date().toISOString(),
        type,
        payload: {},
    } as IpcCommand;
}

describe('IPC command executor', () => {
    test('emits router dispatch result and short-circuits', async () => {
        const emitted: Array<Record<string, unknown>> = [];
        const executor = createCommandExecutor({
            dispatchCommand: () => ({
                response: { type: 'ok_response' } as any,
                events: [{ type: 'EVENT_A' } as any],
            }),
            emitDispatchResult: (result) => {
                if (result.response) emitted.push(result.response as any);
                for (const event of result.events ?? []) emitted.push(event as any);
            },
            handleCapabilityCommand: async () => null,
            handleWorkspaceCommand: async () => null,
            emitAny: (message) => emitted.push(message),
            runtimeCommandDispatcher: {
                isLongRuntimeCommand: () => false,
                dispatchLongRuntimeCommandInBackground: () => {},
            },
            handleRuntimeCommand: async () => false,
            onUnhandledCommand: () => {},
            onCommandError: () => {},
        });

        await executor(makeCommand('register_agent_identity'));
        expect(emitted.some((item) => item.type === 'ok_response')).toBe(true);
        expect(emitted.some((item) => item.type === 'EVENT_A')).toBe(true);
    });

    test('dispatches long runtime commands to background dispatcher', async () => {
        const dispatched: string[] = [];
        const executor = createCommandExecutor({
            dispatchCommand: () => null,
            emitDispatchResult: () => {},
            handleCapabilityCommand: async () => null,
            handleWorkspaceCommand: async () => null,
            emitAny: () => {},
            runtimeCommandDispatcher: {
                isLongRuntimeCommand: (command) => command.type === 'start_task',
                dispatchLongRuntimeCommandInBackground: (command) => {
                    dispatched.push(command.type);
                },
            },
            handleRuntimeCommand: async () => false,
            onUnhandledCommand: () => {},
            onCommandError: () => {},
        });

        await executor(makeCommand('start_task'));
        expect(dispatched).toEqual(['start_task']);
    });

    test('falls back to runtime command handler for non-long commands', async () => {
        const runtimeHandled: string[] = [];
        const executor = createCommandExecutor({
            dispatchCommand: () => null,
            emitDispatchResult: () => {},
            handleCapabilityCommand: async () => null,
            handleWorkspaceCommand: async () => null,
            emitAny: () => {},
            runtimeCommandDispatcher: {
                isLongRuntimeCommand: () => false,
                dispatchLongRuntimeCommandInBackground: () => {},
            },
            handleRuntimeCommand: async (command) => {
                runtimeHandled.push(command.type);
                return true;
            },
            onUnhandledCommand: () => {},
            onCommandError: () => {},
        });

        await executor(makeCommand('get_runtime_snapshot'));
        expect(runtimeHandled).toEqual(['get_runtime_snapshot']);
    });

    test('calls onUnhandledCommand when nothing handles the command', async () => {
        const unhandled: string[] = [];
        const executor = createCommandExecutor({
            dispatchCommand: () => null,
            emitDispatchResult: () => {},
            handleCapabilityCommand: async () => null,
            handleWorkspaceCommand: async () => null,
            emitAny: () => {},
            runtimeCommandDispatcher: {
                isLongRuntimeCommand: () => false,
                dispatchLongRuntimeCommandInBackground: () => {},
            },
            handleRuntimeCommand: async () => false,
            onUnhandledCommand: (command) => unhandled.push(command.type),
            onCommandError: () => {},
        });

        await executor(makeCommand('unknown_command'));
        expect(unhandled).toEqual(['unknown_command']);
    });

    test('routes exceptions to onCommandError', async () => {
        const errors: string[] = [];
        const executor = createCommandExecutor({
            dispatchCommand: () => null,
            emitDispatchResult: () => {},
            handleCapabilityCommand: async () => {
                throw new Error('executor_fail');
            },
            handleWorkspaceCommand: async () => null,
            emitAny: () => {},
            runtimeCommandDispatcher: {
                isLongRuntimeCommand: () => false,
                dispatchLongRuntimeCommandInBackground: () => {},
            },
            handleRuntimeCommand: async () => false,
            onUnhandledCommand: () => {},
            onCommandError: (_command, error) => {
                errors.push(error instanceof Error ? error.message : String(error));
            },
        });

        await executor(makeCommand('send_task_message'));
        expect(errors).toEqual(['executor_fail']);
    });
});
