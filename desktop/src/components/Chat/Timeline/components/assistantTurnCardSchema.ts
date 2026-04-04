import type {
    AssistantTurnItem,
    EffectRequestItem,
    PatchItem,
    TaskCardItem,
} from '../../../../types';
import { sanitizeDisplayText } from '../textSanitizer';
import type { PendingTaskStatus } from '../pendingTaskStatus';
import { buildTaskCardViewModel, type TaskCardViewModel } from './taskCardViewModel';
import { buildToolCardViewModel, type ToolCardViewModel } from './toolCardViewModel';

export type StructuredCardKind = 'assistant' | 'runtime' | 'task' | 'tool';
export type StructuredCardTone = 'neutral' | 'running' | 'success' | 'failed';
export type ApprovalSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalDecision = 'pending' | 'approved' | 'denied';

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
        indicator: 'pending' | 'thinking' | 'running-tool' | 'retrying';
        toolName?: string;
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
        type: 'approval-request';
        id: string;
        summary: StructuredCardSummary;
        approval: {
            requestId: string;
            effectType: string;
            risk: number;
            severity: ApprovalSeverity;
            decision: ApprovalDecision;
            blocking: boolean;
        };
    }
    | {
        type: 'task-card';
        id: string;
        viewModel: TaskCardViewModel;
        placement: 'inline' | 'primary';
    };

function toRiskSeverity(risk: number): ApprovalSeverity {
    if (risk >= 9) {
        return 'critical';
    }
    if (risk >= 7) {
        return 'high';
    }
    if (risk >= 4) {
        return 'medium';
    }
    return 'low';
}

function toDecisionStatus(approved: EffectRequestItem['approved']): ApprovalDecision {
    if (approved === undefined) {
        return 'pending';
    }
    return approved ? 'approved' : 'denied';
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
    pendingStatus?: PendingTaskStatus | null,
): AssistantTurnCardSchema[] {
    const cards: AssistantTurnCardSchema[] = [];
    const safePendingLabel = sanitizeDisplayText(pendingLabel || '');
    const safePendingToolName = sanitizeDisplayText(pendingStatus?.toolName || '');
    const safeLead = sanitizeDisplayText(item.lead || '');
    const safeMessages = (item.messages || [])
        .map((message) => message.trim())
        .filter((message) => message.length > 0);
    const safeSystemEvents = (item.systemEvents || [])
        .map((entry) => sanitizeDisplayText(entry))
        .filter((entry) => entry.length > 0);
    const hasRenderedAssistantMessages = safeLead.length > 0 || safeMessages.length > 0;

    if (safeLead.length > 0 || safeMessages.length > 0 || safeSystemEvents.length > 0) {
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

    if (safePendingLabel || pendingStatus?.phase) {
        const runtimeIndicator = pendingStatus?.phase === 'running_tool'
            ? 'running-tool'
            : pendingStatus?.phase === 'retrying'
                ? 'retrying'
                : pendingStatus?.phase === 'waiting_for_model'
                    ? 'thinking'
                    : 'pending';
        const runtimeTitle = runtimeIndicator === 'running-tool'
            ? safePendingLabel || `Using ${safePendingToolName || 'tool'}`
            : runtimeIndicator === 'retrying'
                ? safePendingLabel || 'Retrying request'
                : runtimeIndicator === 'thinking'
                    ? safePendingLabel || 'Thinking'
                    : safePendingLabel || 'Running';
        const runtimeSubtitle = runtimeIndicator === 'running-tool'
            ? `Executing ${safePendingToolName || 'tool'} and waiting for result.`
            : runtimeIndicator === 'retrying'
                ? 'Rate limited previously. Retrying automatically.'
                : runtimeIndicator === 'thinking'
                    ? 'Model is reasoning and preparing the next response.'
                    : undefined;
        const runtimeStatusLabel = runtimeIndicator === 'running-tool'
            ? 'Using tool'
            : runtimeIndicator === 'retrying'
                ? 'Retrying'
                : runtimeIndicator === 'thinking'
                    ? 'Thinking'
                    : 'Running';
        cards.push({
            type: 'runtime-status',
            id: `${item.id}-runtime-pending`,
            summary: {
                kind: 'runtime',
                kicker: 'Runtime',
                title: runtimeTitle,
                subtitle: runtimeSubtitle,
                statusLabel: runtimeStatusLabel,
                statusTone: 'running',
            },
            indicator: runtimeIndicator,
            toolName: runtimeIndicator === 'running-tool' ? safePendingToolName || undefined : undefined,
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
        const risk = Number.isFinite(effect.risk) ? effect.risk : 0;
        const severity = toRiskSeverity(risk);
        const decision = toDecisionStatus(effect.approved);
        const statusTone: StructuredCardTone = decision === 'approved'
            ? 'success'
            : decision === 'denied'
                ? 'failed'
                : 'running';
        cards.push({
            type: 'approval-request',
            id: `${effect.id}-effect`,
            summary: {
                kind: 'task',
                kicker: 'Approval',
                title: sanitizeDisplayText(effect.effectType) || 'Effect request',
                subtitle: `Risk ${risk} (${severity})`,
                statusLabel: decision === 'pending'
                    ? 'Pending decision'
                    : decision === 'approved'
                        ? 'Approved'
                        : 'Denied',
                statusTone,
            },
            approval: {
                requestId: effect.id,
                effectType: sanitizeDisplayText(effect.effectType) || 'effect',
                risk,
                severity,
                decision,
                blocking: severity === 'high' || severity === 'critical',
            },
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

    for (const patch of item.patches || []) {
        cards.push({
            type: 'task-card',
            id: `${patch.id}-patch`,
            viewModel: buildTaskCardViewModel(toPatchTaskCardItem(patch)),
            placement: 'inline',
        });
    }

    return cards;
}
