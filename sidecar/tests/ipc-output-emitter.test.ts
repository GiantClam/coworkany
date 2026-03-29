import { describe, expect, test } from 'bun:test';
import type { IpcResponse, TaskEvent } from '../src/protocol';
import { createIpcOutputEmitter } from '../src/ipc/outputEmitter';

describe('ipc output emitter', () => {
    test('emitRawIpcResponse writes to stdout and broadcast', () => {
        const stdoutLines: string[] = [];
        const broadcastLines: string[] = [];
        const emitter = createIpcOutputEmitter({
            writeStdoutLine: (line) => {
                stdoutLines.push(line);
            },
            broadcastLine: (line) => {
                broadcastLines.push(line);
            },
            toCanonicalEvents: () => [],
        });

        emitter.emitRawIpcResponse({
            type: 'ping_response',
            commandId: 'cmd-1',
            payload: { ok: true },
        });

        expect(stdoutLines.length).toBe(1);
        expect(stdoutLines[0]).toContain('"type":"ping_response"');
        expect(stdoutLines[0].endsWith('\n')).toBe(true);
        expect(broadcastLines).toEqual(stdoutLines);
    });

    test('emit forwards task events and emits canonical events', () => {
        const stdoutLines: string[] = [];
        const seenTaskEvents: TaskEvent[] = [];
        const emitter = createIpcOutputEmitter({
            writeStdoutLine: (line) => {
                stdoutLines.push(line);
            },
            toCanonicalEvents: (event) => [
                { type: 'canonical_event', taskId: event.taskId, timestamp: '2026-03-29T00:00:00.000Z' },
            ],
            onTaskEvent: (event) => {
                seenTaskEvents.push(event);
            },
        });

        const event = {
            type: 'TASK_STARTED',
            taskId: 'task-1',
            timestamp: new Date().toISOString(),
            payload: {},
        } as TaskEvent;

        emitter.emit(event);

        expect(stdoutLines.length).toBe(2);
        expect(stdoutLines[0]).toContain('"type":"TASK_STARTED"');
        expect(stdoutLines[1]).toContain('"type":"canonical_event"');
        expect(seenTaskEvents).toEqual([event]);
    });

    test('emit does not call onTaskEvent for plain response', () => {
        let taskEventCalls = 0;
        const emitter = createIpcOutputEmitter({
            writeStdoutLine: () => {},
            toCanonicalEvents: () => [],
            onTaskEvent: () => {
                taskEventCalls += 1;
            },
        });

        emitter.emit({
            type: 'start_task_response',
            commandId: 'cmd-2',
            timestamp: new Date().toISOString(),
            payload: { success: true },
        } as IpcResponse);

        expect(taskEventCalls).toBe(0);
    });
});
