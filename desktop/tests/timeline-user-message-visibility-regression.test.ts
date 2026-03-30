import { afterEach, describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import { useTaskEventStore } from '../src/stores/taskEvents';
import type { TaskEvent, TaskSession } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-visibility-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_STARTED',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'task-visibility-1',
        status: overrides.status ?? 'idle',
        taskMode: overrides.taskMode,
        planSteps: overrides.planSteps ?? [],
        toolCalls: overrides.toolCalls ?? [],
        effects: overrides.effects ?? [],
        patches: overrides.patches ?? [],
        messages: overrides.messages ?? [],
        events: overrides.events ?? [],
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        summary: overrides.summary,
        title: overrides.title,
        workspacePath: overrides.workspacePath,
        lastResumeReason: overrides.lastResumeReason,
    };
}

afterEach(() => {
    useTaskEventStore.getState().reset();
});

describe('timeline user-message visibility regression', () => {
    test('keeps the latest user message visible for immediate-task sessions in idle state', () => {
        const session = makeSession({
            status: 'idle',
            taskMode: 'immediate_task',
            messages: [
                {
                    id: 'msg-user',
                    role: 'user',
                    content: '帮我导出今天的日报',
                    timestamp: '2026-03-31T01:00:00.000Z',
                },
                {
                    id: 'msg-assistant',
                    role: 'assistant',
                    content: '好的，我先检查导出权限。',
                    timestamp: '2026-03-31T01:00:01.000Z',
                },
            ],
            events: [
                makeEvent({
                    id: 'event-plan',
                    type: 'TASK_PLAN_READY',
                    sequence: 1,
                    timestamp: '2026-03-31T01:00:00.000Z',
                    payload: {
                        summary: '准备导出日报',
                        mode: 'immediate_task',
                        intentRouting: {
                            intent: 'immediate_task',
                            confidence: 0.95,
                            reasonCodes: ['user_route_choice'],
                            forcedByUserSelection: true,
                        },
                    },
                }),
                makeEvent({
                    id: 'event-action',
                    type: 'TASK_USER_ACTION_REQUIRED',
                    sequence: 2,
                    timestamp: '2026-03-31T01:00:01.000Z',
                    payload: {
                        actionId: 'grant-export',
                        title: 'Grant export access',
                        kind: 'manual_step',
                        description: 'Allow Coworkany to continue the export.',
                        blocking: true,
                        questions: [],
                        instructions: ['Grant access and continue.'],
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const userMessages = result.items.filter((item) => item.type === 'user_message');

        expect(userMessages).toEqual([
            expect.objectContaining({
                type: 'user_message',
                content: '帮我导出今天的日报',
            }),
        ]);
    });

    test('keeps first user message visible after TASK_STARTED -> TASK_FINISHED chain', () => {
        const taskId = 'task-visibility-chain';
        const store = useTaskEventStore.getState();

        store.ensureSession(taskId, {
            title: '早上3点关机',
            status: 'idle',
            taskMode: 'immediate_task',
            isDraft: true,
        }, true);

        store.addEvents([
            makeEvent({
                id: 'task-started',
                taskId,
                type: 'TASK_STARTED',
                sequence: 1,
                timestamp: '2026-03-31T01:02:00.000Z',
                payload: {
                    title: '早上3点关机',
                    context: {
                        displayText: '早上3点关机',
                        userQuery: '原始任务：早上3点关机\n用户路由：chat',
                        mode: 'immediate_task',
                    },
                },
            }),
            makeEvent({
                id: 'task-finished',
                taskId,
                type: 'TASK_FINISHED',
                sequence: 2,
                timestamp: '2026-03-31T01:02:02.000Z',
                payload: {
                    summary: '已完成。',
                    finishReason: 'stop',
                },
            }),
        ]);

        const session = useTaskEventStore.getState().getSession(taskId);
        expect(session).toBeDefined();

        const timeline = buildTimelineItems(session!);
        const userMessages = timeline.items.filter((item) => item.type === 'user_message');

        expect(userMessages).toEqual([
            expect.objectContaining({
                type: 'user_message',
                content: '早上3点关机',
            }),
        ]);
    });
});
