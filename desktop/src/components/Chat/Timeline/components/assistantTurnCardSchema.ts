import type {
    AssistantTurnItem,
    EffectRequestItem,
    PatchItem,
    TaskCardItem,
} from '../../../../types';
import { sanitizeDisplayText } from '../textSanitizer';
import { buildTaskCardViewModel, type TaskCardViewModel } from './taskCardViewModel';
import { buildToolCardViewModel, type ToolCardViewModel } from './toolCardViewModel';

export type StructuredCardKind = 'assistant' | 'runtime' | 'task' | 'tool';
export type StructuredCardTone = 'neutral' | 'running' | 'success' | 'failed';

interface StructuredCardSummary {
    kind: StructuredCardKind;
    kicker?: string;
    title: string;
    subtitle?: string;
    statusLabel?: string;
    statusTone?: StructuredCardTone;
}

export type AssistantTurnCardSchema =
    | {
        type: 'runtime-status';
        id: string;
        summary: StructuredCardSummary;
        indicator: 'pending';
    }
    | {
        type: 'assistant-response';
        id: string;
        summary: StructuredCardSummary;
        messages: string[];
        systemEvents: string[];
    }
    | {
        type: 'tool-call';
        id: string;
        viewModel: ToolCardViewModel;
    }
    | {
        type: 'task-card';
        id: string;
        viewModel: TaskCardViewModel;
        placement: 'inline' | 'primary';
    };

function toEffectTaskCardItem(item: EffectRequestItem): TaskCardItem {
    const decision = item.approved === undefined ? 'Pending' : (item.approved ? 'Approved' : 'Denied');
    return {
        type: 'task_card',
        id: `${item.id}-effect-card`,
        title: `Effect request · ${item.effectType}`,
        subtitle: `Risk level: ${item.risk}`,
        sections: [
            {
                label: 'Decision',
                lines: [decision],
            },
        ],
        timestamp: item.timestamp,
    };
}

function toPatchTaskCardItem(item: PatchItem): TaskCardItem {
    const statusLabel = item.status === 'applied'
        ? 'Applied'
        : item.status === 'rejected'
            ? 'Rejected'
            : 'Proposed';
    return {
        type: 'task_card',
        id: `${item.id}-patch-card`,
        title: 'Patch update',
        subtitle: item.filePath || 'Unknown file',
        sections: [
            {
                label: 'Status',
                lines: [statusLabel],
            },
        ],
        timestamp: item.timestamp,
    };
}

export function buildAssistantTurnCardSchemas(
    item: AssistantTurnItem,
    pendingLabel?: string,
): AssistantTurnCardSchema[] {
    const cards: AssistantTurnCardSchema[] = [];
    const safePendingLabel = sanitizeDisplayText(pendingLabel || '');
    const safeLead = sanitizeDisplayText(item.lead || '');
    const safeMessages = (item.messages || [])
        .map((message) => message.trim())
        .filter((message) => message.length > 0);
    const safeSystemEvents = (item.systemEvents || [])
        .map((entry) => sanitizeDisplayText(entry))
        .filter((entry) => entry.length > 0);
    const hasRenderedAssistantMessages = safeMessages.length > 0;

    if (safePendingLabel) {
        cards.push({
            type: 'runtime-status',
            id: `${item.id}-runtime-pending`,
            summary: {
                kind: 'runtime',
                kicker: 'Runtime',
                title: safePendingLabel,
                statusLabel: 'Running',
                statusTone: 'running',
            },
            indicator: 'pending',
        });
    }

    if (safeMessages.length > 0 || safeSystemEvents.length > 0) {
        cards.push({
            type: 'assistant-response',
            id: `${item.id}-response`,
            summary: {
                kind: 'assistant',
                kicker: 'Assistant',
                title: 'Response',
                subtitle: safeLead || undefined,
            },
            messages: safeMessages,
            systemEvents: safeSystemEvents,
        });
    }

    for (const toolCall of item.toolCalls || []) {
        cards.push({
            type: 'tool-call',
            id: toolCall.id,
            viewModel: buildToolCardViewModel(toolCall),
        });
    }

    for (const effect of item.effectRequests || []) {
        cards.push({
            type: 'task-card',
            id: `${effect.id}-effect`,
            viewModel: buildTaskCardViewModel(toEffectTaskCardItem(effect)),
            placement: 'inline',
        });
    }

    for (const patch of item.patches || []) {
        cards.push({
            type: 'task-card',
            id: `${patch.id}-patch`,
            viewModel: buildTaskCardViewModel(toPatchTaskCardItem(patch)),
            placement: 'inline',
        });
    }

    if (item.taskCard) {
        cards.push({
            type: 'task-card',
            id: item.taskCard.id,
            viewModel: buildTaskCardViewModel(item.taskCard, {
                hiddenSectionLabels: hasRenderedAssistantMessages ? ['Summary'] : [],
                hideResultSection: hasRenderedAssistantMessages,
            }),
            placement: 'primary',
        });
    }

    return cards;
}
