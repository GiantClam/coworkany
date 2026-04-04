import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { TaskEvent, TaskSession } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-rounds-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_PLAN_READY',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'task-rounds-1',
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

function explicitTaskIntentRouting() {
    return {
        intent: 'immediate_task',
        confidence: 0.99,
        reasonCodes: ['user_route_choice'],
        needsDisambiguation: false,
        forcedByUserSelection: true,
    } as const;
}

describe('timeline turn rounds regression', () => {
    test('merges multiple assistant updates within the same user round', () => {
        const session = makeSession({
            status: 'idle',
            taskMode: 'immediate_task',
            messages: [
                {
                    id: 'msg-user-1',
                    role: 'user',
                    content: '导出本周日报',
                    timestamp: '2026-03-31T02:00:00.000Z',
                },
                {
                    id: 'msg-assistant-1',
                    role: 'assistant',
                    content: '好的，我先检查导出权限。',
                    timestamp: '2026-03-31T02:00:01.000Z',
                },
            ],
            events: [
                makeEvent({
                    id: 'event-plan',
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    timestamp: '2026-03-31T02:00:00.100Z',
                    payload: {
                        summary: '准备导出日报',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                    },
                }),
                makeEvent({
                    id: 'event-action',
                    sequence: 2,
                    type: 'TASK_USER_ACTION_REQUIRED',
                    timestamp: '2026-03-31T02:00:01.100Z',
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

        expect(result.items.map((item) => item.type)).toEqual(['user_message', 'assistant_turn']);
        const assistantTurn = result.items[1];
        expect(assistantTurn?.type).toBe('assistant_turn');
        expect(assistantTurn?.messages).toContain('好的，我先检查导出权限。');
        expect(Boolean(assistantTurn?.taskCard?.collaboration)).toBe(true);
    });

    test('keeps one assistant turn per user round across multi-turn conversations', () => {
        const session = makeSession({
            status: 'running',
            taskMode: 'immediate_task',
            messages: [
                {
                    id: 'msg-user-1',
                    role: 'user',
                    content: '先帮我检查日报模板',
                    timestamp: '2026-03-31T02:10:00.000Z',
                },
                {
                    id: 'msg-assistant-1',
                    role: 'assistant',
                    content: '已检查模板结构。',
                    timestamp: '2026-03-31T02:10:01.000Z',
                },
                {
                    id: 'msg-user-2',
                    role: 'user',
                    content: '再导出今天日报',
                    timestamp: '2026-03-31T02:10:10.000Z',
                },
                {
                    id: 'msg-assistant-2',
                    role: 'assistant',
                    content: '正在导出今日日报。',
                    timestamp: '2026-03-31T02:10:11.000Z',
                },
            ],
            events: [
                makeEvent({
                    id: 'event-plan',
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    timestamp: '2026-03-31T02:10:10.100Z',
                    payload: {
                        summary: '执行导出任务',
                        mode: 'immediate_task',
                        intentRouting: explicitTaskIntentRouting(),
                    },
                }),
                makeEvent({
                    id: 'event-progress',
                    sequence: 2,
                    type: 'TASK_STATUS',
                    timestamp: '2026-03-31T02:10:11.100Z',
                    payload: {
                        status: 'running',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const types = result.items.map((item) => item.type);

        expect(types).toEqual(['user_message', 'assistant_turn', 'user_message', 'assistant_turn']);
        for (let index = 1; index < types.length; index += 1) {
            expect(!(types[index] === 'assistant_turn' && types[index - 1] === 'assistant_turn')).toBe(true);
        }
    });

    test('chat mode hides task workflow completion/status events from message bubbles', () => {
        const session = makeSession({
            status: 'finished',
            taskMode: 'chat',
            messages: [
                {
                    id: 'msg-user-chat-1',
                    role: 'user',
                    content: '你好，请简单问候我一下。',
                    timestamp: '2026-04-03T09:00:00.000Z',
                },
                {
                    id: 'msg-assistant-chat-1',
                    role: 'assistant',
                    content: '你好！很高兴见到你。',
                    timestamp: '2026-04-03T09:00:02.000Z',
                },
            ],
            events: [
                makeEvent({
                    id: 'event-chat-started',
                    sequence: 1,
                    type: 'TASK_STARTED',
                    timestamp: '2026-04-03T09:00:00.010Z',
                    payload: {
                        title: '你好，请简单问候我一下。',
                        description: '你好，请简单问候我一下。',
                        context: {
                            mode: 'chat',
                            userQuery: '你好，请简单问候我一下。',
                        },
                    },
                }),
                makeEvent({
                    id: 'event-chat-status-running',
                    sequence: 2,
                    type: 'TASK_STATUS',
                    timestamp: '2026-04-03T09:00:00.500Z',
                    payload: {
                        status: 'running',
                        message: '正在处理问候请求…',
                    },
                }),
                makeEvent({
                    id: 'event-chat-finished',
                    sequence: 3,
                    type: 'TASK_FINISHED',
                    timestamp: '2026-04-03T09:00:02.500Z',
                    payload: {
                        summary: '问候已响应',
                        finishReason: 'greeting_responded',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        expect(result.items.map((item) => item.type)).toEqual(['user_message', 'assistant_turn']);

        const assistantTurn = result.items[1];
        expect(assistantTurn?.type).toBe('assistant_turn');
        if (assistantTurn?.type === 'assistant_turn') {
            expect(assistantTurn.taskCard).toBeUndefined();
            expect(assistantTurn.systemEvents?.length ?? 0).toBe(0);
            expect(assistantTurn.messages).toEqual(['你好！很高兴见到你。']);
        }
    });
});
