import { describe, expect, test } from 'bun:test';
import type { TaskEvent } from '../src/protocol';
import { taskEventToCanonicalStreamEvents } from '../src/protocol';

function makeTextDeltaEvent(
    payload: Record<string, unknown>,
    overrides: Partial<TaskEvent> = {},
): TaskEvent {
    return {
        id: overrides.id ?? 'evt-1',
        timestamp: overrides.timestamp ?? '2026-03-31T00:00:00.000Z',
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: 'TEXT_DELTA',
        payload,
    };
}

function makeEvent(
    type: TaskEvent['type'],
    payload: Record<string, unknown>,
    overrides: Partial<TaskEvent> = {},
): TaskEvent {
    return {
        id: overrides.id ?? `evt-${type.toLowerCase()}`,
        timestamp: overrides.timestamp ?? '2026-03-31T00:00:00.000Z',
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type,
        payload,
    };
}

describe('taskEventToCanonicalStreamEvents', () => {
    test('maps TEXT_DELTA payload.delta to canonical message delta', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeTextDeltaEvent({ role: 'assistant', delta: '你好' }),
        );

        expect(canonicalEvents).toHaveLength(1);
        expect(canonicalEvents[0]).toMatchObject({
            type: 'canonical_message_delta',
            payload: {
                taskId: 'task-1',
                sourceEventType: 'TEXT_DELTA',
                part: {
                    type: 'text',
                    delta: '你好',
                },
            },
        });
    });

    test('prefers payload.delta over legacy content/text fields', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeTextDeltaEvent({
                role: 'assistant',
                delta: 'from-delta',
                content: 'from-content',
                text: 'from-text',
            }),
        );

        expect(canonicalEvents).toHaveLength(1);
        expect(canonicalEvents[0]).toMatchObject({
            type: 'canonical_message_delta',
            payload: {
                part: {
                    type: 'text',
                    delta: 'from-delta',
                },
            },
        });
    });

    test('drops empty TEXT_DELTA payloads', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeTextDeltaEvent({ role: 'assistant' }),
        );
        expect(canonicalEvents).toEqual([]);
    });

    test('maps TASK_STARTED to a user message text extracted from routed query context', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeEvent('TASK_STARTED', {
                context: {
                    userQuery: '原始任务：帮我写一段产品文案\n用户路由：chat',
                },
            }),
        );

        expect(canonicalEvents).toHaveLength(1);
        expect(canonicalEvents[0]).toMatchObject({
            type: 'canonical_message',
            payload: {
                role: 'user',
                parts: [{ type: 'text', text: '帮我写一段产品文案' }],
                sourceEventType: 'TASK_STARTED',
            },
        });
    });

    test('maps TASK_USER_ACTION_REQUIRED external_auth into collaboration choices', () => {
        const canonicalEvents = taskEventToCanonicalStreamEvents(
            makeEvent('TASK_USER_ACTION_REQUIRED', {
                actionId: 'auth-login',
                title: 'Login required',
                kind: 'external_auth',
                description: 'Please login to continue publishing.',
                blocking: true,
                instructions: ['Complete login in browser.'],
                authUrl: 'https://x.com/i/flow/login',
                canAutoResume: true,
            }),
        );

        expect(canonicalEvents).toHaveLength(1);
        expect(canonicalEvents[0]).toMatchObject({
            type: 'canonical_message',
            payload: {
                role: 'runtime',
                parts: [
                    {
                        type: 'task',
                        event: 'user_action_required',
                        title: 'Login required',
                        summary: 'Please login to continue publishing.',
                    },
                    {
                        type: 'collaboration',
                        kind: 'external_auth',
                        title: 'Login required',
                        description: 'Please login to continue publishing.',
                        choices: [
                            { label: '打开登录页面', value: '__auth_open_page__:https://x.com/i/flow/login' },
                            { label: '我已登录，继续执行', value: '继续执行' },
                        ],
                    },
                ],
            },
        });
    });
});
