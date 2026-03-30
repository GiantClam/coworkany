import { describe, expect, test } from 'bun:test';
import type { AssistantTurnItem, TimelineItemType, UserMessageItem } from '../src/types';
import { buildTimelineTurnRoundViewModel } from '../src/components/Chat/Timeline/viewModels/turnRounds';

function makeUser(id: string, content: string): UserMessageItem {
    return {
        type: 'user_message',
        id,
        content,
        timestamp: '2026-03-31T03:00:00.000Z',
    };
}

function makeAssistant(id: string, messages: string[]): AssistantTurnItem {
    return {
        type: 'assistant_turn',
        id,
        timestamp: '2026-03-31T03:00:01.000Z',
        lead: messages[0] ?? '',
        steps: [],
        messages,
    };
}

describe('timeline turn round view model', () => {
    test('groups user and assistant into the same round', () => {
        const items: TimelineItemType[] = [
            makeUser('u1', '你好'),
            makeAssistant('a1', ['你好，我来帮你。']),
        ];

        const vm = buildTimelineTurnRoundViewModel(items);
        expect(vm.rounds).toHaveLength(1);
        expect(vm.rounds[0]?.userMessage?.id).toBe('u1');
        expect(vm.rounds[0]?.assistantTurn?.id).toBe('a1');
    });

    test('keeps standalone assistant turn as its own round when no user precedes it', () => {
        const items: TimelineItemType[] = [
            makeAssistant('a1', ['系统初始化完成。']),
        ];

        const vm = buildTimelineTurnRoundViewModel(items);
        expect(vm.rounds).toHaveLength(1);
        expect(vm.rounds[0]?.userMessage).toBeUndefined();
        expect(vm.rounds[0]?.assistantTurn?.id).toBe('a1');
    });

    test('creates separate rounds across multiple turns', () => {
        const items: TimelineItemType[] = [
            makeUser('u1', '第一轮'),
            makeAssistant('a1', ['第一轮回复']),
            makeUser('u2', '第二轮'),
            makeAssistant('a2', ['第二轮回复']),
        ];

        const vm = buildTimelineTurnRoundViewModel(items);
        expect(vm.rounds).toHaveLength(2);
        expect(vm.rounds[0]?.userMessage?.id).toBe('u1');
        expect(vm.rounds[0]?.assistantTurn?.id).toBe('a1');
        expect(vm.rounds[1]?.userMessage?.id).toBe('u2');
        expect(vm.rounds[1]?.assistantTurn?.id).toBe('a2');
    });
});
