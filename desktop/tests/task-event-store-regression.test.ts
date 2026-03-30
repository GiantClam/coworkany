import { beforeEach, describe, expect, test } from 'bun:test';
import { useTaskEventStore, type TaskEvent } from '../src/stores/useTaskEventStore';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';

function buildEvent(input: {
    taskId: string;
    type: TaskEvent['type'];
    payload: Record<string, unknown>;
    id?: string;
    sequence?: number;
    timestamp?: string;
}): TaskEvent {
    return {
        taskId: input.taskId,
        type: input.type,
        payload: input.payload,
        id: input.id ?? '',
        sequence: input.sequence ?? 0,
        timestamp: input.timestamp ?? '',
    };
}

describe('task event store regression', () => {
    beforeEach(() => {
        useTaskEventStore.getState().reset();
    });

    test('auto-fills missing id/timestamp/sequence so sidecar task events are not dropped', () => {
        const taskId = 'task-sidecar-regression';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TASK_STARTED',
                payload: { title: '早上3点关机' },
            }),
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                payload: { delta: '已安排在 03/31 03:00:00 执行：早上3点关机。', role: 'assistant' },
            }),
            buildEvent({
                taskId,
                type: 'TASK_FINISHED',
                payload: { summary: '已安排', finishReason: 'scheduled' },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        expect(session).toBeDefined();
        expect(session?.events.length).toBe(3);

        const [started, delta, finished] = session?.events ?? [];
        for (const event of [started, delta, finished]) {
            expect(typeof event.id).toBe('string');
            expect(event.id.length).toBeGreaterThan(0);
            expect(typeof event.timestamp).toBe('string');
            expect(event.timestamp.length).toBeGreaterThan(0);
            expect(event.sequence).toBeGreaterThan(0);
        }
    });

    test('promoting a draft preserves already-arrived scheduled terminal events on the real task id', () => {
        const draftTaskId = 'draft-task-1';
        const realTaskId = 'task-real-1';
        const state = useTaskEventStore.getState();

        state.ensureSession(draftTaskId, {
            title: '早上3点关机',
            workspacePath: '/tmp/workspace',
            status: 'idle',
            isDraft: true,
        }, true);

        state.addEvents([
            buildEvent({
                taskId: realTaskId,
                type: 'TASK_STARTED',
                payload: {
                    title: '早上3点关机',
                    context: {
                        displayText: '早上3点关机',
                        userQuery: '原始任务：早上3点关机\n用户路由：chat',
                    },
                },
                id: 'task-started-real',
                sequence: 1,
                timestamp: '2026-03-30T03:00:00.000Z',
            }),
            buildEvent({
                taskId: realTaskId,
                type: 'TASK_FINISHED',
                payload: {
                    summary: '已安排在 03/31 03:00:00 执行：早上3点关机。',
                    finishReason: 'scheduled',
                },
                id: 'task-finished-real',
                sequence: 2,
                timestamp: '2026-03-30T03:00:00.100Z',
            }),
        ]);

        state.promoteDraftSession(draftTaskId, realTaskId, {
            title: '早上3点关机',
            workspacePath: '/tmp/workspace',
            status: 'running',
        });

        const session = useTaskEventStore.getState().getSession(realTaskId);
        expect(session).toBeDefined();
        expect(session?.status).toBe('finished');
        expect(session?.summary).toContain('03/31 03:00:00');
        expect(session?.events.some((event) => event.id === 'task-started-real')).toBe(true);
        expect(session?.events.some((event) => event.id === 'task-finished-real')).toBe(true);
    });

    test('ensureSession does not downgrade finished sessions back to running', () => {
        const taskId = 'task-finished-1';
        const state = useTaskEventStore.getState();

        state.ensureSession(taskId, {
            title: 'scheduled shutdown',
            status: 'finished',
            summary: '已安排在 03/31 03:00:00 执行：早上3点关机。',
        }, true);

        state.ensureSession(taskId, {
            title: 'scheduled shutdown',
            status: 'running',
        }, true);

        const session = useTaskEventStore.getState().getSession(taskId);
        expect(session?.status).toBe('finished');
        expect(session?.summary).toContain('03/31 03:00:00');
    });

    test('scheduled finish infers scheduled mode and renders confirmation from TASK_STARTED/TASK_FINISHED chain', () => {
        const taskId = 'task-scheduled-regression';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TASK_STARTED',
                id: 'started',
                sequence: 1,
                payload: {
                    title: '早上3点关机',
                    context: {
                        userQuery: '原始任务：早上3点关机\n用户路由：chat',
                        scheduled: true,
                    },
                },
            }),
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta',
                sequence: 2,
                payload: {
                    role: 'assistant',
                    delta: '已安排在 03/31 03:00:00 执行：早上3点关机。',
                },
            }),
            buildEvent({
                taskId,
                type: 'TASK_FINISHED',
                id: 'finished',
                sequence: 3,
                payload: {
                    summary: '已安排在 03/31 03:00:00 执行：早上3点关机。',
                    finishReason: 'scheduled',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        expect(session).toBeDefined();
        expect(session?.taskMode).toBe('scheduled_task');
        expect(session?.messages.some((message) => message.role === 'user' && String(message.content).includes('原始任务：'))).toBe(false);
        expect(session?.messages.some((message) => message.role === 'user' && String(message.content).includes('早上3点关机'))).toBe(true);

        const timeline = buildTimelineItems(session!);
        const assistantTurns = timeline.items.filter((item) => item.type === 'assistant_turn');
        const hasScheduledSummary = assistantTurns.some((turn) => {
            const taskCardSummary = turn.taskCard?.result?.summary ?? '';
            const turnMessages = turn.messages.join('\n');
            return taskCardSummary.includes('03/31 03:00:00') || turnMessages.includes('03/31 03:00:00');
        });
        expect(hasScheduledSummary).toBe(true);
    });
});
