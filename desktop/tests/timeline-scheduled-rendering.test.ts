import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { AssistantTurnItem, TaskEvent, TaskSession, TimelineItemType } from '../src/types';
import type { CanonicalTaskMessage } from '../../sidecar/src/protocol';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'scheduled-task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_PLAN_READY',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'scheduled-task-1',
        status: overrides.status ?? 'running',
        taskMode: overrides.taskMode ?? 'scheduled_task',
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
    };
}

function extractAssistantTurns(items: TimelineItemType[]): AssistantTurnItem[] {
    return items
        .filter((item): item is AssistantTurnItem => item.type === 'assistant_turn');
}

function extractAssistantMessages(items: TimelineItemType[]): string[] {
    const standalone = items
        .filter((item): item is Extract<TimelineItemType, { type: 'assistant_message' }> => item.type === 'assistant_message')
        .map((item) => item.content);
    const turnMessages = extractAssistantTurns(items)
        .flatMap((turn) => turn.messages);
    return [...standalone, ...turnMessages];
}

function extractStepDetails(items: TimelineItemType[]): string[] {
    return extractAssistantTurns(items)
        .flatMap((turn) => turn.steps.map((step) => step.detail || ''))
        .filter((detail) => detail.length > 0);
}

function makeCanonicalMessage(overrides: Partial<CanonicalTaskMessage> & Pick<CanonicalTaskMessage, 'id' | 'taskId' | 'role' | 'timestamp' | 'sequence' | 'sourceEventId' | 'sourceEventType' | 'parts'>): CanonicalTaskMessage {
    return {
        status: overrides.status ?? 'complete',
        ...overrides,
    };
}

describe('scheduled timeline rendering', () => {
    test('renders scheduled summary and task card even when only TASK_STARTED + TASK_FINISHED arrive', () => {
        const session = makeSession({
            status: 'finished',
            taskMode: 'scheduled_task',
            title: '早上3点关机',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_STARTED',
                    payload: {
                        title: '早上3点关机',
                        context: {
                            displayText: '早上3点关机',
                            userQuery: '原始任务：早上3点关机\n用户路由：chat',
                        },
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_FINISHED',
                    payload: {
                        summary: '已安排在 03/31 03:00:00 执行：早上3点关机。',
                        finishReason: 'scheduled',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const turns = extractAssistantTurns(result.items);
        const taskCards = turns.map((turn) => turn.taskCard).filter(Boolean);
        const assistantMessages = extractAssistantMessages(result.items);

        expect(turns.length).toBeGreaterThan(0);
        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.status).toBe('finished');
        expect(taskCards[0]?.result?.summary).toContain('03/31 03:00:00');
        expect(assistantMessages.some((content) => content.includes('03/31 03:00:00'))).toBe(true);
    });

    test('hides scheduled internal user echoes and research thinking noise', () => {
        const session = makeSession({
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Scheduled plan ready.',
                        mode: 'scheduled_task',
                        intentRouting: {
                            intent: 'scheduled_task',
                            confidence: 1,
                            reasonCodes: ['schedule_phrase'],
                            needsDisambiguation: false,
                            forcedByUserSelection: true,
                        },
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_STARTED',
                    payload: {
                        title: '[Scheduled] 叫我喝水一次',
                        context: {
                            userQuery: '叫我喝水一次',
                        },
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'user',
                        content: '叫我喝水一次',
                    },
                }),
                makeEvent({
                    sequence: 4,
                    type: 'TASK_RESEARCH_UPDATED',
                    payload: {
                        summary: 'Research updated: 0/0 queries processed, contract ready to freeze.',
                        sourcesChecked: ['conversation', 'template'],
                        completedQueries: 0,
                        pendingQueries: 0,
                        blockingUnknowns: [],
                    },
                }),
                makeEvent({
                    sequence: 5,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'assistant',
                        content: '到点啦，喝口水吧 💧',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);

        const userMessages = result.items.filter((item) => item.type === 'user_message');
        expect(userMessages).toHaveLength(0);

        const details = extractStepDetails(result.items);
        const assistantMessages = extractAssistantMessages(result.items);
        expect(details.some((content) => content.includes('**Thinking**'))).toBe(false);
        expect(details.some((content) => content.includes('Research updated'))).toBe(false);
        expect(details.some((content) => content.includes('conversation'))).toBe(false);
        expect(details.some((content) => content.includes('template'))).toBe(false);
        expect(assistantMessages.some((content) => content.includes('到点啦，喝口水吧'))).toBe(true);
    });

    test('does not merge repeated scheduled TASK_FINISHED summaries', () => {
        const session = makeSession({
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_FINISHED',
                    timestamp: '2026-03-26T08:33:17.678Z',
                    payload: {
                        summary: '你应该补水啦，不要渴着。',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_FINISHED',
                    timestamp: '2026-03-26T08:34:17.678Z',
                    payload: {
                        summary: '你应该补水啦，不要渴着。',
                    },
                }),
            ],
            status: 'finished',
            taskMode: 'scheduled_task',
        });

        const result = buildTimelineItems(session);
        const turns = extractAssistantTurns(result.items);
        const assistantMessages = extractAssistantMessages(result.items);
        const summaryDetails = extractAssistantTurns(result.items)
            .flatMap((turn) => turn.steps.filter((step) => step.title === 'Summary').map((step) => step.detail || ''));

        expect(turns).toHaveLength(1);
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]).toContain('你应该补水啦，不要渴着。');
        expect(summaryDetails).toHaveLength(1);
        expect(summaryDetails[0]).toContain('你应该补水啦，不要渴着。\n你应该补水啦，不要渴着。');
    });

    test('canonical scheduled rendering hides internal user echoes and research noise', () => {
        const session = makeSession({
            taskMode: 'scheduled_task',
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'scheduled-plan',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:00.000Z',
                sequence: 1,
                sourceEventId: 'scheduled-plan',
                sourceEventType: 'TASK_PLAN_READY',
                parts: [{
                    type: 'task',
                    event: 'plan_ready',
                    summary: 'Scheduled plan ready.',
                    data: {
                        mode: 'scheduled_task',
                        intentRouting: {
                            intent: 'scheduled_task',
                            confidence: 1,
                            reasonCodes: ['schedule_phrase'],
                            needsDisambiguation: false,
                            forcedByUserSelection: true,
                        },
                        deliverables: [],
                        checkpoints: [],
                        userActionsRequired: [],
                        missingInfo: [],
                    },
                }],
            }),
            makeCanonicalMessage({
                id: 'scheduled-user-query',
                taskId: session.taskId,
                role: 'user',
                timestamp: '2026-03-27T10:00:01.000Z',
                sequence: 2,
                sourceEventId: 'scheduled-user-query',
                sourceEventType: 'TASK_STARTED',
                parts: [{ type: 'text', text: '叫我喝水一次' }],
            }),
            makeCanonicalMessage({
                id: 'scheduled-research',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:02.000Z',
                sequence: 3,
                sourceEventId: 'scheduled-research',
                sourceEventType: 'TASK_RESEARCH_UPDATED',
                parts: [{
                    type: 'task',
                    event: 'research_updated',
                    summary: 'Research updated: 0/0 queries processed, contract ready to freeze.',
                    data: {
                        sourcesChecked: ['conversation', 'template'],
                        blockingUnknowns: [],
                    },
                }],
            }),
            makeCanonicalMessage({
                id: 'scheduled-reply',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-27T10:00:03.000Z',
                sequence: 4,
                sourceEventId: 'scheduled-reply',
                sourceEventType: 'CHAT_MESSAGE',
                parts: [{ type: 'text', text: '到点啦，喝口水吧 💧' }],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const userMessages = result.items.filter((item) => item.type === 'user_message');
        const details = extractStepDetails(result.items);
        const assistantMessages = extractAssistantMessages(result.items);

        expect(userMessages).toHaveLength(0);
        expect(details.some((content) => content.includes('Research updated'))).toBe(false);
        expect(details.some((content) => content.includes('conversation'))).toBe(false);
        expect(details.some((content) => content.includes('template'))).toBe(false);
        expect(assistantMessages).toContain('到点啦，喝口水吧 💧');
    });

    test('canonical scheduled rendering keeps compact finish result without duplicate messages', () => {
        const session = makeSession({
            status: 'finished',
            taskMode: 'scheduled_task',
            title: '[Scheduled] 喝水提醒',
        });
        const canonicalMessages: CanonicalTaskMessage[] = [
            makeCanonicalMessage({
                id: 'scheduled-finish-1',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-26T08:33:17.678Z',
                sequence: 1,
                sourceEventId: 'scheduled-finish-1',
                sourceEventType: 'TASK_FINISHED',
                parts: [
                    { type: 'finish', summary: '你应该补水啦，不要渴着。' },
                    { type: 'text', text: '你应该补水啦，不要渴着。' },
                ],
            }),
            makeCanonicalMessage({
                id: 'scheduled-finish-2',
                taskId: session.taskId,
                role: 'assistant',
                timestamp: '2026-03-26T08:34:17.678Z',
                sequence: 2,
                sourceEventId: 'scheduled-finish-2',
                sourceEventType: 'TASK_FINISHED',
                parts: [
                    { type: 'finish', summary: '你应该补水啦，不要渴着。' },
                    { type: 'text', text: '你应该补水啦，不要渴着。' },
                ],
            }),
        ];

        const result = buildTimelineItems(session, undefined, canonicalMessages);
        const turns = extractAssistantTurns(result.items);
        const assistantMessages = extractAssistantMessages(result.items);
        const summaryDetails = extractAssistantTurns(result.items)
            .flatMap((turn) => turn.steps.filter((step) => step.title === 'Summary').map((step) => step.detail || ''));

        expect(turns).toHaveLength(1);
        expect(assistantMessages).toHaveLength(1);
        expect(assistantMessages[0]).toContain('你应该补水啦，不要渴着。');
        expect(summaryDetails).toHaveLength(1);
        expect(summaryDetails[0]).toContain('你应该补水啦，不要渴着。\n你应该补水啦，不要渴着。');
    });
});
