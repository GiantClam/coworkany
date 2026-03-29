import type { IpcCommand } from '../protocol';
import type { CommandDispatchResult } from '../handlers';
import type { RuntimeCommandDispatcher } from './runtimeCommandDispatcher';

export type CommandExecutorDeps = {
    dispatchCommand: (command: IpcCommand) => CommandDispatchResult;
    emitDispatchResult: (result: NonNullable<CommandDispatchResult>) => void;
    handleCapabilityCommand: (command: IpcCommand) => Promise<Record<string, unknown> | null | undefined>;
    handleWorkspaceCommand: (command: IpcCommand) => Promise<Record<string, unknown> | null | undefined>;
    emitAny: (message: Record<string, unknown>) => void;
    runtimeCommandDispatcher: RuntimeCommandDispatcher;
    handleRuntimeCommand: (command: IpcCommand) => Promise<boolean>;
    onUnhandledCommand: (command: IpcCommand) => void;
    onCommandError: (command: IpcCommand, error: unknown) => void;
};

export function createCommandExecutor(deps: CommandExecutorDeps) {
    return async function handleCommand(command: IpcCommand): Promise<void> {
        try {
            const result = deps.dispatchCommand(command);
            if (result) {
                deps.emitDispatchResult(result);
                return;
            }

            const capabilityResponse = await deps.handleCapabilityCommand(command);
            if (capabilityResponse) {
                deps.emitAny(capabilityResponse);
                return;
            }

            const workspaceResponse = await deps.handleWorkspaceCommand(command);
            if (workspaceResponse) {
                deps.emitAny(workspaceResponse);
                return;
            }

            if (deps.runtimeCommandDispatcher.isLongRuntimeCommand(command)) {
                deps.runtimeCommandDispatcher.dispatchLongRuntimeCommandInBackground(command);
                return;
            }

            if (await deps.handleRuntimeCommand(command)) {
                return;
            }

            deps.onUnhandledCommand(command);
        } catch (error) {
            deps.onCommandError(command, error);
        }
    };
}
