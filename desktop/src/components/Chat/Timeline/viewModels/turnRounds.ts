import type { AssistantTurnItem, TimelineItemType, UserMessageItem } from '../../../../types';

export interface TimelineTurnRound {
    id: string;
    userMessage?: UserMessageItem;
    assistantTurn?: AssistantTurnItem;
}

export interface TimelineTurnRoundViewModel {
    rounds: TimelineTurnRound[];
}

function cloneUserMessage(item: UserMessageItem): UserMessageItem {
    return {
        ...item,
    };
}

function cloneAssistantTurn(item: AssistantTurnItem): AssistantTurnItem {
    return {
        ...item,
        steps: [...item.steps],
        messages: [...item.messages],
        systemEvents: item.systemEvents ? [...item.systemEvents] : undefined,
        toolCalls: item.toolCalls ? [...item.toolCalls] : undefined,
        effectRequests: item.effectRequests ? [...item.effectRequests] : undefined,
        patches: item.patches ? [...item.patches] : undefined,
        taskCard: item.taskCard
            ? {
                ...item.taskCard,
                sections: [...item.taskCard.sections],
                tasks: item.taskCard.tasks ? [...item.taskCard.tasks] : undefined,
            }
            : undefined,
    };
}

function createRoundId(index: number, item: TimelineItemType): string {
    return `round-${index}-${item.type}-${item.id}`;
}

export function buildTimelineTurnRoundViewModel(items: TimelineItemType[]): TimelineTurnRoundViewModel {
    const rounds: TimelineTurnRound[] = [];

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item.type === 'user_message') {
            rounds.push({
                id: createRoundId(index, item),
                userMessage: cloneUserMessage(item),
            });
            continue;
        }

        if (item.type !== 'assistant_turn') {
            continue;
        }

        const previous = rounds[rounds.length - 1];
        if (previous && !previous.assistantTurn) {
            previous.assistantTurn = cloneAssistantTurn(item);
            continue;
        }

        rounds.push({
            id: createRoundId(index, item),
            assistantTurn: cloneAssistantTurn(item),
        });
    }

    return { rounds };
}
