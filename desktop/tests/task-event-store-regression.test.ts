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

    test('assistant deltas from a new turn id create a new assistant bubble instead of merging previous turn', () => {
        const taskId = 'task-turn-separation';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-turn-1',
                sequence: 1,
                payload: {
                    role: 'assistant',
                    delta: '第一轮回复',
                    turnId: 'turn-1',
                    messageId: 'msg-1',
                },
            }),
            buildEvent({
                taskId,
                type: 'TASK_FINISHED',
                id: 'finish-turn-1',
                sequence: 2,
                payload: {
                    summary: 'done',
                    finishReason: 'stop',
                    turnId: 'turn-1',
                },
            }),
            buildEvent({
                taskId,
                type: 'TASK_STATUS',
                id: 'status-turn-2',
                sequence: 3,
                payload: {
                    status: 'running',
                    turnId: 'turn-2',
                },
            }),
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-turn-2',
                sequence: 4,
                payload: {
                    role: 'assistant',
                    delta: '第二轮回复',
                    turnId: 'turn-2',
                    messageId: 'msg-2',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        const assistantMessages = (session?.messages ?? []).filter((message) => message.role === 'assistant');
        expect(assistantMessages.length).toBe(2);
        expect(assistantMessages[0]?.content).toBe('第一轮回复');
        expect(assistantMessages[1]?.content).toBe('第二轮回复');
    });

    test('duplicate assistant CHAT_MESSAGE in same turn is suppressed after streamed delta', () => {
        const taskId = 'task-assistant-dedup';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-1',
                sequence: 1,
                payload: {
                    role: 'assistant',
                    delta: '当然可以',
                    turnId: 'turn-1',
                    messageId: 'stream-msg',
                },
            }),
            buildEvent({
                taskId,
                type: 'CHAT_MESSAGE',
                id: 'assistant-final-duplicate',
                sequence: 2,
                payload: {
                    role: 'assistant',
                    content: '当然可以',
                    turnId: 'turn-1',
                    messageId: 'stream-msg',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        const assistantMessages = (session?.messages ?? []).filter((message) => message.role === 'assistant');
        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0]?.content).toBe('当然可以');
    });

    test('overlapping assistant deltas in the same turn are merged without duplicated prefix text', () => {
        const taskId = 'task-assistant-overlap-dedup';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-overlap-1',
                sequence: 1,
                payload: {
                    role: 'assistant',
                    delta: '当然可以，我先给你一版',
                    turnId: 'turn-overlap-1',
                    messageId: 'stream-1',
                },
            }),
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-overlap-2',
                sequence: 2,
                payload: {
                    role: 'assistant',
                    delta: '当然可以，我先给你一版“更像本人表达”的简洁日报',
                    turnId: 'turn-overlap-1',
                    messageId: 'stream-2',
                },
            }),
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-overlap-3',
                sequence: 3,
                payload: {
                    role: 'assistant',
                    delta: '。',
                    turnId: 'turn-overlap-1',
                    messageId: 'stream-2',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        const assistantMessages = (session?.messages ?? []).filter((message) => message.role === 'assistant');
        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0]?.content).toBe('当然可以，我先给你一版“更像本人表达”的简洁日报。');
    });

    test('duplicate TASK_FAILED events in same turn keep a single assistant failure message', () => {
        const taskId = 'task-failure-dedup-by-turn';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TASK_FAILED',
                id: 'task-failed-1',
                sequence: 1,
                payload: {
                    turnId: 'turn-failed-1',
                    error: 'stream_idle_timeout:12000',
                    errorCode: 'UPSTREAM_TIMEOUT',
                    recoverable: true,
                    suggestion: '请稍后重试',
                },
            }),
            buildEvent({
                taskId,
                type: 'TASK_FAILED',
                id: 'task-failed-2',
                sequence: 2,
                payload: {
                    turnId: 'turn-failed-1',
                    error: 'stream_idle_timeout:12000',
                    errorCode: 'UPSTREAM_TIMEOUT',
                    recoverable: true,
                    suggestion: '请稍后重试',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        const assistantMessages = (session?.messages ?? []).filter((message) => message.role === 'assistant');
        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0]?.id).toBe('task-failed:turn-failed-1');
        expect(assistantMessages[0]?.content).toContain('Task failed: stream_idle_timeout:12000');
    });

    test('assistant deltas keep a single bubble per turn even when system events are interleaved', () => {
        const taskId = 'task-turn-delta-interleaved-system';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-a',
                sequence: 1,
                payload: {
                    role: 'assistant',
                    delta: '当然可以，我先给你一版',
                    turnId: 'turn-interleaved-1',
                    messageId: 'stream-a',
                },
            }),
            buildEvent({
                taskId,
                type: 'TASK_CHECKPOINT_REACHED',
                id: 'checkpoint-interleaved',
                sequence: 2,
                payload: {
                    checkpointId: 'checkpoint-1',
                    title: 'Checkpoint',
                    kind: 'review',
                    reason: 'Need review',
                    userMessage: 'Please review this step.',
                    blocking: true,
                },
            }),
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-b',
                sequence: 3,
                payload: {
                    role: 'assistant',
                    delta: '当然可以，我先给你一版更像你的简洁日报。',
                    turnId: 'turn-interleaved-1',
                    messageId: 'stream-b',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        const assistantMessages = (session?.messages ?? []).filter((message) => message.role === 'assistant');
        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0]?.turnId).toBe('turn-interleaved-1');
        expect(assistantMessages[0]?.content).toBe('当然可以，我先给你一版更像你的简洁日报。');
    });

    test('assistant stream rewrite does not append duplicated near-identical full reply in same turn', () => {
        const taskId = 'task-stream-rewrite-dedup';
        const state = useTaskEventStore.getState();

        state.addEvents([
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-rewrite-1',
                sequence: 1,
                payload: {
                    role: 'assistant',
                    delta: '当然可以，我先给你一版更像本人表达的简洁日报：今日完成-推进重点事项；进行中-细节收尾；明日计划-继续推进。',
                    turnId: 'turn-rewrite-1',
                    messageId: 'stream-rewrite-1',
                },
            }),
            buildEvent({
                taskId,
                type: 'TEXT_DELTA',
                id: 'delta-rewrite-2',
                sequence: 2,
                payload: {
                    role: 'assistant',
                    delta: '当然可以，我先给你一版“更像本人表达”的简洁日报：\n\n**今日完成**\n- 推进重点事项\n\n**进行中**\n- 细节收尾\n\n**明日计划**\n- 继续推进',
                    turnId: 'turn-rewrite-1',
                    messageId: 'stream-rewrite-2',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        const assistantMessages = (session?.messages ?? []).filter((message) => message.role === 'assistant');
        expect(assistantMessages.length).toBe(1);
        expect(assistantMessages[0]?.turnId).toBe('turn-rewrite-1');
        expect(assistantMessages[0]?.content).toContain('**今日完成**');
        expect(assistantMessages[0]?.content.includes('更像本人表达的简洁日报：今日完成-推进重点事项；进行中-细节收尾')).toBe(false);
    });
});
