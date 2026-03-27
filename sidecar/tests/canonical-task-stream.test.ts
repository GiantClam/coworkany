import { describe, expect, test } from 'bun:test';
import type { TaskEvent } from '../src/protocol';
import { taskEventToCanonicalStreamEvents } from '../src/protocol';

function makeEvent(overrides: Partial<TaskEvent> & { type: TaskEvent['type']; payload: Record<string, unknown> }): TaskEvent {
    return {
        id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
        taskId: overrides.taskId ?? '22222222-2222-4222-8222-222222222222',
        timestamp: overrides.timestamp ?? '2026-03-27T10:00:00.000Z',
        sequence: overrides.sequence ?? 1,
        type: overrides.type,
        payload: overrides.payload,
    } as TaskEvent;
}

describe('canonical task stream protocol', () => {
    test('maps text deltas into canonical message delta events', () => {
        const event = makeEvent({
            type: 'TEXT_DELTA',
            payload: {
                role: 'assistant',
                delta: 'Hello',
            },
        });

        const result = taskEventToCanonicalStreamEvents(event);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 'canonical_message_delta',
            payload: {
                taskId: event.taskId,
                role: 'assistant',
                correlationId: `stream:${event.taskId}:assistant`,
                part: {
                    type: 'text',
                    delta: 'Hello',
                },
            },
        });
    });

    test('maps assistant chat messages to complete canonical messages linked to the assistant stream', () => {
        const event = makeEvent({
            type: 'CHAT_MESSAGE',
            payload: {
                role: 'assistant',
                content: 'Final answer',
            },
        });

        const result = taskEventToCanonicalStreamEvents(event);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 'canonical_message',
            payload: {
                id: event.id,
                taskId: event.taskId,
                role: 'assistant',
                correlationId: `stream:${event.taskId}:assistant`,
                parts: [
                    {
                        type: 'text',
                        text: 'Final answer',
                    },
                ],
            },
        });
    });

    test('maps plan-ready events to structured task parts', () => {
        const event = makeEvent({
            type: 'TASK_PLAN_READY',
            payload: {
                summary: 'Plan ready',
                mode: 'immediate_task',
                intentRouting: {
                    intent: 'immediate_task',
                    confidence: 0.98,
                    reasonCodes: ['user_route_choice'],
                    needsDisambiguation: false,
                    forcedByUserSelection: true,
                },
                tasks: [
                    {
                        id: 'task-1',
                        title: 'Inspect repo',
                        objective: 'Inspect repo',
                        dependencies: [],
                    },
                ],
                deliverables: [],
                checkpoints: [],
                userActionsRequired: [],
                missingInfo: [],
            },
        });

        const result = taskEventToCanonicalStreamEvents(event);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 'canonical_message',
            payload: {
                role: 'assistant',
                parts: [
                    {
                        type: 'task',
                        event: 'plan_ready',
                        summary: 'Plan ready',
                        data: {
                            mode: 'immediate_task',
                            intentRouting: {
                                intent: 'immediate_task',
                                confidence: 0.98,
                                reasonCodes: ['user_route_choice'],
                                needsDisambiguation: false,
                                forcedByUserSelection: true,
                            },
                        },
                    },
                ],
            },
        });
    });

    test('maps external auth user actions into structured collaboration choices', () => {
        const event = makeEvent({
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: {
                actionId: 'auth-login',
                title: 'Login required',
                kind: 'external_auth',
                description: 'Please login to continue publishing.',
                blocking: true,
                questions: [],
                instructions: ['Complete login in browser.'],
                authUrl: 'https://x.com/i/flow/login',
                canAutoResume: true,
            },
        });

        const result = taskEventToCanonicalStreamEvents(event);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 'canonical_message',
            payload: {
                role: 'assistant',
                parts: [
                    {
                        type: 'collaboration',
                        kind: 'external_auth',
                        actionId: 'auth-login',
                        title: 'Login required',
                        description: 'Please login to continue publishing.',
                        instructions: [
                            'Complete login in browser.',
                            '登录完成后将自动继续执行。',
                        ],
                        choices: [
                            { label: '打开登录页面', value: '__auth_open_page__:https://x.com/i/flow/login' },
                            { label: '我已登录，继续执行', value: '继续执行' },
                        ],
                    },
                ],
            },
        });
    });

    test('maps plan updates into structured task progress parts', () => {
        const event = makeEvent({
            type: 'PLAN_UPDATED',
            payload: {
                summary: 'Execution is in progress.',
                taskProgress: [
                    {
                        taskId: 'task-1',
                        title: 'Inspect repo',
                        status: 'in_progress',
                        dependencies: [],
                    },
                ],
            },
        });

        const result = taskEventToCanonicalStreamEvents(event);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            type: 'canonical_message',
            payload: {
                role: 'assistant',
                parts: [
                    {
                        type: 'task',
                        event: 'plan_updated',
                        summary: 'Execution is in progress.',
                        data: {
                            taskProgress: [
                                {
                                    taskId: 'task-1',
                                    title: 'Inspect repo',
                                    status: 'in_progress',
                                    dependencies: [],
                                },
                            ],
                        },
                    },
                ],
            },
        });
    });

});
