import { describe, expect, test } from 'bun:test';
import { TaskEventBus } from '../src/execution/taskEventBus';

describe('task event bus', () => {
    test('increments per-task sequence numbers independently and supports reset', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitChatMessage('task-a', { role: 'user', content: 'hello' });
        bus.emitStatus('task-a', { status: 'running' });
        bus.emitChatMessage('task-b', { role: 'system', content: 'world' });
        bus.reset('task-a');
        bus.emitFinished('task-a', { summary: 'done', duration: 5 });

        expect(events.map((event) => [event.taskId, event.sequence, event.type])).toEqual([
            ['task-a', 1, 'CHAT_MESSAGE'],
            ['task-a', 2, 'TASK_STATUS'],
            ['task-b', 1, 'CHAT_MESSAGE'],
            ['task-a', 1, 'TASK_FINISHED'],
        ]);
    });

    test('emits raw task events with generated ids and timestamps', () => {
        let captured: any = null;
        const bus = new TaskEventBus({
            emit: (event) => {
                captured = event;
            },
        });

        bus.emitRaw('task-x', 'TASK_HISTORY_CLEARED', { reason: 'user_requested' });

        expect(captured.taskId).toBe('task-x');
        expect(captured.sequence).toBe(1);
        expect(captured.type).toBe('TASK_HISTORY_CLEARED');
        expect(captured.payload).toEqual({ reason: 'user_requested' });
        expect(typeof captured.id).toBe('string');
        expect(typeof captured.timestamp).toBe('string');
    });

    test('supports explicit sequence overrides without rewinding future sequence numbers', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitChatMessage('task-a', { role: 'user', content: 'hello' });
        bus.emitTextDelta('task-a', { role: 'assistant', delta: 'forced' }, { sequence: 0 });
        bus.emitStatus('task-a', { status: 'finished' }, { sequence: 0 });
        bus.emitRaw('task-a', 'TASK_HISTORY_CLEARED', { reason: 'higher' }, { sequence: 5 });
        bus.emitFinished('task-a', { summary: 'done', duration: 1 });

        expect(events.map((event) => [event.type, event.sequence])).toEqual([
            ['CHAT_MESSAGE', 1],
            ['TEXT_DELTA', 0],
            ['TASK_STATUS', 0],
            ['TASK_HISTORY_CLEARED', 5],
            ['TASK_FINISHED', 6],
        ]);
    });
});
