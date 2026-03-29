import type { IpcResponse, TaskEvent } from '../protocol';

type OutputMessage = IpcResponse | TaskEvent;

interface IpcOutputEmitterOptions {
    writeStdoutLine: (line: string) => void;
    broadcastLine?: (line: string) => void;
    toCanonicalEvents: (event: TaskEvent) => Record<string, unknown>[];
    onTaskEvent?: (event: TaskEvent) => void;
}

export interface IpcOutputEmitter {
    emitRawIpcResponse: (message: Record<string, unknown>) => void;
    emitAny: (message: Record<string, unknown>) => void;
    emit: (message: OutputMessage) => void;
}

function isTaskEvent(message: OutputMessage): message is TaskEvent {
    return (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        'taskId' in message
    );
}

export function createIpcOutputEmitter(options: IpcOutputEmitterOptions): IpcOutputEmitter {
    const writeLine = (line: string): void => {
        options.writeStdoutLine(line);
        options.broadcastLine?.(line);
    };

    const emitRawIpcResponse = (message: Record<string, unknown>): void => {
        writeLine(JSON.stringify(message) + '\n');
    };

    const emitAny = (message: Record<string, unknown>): void => {
        writeLine(JSON.stringify(message) + '\n');
    };

    const emit = (message: OutputMessage): void => {
        writeLine(JSON.stringify(message) + '\n');

        if (!isTaskEvent(message)) {
            return;
        }

        const canonicalEvents = options.toCanonicalEvents(message);
        for (const canonicalEvent of canonicalEvents) {
            writeLine(JSON.stringify(canonicalEvent) + '\n');
        }

        options.onTaskEvent?.(message);
    };

    return {
        emitRawIpcResponse,
        emitAny,
        emit,
    };
}
