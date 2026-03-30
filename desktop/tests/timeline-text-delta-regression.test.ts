import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { AssistantTurnItem, TaskEvent, TaskSession, TimelineItemType } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'CHAT_MESSAGE',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'task-1',
        status: overrides.status ?? 'finished',
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

function extractAssistantMessages(items: TimelineItemType[]): string[] {
    const standalone = items
        .filter((item): item is Extract<TimelineItemType, { type: 'assistant_message' }> => item.type === 'assistant_message')
        .map((item) => item.content);
    const turns = items
        .filter((item): item is AssistantTurnItem => item.type === 'assistant_turn')
        .flatMap((item) => item.messages);
    return [...standalone, ...turns];
}

describe('timeline TEXT_DELTA regression', () => {
    test('renders assistant reply when TEXT_DELTA uses payload.delta', () => {
        const session = makeSession({
            taskMode: 'chat',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'user',
                        content: '早上3点关机',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TEXT_DELTA',
                    payload: {
                        role: 'assistant',
                        delta: '好的，',
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TEXT_DELTA',
                    payload: {
                        role: 'assistant',
                        delta: '我来为你设置。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        expect(extractAssistantMessages(result.items)).toEqual(['好的，我来为你设置。']);
    });
});
