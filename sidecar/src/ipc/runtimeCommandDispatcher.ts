import type { IpcCommand } from '../protocol';

const DEFAULT_LONG_RUNTIME_COMMAND_TYPES = new Set<string>([
    'start_task',
    'send_task_message',
    'resume_interrupted_task',
]);

function defaultExtractTaskId(command: IpcCommand): string | undefined {
    const payload = command.payload;
    if (!payload || typeof payload !== 'object') {
        return undefined;
    }
    const taskId = (payload as Record<string, unknown>).taskId;
    return typeof taskId === 'string' && taskId.length > 0 ? taskId : undefined;
}

export type RuntimeCommandDispatcherOptions = {
    runRuntimeCommand: (command: IpcCommand) => Promise<boolean>;
    onUnhandledRuntimeCommand?: (command: IpcCommand) => void;
    onRuntimeCommandError: (command: IpcCommand, error: unknown) => void;
    onTaskQueueError?: (taskId: string, error: unknown) => void;
    extractTaskId?: (command: IpcCommand) => string | undefined;
    isLongRuntimeCommandType?: (type: string) => boolean;
};

export type RuntimeCommandDispatcher = {
    isLongRuntimeCommand: (command: IpcCommand) => boolean;
    dispatchLongRuntimeCommandInBackground: (command: IpcCommand) => void;
};

export function createRuntimeCommandDispatcher(
    options: RuntimeCommandDispatcherOptions,
): RuntimeCommandDispatcher {
    const taskScopedRuntimeCommandQueue = new Map<string, Promise<void>>();
    const extractTaskId = options.extractTaskId ?? defaultExtractTaskId;
    const isLongRuntimeCommandType = options.isLongRuntimeCommandType
        ?? ((type: string) => DEFAULT_LONG_RUNTIME_COMMAND_TYPES.has(type));

    function runCommand(command: IpcCommand): Promise<void> {
        return (async () => {
            const handled = await options.runRuntimeCommand(command);
            if (!handled) {
                options.onUnhandledRuntimeCommand?.(command);
            }
        })();
    }

    return {
        isLongRuntimeCommand: (command: IpcCommand): boolean => {
            return isLongRuntimeCommandType(command.type);
        },
        dispatchLongRuntimeCommandInBackground: (command: IpcCommand): void => {
            const taskId = extractTaskId(command);
            if (!taskId) {
                void runCommand(command).catch((error) => options.onRuntimeCommandError(command, error));
                return;
            }

            const previous = taskScopedRuntimeCommandQueue.get(taskId) ?? Promise.resolve();
            let queued: Promise<void>;
            queued = previous
                .catch((error: unknown) => {
                    options.onTaskQueueError?.(taskId, error);
                })
                .then(() => runCommand(command))
                .catch((error: unknown) => options.onRuntimeCommandError(command, error))
                .finally(() => {
                    if (taskScopedRuntimeCommandQueue.get(taskId) === queued) {
                        taskScopedRuntimeCommandQueue.delete(taskId);
                    }
                });
            taskScopedRuntimeCommandQueue.set(taskId, queued);
        },
    };
}
