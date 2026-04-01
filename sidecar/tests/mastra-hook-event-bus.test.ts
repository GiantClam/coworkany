import { afterEach, describe, expect, test } from 'bun:test';
import {
    clearHookRuntimeEvents,
    registerHookRuntimeEventHandler,
    setHookRuntimeEventsEnabled,
    type HookRuntimeEvent,
    type HookRuntime,
    MastraHookRuntimeStore,
} from '../src/mastra/hookRuntime';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const tempDirs: string[] = [];

afterEach(() => {
    clearHookRuntimeEvents();
    for (const dir of tempDirs.splice(0, tempDirs.length)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

function createRuntime(): HookRuntime {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coworkany-hook-bus-'));
    tempDirs.push(dir);
    return new MastraHookRuntimeStore(path.join(dir, 'mastra-hook-events.json'));
}

function emit(runtime: HookRuntime, event: Omit<HookRuntimeEvent, 'id' | 'at'>): void {
    runtime.emit(event);
}

describe('mastra hook event bus', () => {
    test('buffers events before handler registration and flushes on registration', () => {
        const runtime = createRuntime();
        setHookRuntimeEventsEnabled(true);
        const received: HookRuntimeEvent[] = [];

        emit(runtime, {
            type: 'TaskCompleted',
            taskId: 'task-1',
            payload: { ok: true },
        });
        registerHookRuntimeEventHandler((event) => {
            received.push(event as HookRuntimeEvent);
        });

        expect(received).toHaveLength(1);
        expect(received[0]?.type).toBe('TaskCompleted');
        expect(received[0]?.taskId).toBe('task-1');
    });

    test('always-emitted events are dispatched even when full hook stream disabled', () => {
        const runtime = createRuntime();
        setHookRuntimeEventsEnabled(false);
        const received: HookRuntimeEvent[] = [];
        registerHookRuntimeEventHandler((event) => {
            received.push(event as HookRuntimeEvent);
        });

        emit(runtime, { type: 'SessionStart', taskId: 'task-2' });
        emit(runtime, { type: 'TaskCreated', taskId: 'task-2' });
        emit(runtime, { type: 'TaskCompleted', taskId: 'task-2' });

        expect(received.map((event) => event.type)).toEqual(['SessionStart', 'TaskCreated']);
    });
});
