import { describe, expect, test } from 'bun:test';
import { buildDisplayItemsWithPendingState, resolveAssistantUiPendingLabel } from '../src/components/Chat/Timeline/Timeline';
import type { AssistantTurnItem, TimelineItemType } from '../src/types';

function makeAssistantTurn(id: string, timestamp = '2026-03-31T01:00:00.000Z'): AssistantTurnItem {
    return {
        type: 'assistant_turn',
        id,
        timestamp,
        lead: '',
        steps: [],
        messages: [],
    };
}

function makeUserMessage(id: string, content: string, timestamp = '2026-03-31T01:00:00.000Z'): TimelineItemType {
    return {
        type: 'user_message',
        id,
        content,
        timestamp,
    };
}

describe('buildDisplayItemsWithPendingState', () => {
    test('appends pending assistant turn at bottom when latest item is user message', () => {
        const visibleItems: TimelineItemType[] = [
            makeAssistantTurn('assistant-old', '2026-03-31T01:00:00.000Z'),
            makeUserMessage('user-latest', '早上3点关机', '2026-03-31T01:00:05.000Z'),
        ];

        const displayItems = buildDisplayItemsWithPendingState(
            visibleItems,
            'Sent. Thinking...',
            { taskId: 'task-1', updatedAt: '2026-03-31T01:00:06.000Z' },
        );

        expect(displayItems).toHaveLength(3);
        expect(displayItems[0]?.id).toBe('assistant-old');
        expect(displayItems[1]?.id).toBe('user-latest');
        expect(displayItems[2]).toMatchObject({
            type: 'assistant_turn',
            id: 'pending-turn-task-1',
            timestamp: '2026-03-31T01:00:06.000Z',
        });
    });

    test('reuses bottom assistant turn when latest item is already assistant turn', () => {
        const visibleItems: TimelineItemType[] = [
            makeUserMessage('user-latest', '帮我查一下'),
            makeAssistantTurn('assistant-latest'),
        ];

        const displayItems = buildDisplayItemsWithPendingState(
            visibleItems,
            'Sent. Thinking...',
            { taskId: 'task-2', updatedAt: '2026-03-31T01:00:06.000Z' },
        );

        expect(displayItems).toHaveLength(2);
        expect(displayItems[1]?.id).toBe('assistant-latest');
    });

    test('does not append pending turn when pending label is empty', () => {
        const visibleItems: TimelineItemType[] = [
            makeUserMessage('user-only', '你好'),
        ];

        const displayItems = buildDisplayItemsWithPendingState(
            visibleItems,
            '',
            { taskId: 'task-3', updatedAt: '2026-03-31T01:00:06.000Z' },
        );

        expect(displayItems).toEqual(visibleItems);
    });
});

describe('resolveAssistantUiPendingLabel', () => {
    test('clears pending label when latest assistant turn already has response text', () => {
        const visibleItems: TimelineItemType[] = [
            makeUserMessage('user-latest', '你好'),
            {
                ...makeAssistantTurn('assistant-latest'),
                messages: ['这是最终回复。'],
            },
        ];

        expect(resolveAssistantUiPendingLabel(visibleItems, 'Sent. Thinking...')).toBe('');
    });

    test('keeps pending label when latest assistant turn has no renderable narrative', () => {
        const visibleItems: TimelineItemType[] = [
            makeUserMessage('user-latest', '你好'),
            makeAssistantTurn('assistant-latest'),
        ];

        expect(resolveAssistantUiPendingLabel(visibleItems, 'Sent. Thinking...')).toBe('Sent. Thinking...');
    });
});
