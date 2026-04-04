/**
 * useTimelineItems Hook
 *
 * Transforms TaskSession events into TimelineItems for display.
 * Task-mode sessions are collapsed into a structured assistant turn item,
 * while chat-mode sessions keep regular message timeline rendering.
 */

import { useMemo } from 'react';
import type {
    AssistantTurnItem,
    EffectRequestItem,
    PatchItem,
    PlanStep,
    TaskCardItem,
    TaskSession,
    TimelineItemType,
    ToolCallItem,
} from '../../../../types';
import { sanitizeDisplayText, sanitizeNoiseText } from '../textSanitizer';
import {
    type CanonicalStreamEvent,
    type TaskEvent as SidecarTaskEvent,
    taskEventToCanonicalStreamEvents,
    type CanonicalTaskMessage,
} from '../../../../../../sidecar/src/protocol';
import { materializeCanonicalMessages } from '../../../../bridges/canonicalTaskStream';
import {
    buildPlannedTaskList,
    buildPlanSummaryLines,
    buildAssistantTurnSteps,
    cleanTaskCardTitle,
    hasExplicitTaskIntent,
    isScheduledMode,
    mapStatusLabel,
    mergeTaskProgressIntoTaskMap,
    normalizeComparableText,
    normalizeLines,
    normalizeText,
    syncTaskCardExecutionProfile,
    setTaskList,
    TASK_DRAFT_CONFIRMATION_INPUT,
    TASK_DRAFT_CONFIRMATION_INSTRUCTION,
    type AssistantThreadItem,
    type TaskCardTask,
    type TaskPhaseKey,
} from './timelineShared';

export interface TimelineItemsResult {
    items: TimelineItemType[];
    hiddenEventCount: number;
}

type CanonicalMessagePart = CanonicalTaskMessage['parts'][number];
type CanonicalTextPart = Extract<CanonicalMessagePart, { type: 'text' }>;
type CanonicalTaskPart = Extract<CanonicalMessagePart, { type: 'task' }>;
type CanonicalCollaborationPart = Extract<CanonicalMessagePart, { type: 'collaboration' }>;
type CanonicalEffectPart = Extract<CanonicalMessagePart, { type: 'effect' }>;
type CanonicalPatchPart = Extract<CanonicalMessagePart, { type: 'patch' }>;
type CanonicalFinishPart = Extract<CanonicalMessagePart, { type: 'finish' }>;
type CanonicalErrorPart = Extract<CanonicalMessagePart, { type: 'error' }>;

function createEmptyPhaseLines(): Record<TaskPhaseKey, string[]> {
    return {
        plan: [],
        thinking: [],
        execute: [],
        summary: [],
    };
}

function upsertCanonicalTaskCardSection(
    card: TaskCardItem,
    label: string,
    lines: unknown[],
    options?: { mode?: 'replace' | 'append'; maxLines?: number },
): void {
    const normalizedLabel = sanitizeDisplayText(label);
    if (!normalizedLabel) {
        return;
    }

    const normalizedLines = normalizeLines(Array.isArray(lines) ? lines : []);
    if (normalizedLines.length === 0) {
        return;
    }

    const mode = options?.mode ?? 'append';
    const maxLines = options?.maxLines ?? 12;
    const nextSections = [...card.sections];
    const existingIndex = nextSections.findIndex((section) => section.label === normalizedLabel);
    const existingLines = existingIndex >= 0 ? nextSections[existingIndex].lines : [];
    const mergedLines = mode === 'replace'
        ? normalizedLines.slice(-maxLines)
        : Array.from(new Set([...existingLines, ...normalizedLines])).slice(-maxLines);

    const nextSection = { label: normalizedLabel, lines: mergedLines };
    if (existingIndex >= 0) {
        nextSections[existingIndex] = nextSection;
    } else {
        nextSections.push(nextSection);
    }

    card.sections = nextSections;
}

function ensureCanonicalTaskCard(
    session: TaskSession,
    turn: AssistantTurnItem,
    message: CanonicalTaskMessage,
): TaskCardItem {
    if (turn.taskCard) {
        turn.taskCard.timestamp = message.timestamp;
        syncTaskCardExecutionProfile(turn.taskCard, session);
        return turn.taskCard;
    }

    const nextCard: TaskCardItem = {
        type: 'task_card',
        id: `task-center-${message.taskId}`,
        taskId: message.taskId,
        title: 'Task center',
        subtitle: undefined,
        status: 'running',
        sections: [],
        timestamp: message.timestamp,
    };
    syncTaskCardExecutionProfile(nextCard, session);
    turn.taskCard = nextCard;
    return nextCard;
}

function toCanonicalTaskStatus(value: unknown): TaskCardItem['status'] {
    return value === 'running' || value === 'finished' || value === 'failed'
        ? value
        : 'idle';
}

function appendCanonicalPhaseLines(
    phaseLines: Record<TaskPhaseKey, string[]>,
    phase: TaskPhaseKey,
    lines: unknown[],
    options?: { mode?: 'replace' | 'append'; maxLines?: number },
): void {
    const normalized = normalizeLines(Array.isArray(lines) ? lines : []);
    if (normalized.length === 0) {
        return;
    }

    const mode = options?.mode ?? 'append';
    const maxLines = options?.maxLines ?? 8;
    const existing = phaseLines[phase] ?? [];
    phaseLines[phase] = mode === 'replace'
        ? normalized.slice(-maxLines)
        : Array.from(new Set([...existing, ...normalized])).slice(-maxLines);
}

function ensureCanonicalAssistantTurn(
    currentAssistantTurn: AssistantTurnItem | null,
    message: CanonicalTaskMessage,
): AssistantTurnItem {
    if (currentAssistantTurn) {
        currentAssistantTurn.timestamp = message.timestamp;
        return currentAssistantTurn;
    }

    return {
        type: 'assistant_turn',
        id: `assistant-turn-canonical-${message.id}`,
        timestamp: message.timestamp,
        lead: '',
        steps: [],
        messages: [],
    };
}

function appendCanonicalSystemEvent(turn: AssistantTurnItem, text: string): void {
    const normalized = sanitizeDisplayText(text);
    if (!normalized) {
        return;
    }

    const nextSystemEvents = turn.systemEvents ?? [];
    if (nextSystemEvents[nextSystemEvents.length - 1] === normalized) {
        return;
    }

    turn.systemEvents = [...nextSystemEvents, normalized];
}

function formatResumeReasonNotice(reason: unknown): string | null {
    const normalized = normalizeText(reason);
    if (normalized === 'capability_review_approved') {
        return 'Approved the generated capability and resumed the original task.';
    }
    return null;
}

function resolveLastResumeReason(session: TaskSession): string {
    const fromSession = normalizeText(session.lastResumeReason);
    if (fromSession.length > 0) {
        return fromSession;
    }

    for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index];
        if (event.type !== 'TASK_RESUMED') {
            continue;
        }
        const payload = event.payload as Record<string, unknown>;
        const resumeReason = normalizeText(payload.resumeReason);
        if (resumeReason.length > 0) {
            return resumeReason;
        }
    }

    return '';
}

function upsertCanonicalToolCall(
    turn: AssistantTurnItem,
    message: CanonicalTaskMessage,
    toolId: string,
    patch: Partial<ToolCallItem> & Pick<ToolCallItem, 'toolName' | 'status'>,
): void {
    const normalizedToolId = toolId || message.id;
    const nextToolCalls = [...(turn.toolCalls ?? [])];
    const existingIndex = nextToolCalls.findIndex((entry) => entry.id === normalizedToolId);
    const existing = existingIndex >= 0 ? nextToolCalls[existingIndex] : undefined;
    const nextItem: ToolCallItem = {
        type: 'tool_call',
        id: normalizedToolId,
        timestamp: message.timestamp,
        toolName: existing?.toolName || patch.toolName || normalizedToolId || 'Tool',
        args: patch.args ?? existing?.args,
        status: patch.status,
        result: patch.result ?? existing?.result,
    };

    if (existingIndex >= 0) {
        nextToolCalls[existingIndex] = nextItem;
    } else {
        nextToolCalls.push(nextItem);
    }

    turn.toolCalls = nextToolCalls;
}

function upsertCanonicalEffectRequest(
    turn: AssistantTurnItem,
    message: CanonicalTaskMessage,
    requestId: string,
    part: CanonicalEffectPart,
): void {
    const normalizedRequestId = requestId || message.id;
    const nextEffects = [...(turn.effectRequests ?? [])];
    const existingIndex = nextEffects.findIndex((entry) => entry.id === normalizedRequestId);
    const existing = existingIndex >= 0 ? nextEffects[existingIndex] : undefined;
    const isResolvedEffect = part.status === 'approved' || part.status === 'denied';
    const useExistingEffectType = isResolvedEffect && (!part.effectType || part.effectType === 'effect');
    const useExistingRisk = isResolvedEffect && ((part.riskLevel ?? 0) <= 0);
    const nextItem: EffectRequestItem = {
        type: 'effect_request',
        id: normalizedRequestId,
        timestamp: message.timestamp,
        effectType: useExistingEffectType
            ? (existing?.effectType || 'effect')
            : (part.effectType || existing?.effectType || 'effect'),
        risk: useExistingRisk
            ? (existing?.risk ?? 0)
            : (part.riskLevel ?? existing?.risk ?? 0),
        approved: part.status === 'requested'
            ? existing?.approved
            : part.status === 'approved',
    };

    if (existingIndex >= 0) {
        nextEffects[existingIndex] = nextItem;
    } else {
        nextEffects.push(nextItem);
    }

    turn.effectRequests = nextEffects;
}

function upsertCanonicalPatch(
    turn: AssistantTurnItem,
    message: CanonicalTaskMessage,
    patchId: string,
    part: CanonicalPatchPart,
): void {
    const normalizedPatchId = patchId || message.id;
    const nextPatches = [...(turn.patches ?? [])];
    const existingIndex = nextPatches.findIndex((entry) => entry.id === normalizedPatchId);
    const existing = existingIndex >= 0 ? nextPatches[existingIndex] : undefined;
    const nextItem: PatchItem = {
        type: 'patch',
        id: normalizedPatchId,
        timestamp: message.timestamp,
        filePath: part.filePath || existing?.filePath || 'Unknown file',
        status: part.status,
    };

    if (existingIndex >= 0) {
        nextPatches[existingIndex] = nextItem;
    } else {
        nextPatches.push(nextItem);
    }

    turn.patches = nextPatches;
}

function toCanonicalAssistantThreadItems(turn: AssistantTurnItem): AssistantThreadItem[] {
    const items: AssistantThreadItem[] = [];
    if (turn.taskCard) {
        items.push(turn.taskCard);
    }
    items.push(...(turn.toolCalls ?? []));
    items.push(...(turn.effectRequests ?? []));
    items.push(...(turn.patches ?? []));
    items.push(...((turn.systemEvents ?? []).map((content, index) => ({
        type: 'system_event' as const,
        id: `${turn.id}-system-${index}`,
        content,
        timestamp: turn.timestamp,
    }))));
    return items;
}

function updateCanonicalTaskCardFromTaskPart(
    session: TaskSession,
    turn: AssistantTurnItem,
    message: CanonicalTaskMessage,
    part: CanonicalTaskPart,
    phaseLines: Record<TaskPhaseKey, string[]>,
    taskById: Map<string, TaskCardTask>,
): void {
    const data = (part.data as Record<string, unknown> | undefined) ?? {};
    const card = ensureCanonicalTaskCard(session, turn, message);

    switch (part.event) {
        case 'plan_ready': {
            const mode = normalizeText(data.mode);
            const explicitTaskIntent = hasExplicitTaskIntent(data.intentRouting);
            if (mode === 'chat' || !explicitTaskIntent) {
                turn.taskCard = undefined;
                return;
            }

            if (data.executionProfile && typeof data.executionProfile === 'object') {
                card.executionProfile = data.executionProfile as TaskCardItem['executionProfile'];
                card.primaryHardness = card.executionProfile?.primaryHardness;
                card.activeHardness = card.activeHardness ?? card.primaryHardness;
            }
            if (data.capabilityPlan && typeof data.capabilityPlan === 'object') {
                card.capabilityPlan = data.capabilityPlan as TaskCardItem['capabilityPlan'];
            }
            if (data.capabilityReview && typeof data.capabilityReview === 'object') {
                card.capabilityReview = data.capabilityReview as TaskCardItem['capabilityReview'];
            }

            const reviewSummary = data.capabilityReview && typeof data.capabilityReview === 'object'
                ? normalizeText((data.capabilityReview as Record<string, unknown>).summary)
                : '';
            card.subtitle = reviewSummary || part.summary || card.subtitle;
            card.status = 'running';

            const tasks = buildPlannedTaskList(data.tasks);
            if (tasks.length > 0) {
                taskById.clear();
                for (const task of tasks) {
                    taskById.set(task.id, task);
                }
                setTaskList(card, Array.from(taskById.values()));
            }

            const lines = buildPlanSummaryLines(data, tasks, part.summary);
            appendCanonicalPhaseLines(phaseLines, 'plan', lines, { mode: 'replace', maxLines: 10 });
            upsertCanonicalTaskCardSection(card, 'Plan', lines, { mode: 'replace', maxLines: 10 });
            break;
        }

        case 'plan_updated': {
            const lines = [part.summary];
            const tasks = mergeTaskProgressIntoTaskMap(taskById, data.taskProgress);

            if (tasks.length > 0) {
                setTaskList(card, tasks);
            }

            appendCanonicalPhaseLines(phaseLines, 'execute', lines, { mode: 'append', maxLines: 10 });
            upsertCanonicalTaskCardSection(card, 'Execute', lines, { mode: 'append', maxLines: 10 });
            break;
        }

        case 'research_updated': {
            card.subtitle = part.summary || card.subtitle;
            const lines = [
                part.summary,
                ...(Array.isArray(data.sourcesChecked) ? data.sourcesChecked : []),
                ...(Array.isArray(data.blockingUnknowns) ? data.blockingUnknowns : []),
            ];
            appendCanonicalPhaseLines(phaseLines, 'thinking', lines, { mode: 'append', maxLines: 10 });
            upsertCanonicalTaskCardSection(card, 'Thinking', lines, { mode: 'append', maxLines: 10 });
            break;
        }

        case 'contract_reopened': {
            card.subtitle = part.summary || part.title || card.subtitle;
            const diff = (data.diff as Record<string, unknown> | undefined) ?? {};
            const changedFields = Array.isArray(diff.changedFields)
                ? diff.changedFields.filter((field): field is string => typeof field === 'string')
                : [];
            const lines = [
                part.title,
                ...changedFields.map((field) => `Changed: ${field}`),
            ];
            appendCanonicalPhaseLines(phaseLines, 'thinking', lines, { mode: 'append', maxLines: 10 });
            upsertCanonicalTaskCardSection(card, 'Thinking', lines, { mode: 'append', maxLines: 10 });
            break;
        }

        case 'checkpoint_reached': {
            card.subtitle = part.summary || part.title || card.subtitle;
            const lines = [
                [part.title, part.summary].filter(Boolean).join(': '),
            ];
            appendCanonicalPhaseLines(phaseLines, 'execute', lines, { mode: 'append', maxLines: 10 });
            upsertCanonicalTaskCardSection(card, 'Execute', lines, { mode: 'append', maxLines: 10 });
            break;
        }

        case 'user_action_required':
        case 'clarification_required': {
            card.subtitle = part.summary || part.title || card.subtitle;
            const lines = [part.title, part.summary];
            appendCanonicalPhaseLines(phaseLines, 'execute', lines, { mode: 'append', maxLines: 10 });
            upsertCanonicalTaskCardSection(card, 'Execute', lines, { mode: 'append', maxLines: 10 });
            break;
        }

        default:
            break;
    }
}

function updateCanonicalTaskCardCollaboration(
    session: TaskSession,
    turn: AssistantTurnItem,
    message: CanonicalTaskMessage,
    part: CanonicalCollaborationPart,
    phaseLines: Record<TaskPhaseKey, string[]>,
): void {
    const card = ensureCanonicalTaskCard(session, turn, message);
    const questions = normalizeLines(part.questions);
    const instructions = normalizeLines(part.instructions);
    const choices = (part.choices ?? [])
        .map((choice) => ({
            label: normalizeText(choice.label),
            value: normalizeText(choice.value),
        }))
        .filter((choice) => choice.label.length > 0 && choice.value.length > 0);
    const kind = normalizeText(part.kind);
    const isExternalAuth = kind === 'external_auth';
    const isRouteDisambiguation = kind === 'route_disambiguation';
    const isTaskDraftConfirmation = kind === 'task_draft_confirmation';
    const isCheckpoint = kind === 'checkpoint';

    card.subtitle = part.description || card.subtitle;
    appendCanonicalPhaseLines(phaseLines, 'execute', [
        part.description,
        ...questions,
        ...instructions,
    ], { mode: 'append', maxLines: 12 });
    upsertCanonicalTaskCardSection(card, 'Execute', [
        part.description,
        ...questions,
        ...instructions,
    ], { mode: 'append', maxLines: 12 });

    if (isCheckpoint) {
        card.collaboration = {
            actionId: part.actionId || kind || 'checkpoint',
            title: part.title || 'Checkpoint reached',
            description: part.description,
            blocking: part.blocking,
            questions: [],
            instructions,
            action: {
                label: 'Continue',
            },
        };
        return;
    }

    if (isRouteDisambiguation || isTaskDraftConfirmation) {
        card.collaboration = {
            actionId: part.actionId || (isTaskDraftConfirmation ? 'task_draft_confirm' : 'intent_route'),
            title: isTaskDraftConfirmation ? '任务草稿确认' : '选择处理方式',
            description: part.description,
            blocking: part.blocking ?? true,
            questions,
            instructions: isTaskDraftConfirmation
                ? (instructions.length > 0 ? instructions : [TASK_DRAFT_CONFIRMATION_INSTRUCTION])
                : instructions,
            input: isTaskDraftConfirmation
                ? TASK_DRAFT_CONFIRMATION_INPUT
                : undefined,
            choices,
        };
        return;
    }

    if (isExternalAuth) {
        card.collaboration = {
            actionId: part.actionId || 'external_auth',
            title: part.title || '需要登录',
            description: part.description,
            blocking: part.blocking,
            questions,
            instructions,
            choices,
        };
        return;
    }

    card.collaboration = {
        actionId: part.actionId || kind || 'clarification',
        title: part.title || 'Clarification required',
        description: part.description,
        blocking: part.blocking ?? true,
        questions,
        instructions,
        input: {
            placeholder: questions[0] || (kind === 'clarification' ? 'Provide clarification to continue...' : 'Enter your response for this task...'),
            submitLabel: kind === 'clarification' ? 'Submit clarification' : 'Submit and continue',
        },
        action: kind === 'clarification'
            ? undefined
            : {
                label: 'Continue',
            },
    };
}

function applyCanonicalTaskCardFinish(
    turn: AssistantTurnItem,
    session: TaskSession,
    message: CanonicalTaskMessage,
    part: CanonicalFinishPart,
    phaseLines: Record<TaskPhaseKey, string[]>,
    taskById: Map<string, TaskCardTask>,
): void {
    const scheduledSession = isScheduledMode(session.taskMode) || normalizeText(session.title).startsWith('[Scheduled]');
    if (!turn.taskCard) {
        if (!scheduledSession) {
            return;
        }
        const card = ensureCanonicalTaskCard(session, turn, message);
        const sessionTitle = cleanTaskCardTitle(normalizeText(session.title));
        card.title = sessionTitle || 'Scheduled task';
        if (!card.subtitle) {
            card.subtitle = normalizeText(part.summary) || card.subtitle;
        }
        if (!turn.messages.includes(normalizeText(part.summary))) {
            turn.messages = [...turn.messages, normalizeText(part.summary)].filter((entry) => entry.length > 0);
        }
    }

    const card = ensureCanonicalTaskCard(session, turn, message);
    card.status = 'finished';
    card.result = {
        summary: normalizeText(part.summary),
        artifacts: normalizeLines(Array.isArray(part.artifacts) ? part.artifacts : []),
        files: normalizeLines(Array.isArray(part.files) ? part.files : []),
    };
    card.collaboration = undefined;

    if (taskById.size > 0) {
        const completedTasks = Array.from(taskById.values()).map((task) => ({
            ...task,
            status: (task.status === 'failed' ? 'failed' : 'completed') as PlanStep['status'],
        }));
        taskById.clear();
        for (const task of completedTasks) {
            taskById.set(task.id, task);
        }
        setTaskList(card, completedTasks);
    }

    const lines = [
        `Status: ${mapStatusLabel('finished')}`,
        part.summary,
        ...(Array.isArray(part.artifacts) ? part.artifacts.map((artifact) => `Artifact: ${artifact}`) : []),
        ...(Array.isArray(part.files) ? part.files.map((file) => `File changed: ${file}`) : []),
    ];
    appendCanonicalPhaseLines(phaseLines, 'summary', lines, { mode: 'replace', maxLines: 12 });
    upsertCanonicalTaskCardSection(card, 'Summary', lines, { mode: 'replace', maxLines: 12 });
}

function applyCanonicalTaskCardError(
    turn: AssistantTurnItem,
    session: TaskSession,
    message: CanonicalTaskMessage,
    part: CanonicalErrorPart,
    phaseLines: Record<TaskPhaseKey, string[]>,
): void {
    const scheduledSession = isScheduledMode(session.taskMode) || normalizeText(session.title).startsWith('[Scheduled]');
    if (!turn.taskCard) {
        if (!scheduledSession) {
            return;
        }
        const card = ensureCanonicalTaskCard(session, turn, message);
        const sessionTitle = cleanTaskCardTitle(normalizeText(session.title));
        card.title = sessionTitle || 'Scheduled task';
        if (!card.subtitle) {
            card.subtitle = normalizeText(part.message) || card.subtitle;
        }
    }

    const card = ensureCanonicalTaskCard(session, turn, message);
    card.status = 'failed';
    card.result = {
        error: normalizeText(part.message) || 'Unknown error',
        suggestion: normalizeText(part.suggestion),
    };
    card.collaboration = undefined;

    const lines = [
        `Status: ${mapStatusLabel('failed')}`,
        card.result.error,
        card.result.suggestion,
    ];
    appendCanonicalPhaseLines(phaseLines, 'summary', lines, { mode: 'replace', maxLines: 12 });
    upsertCanonicalTaskCardSection(card, 'Summary', lines, { mode: 'replace', maxLines: 12 });
}

function buildCanonicalTimelineItems(
    session: TaskSession,
    canonicalMessages: CanonicalTaskMessage[],
): TimelineItemType[] {
    const items: TimelineItemType[] = [];
    let currentAssistantTurn: AssistantTurnItem | null = null;
    let phaseLines = createEmptyPhaseLines();
    let taskById = new Map<string, TaskCardTask>();
    let activeTaskTurnIndex: number | null = null;
    const isChatSession = session.taskMode === 'chat';
    const scheduledSession = isScheduledMode(session.taskMode) || normalizeText(session.title).startsWith('[Scheduled]');

    const getActiveTaskTurn = (): AssistantTurnItem | null => {
        if (activeTaskTurnIndex === null) {
            return null;
        }
        const item = items[activeTaskTurnIndex];
        if (!item || item.type !== 'assistant_turn' || !item.taskCard) {
            activeTaskTurnIndex = null;
            return null;
        }
        return item;
    };

    const clearActiveTaskContext = () => {
        activeTaskTurnIndex = null;
        if (!currentAssistantTurn?.taskCard) {
            phaseLines = createEmptyPhaseLines();
            taskById = new Map();
        }
    };

    const syncTaskTurnSteps = (turn: AssistantTurnItem) => {
        if (!turn.taskCard) {
            return;
        }
        turn.steps = buildAssistantTurnSteps(
            phaseLines,
            turn.taskCard,
            toCanonicalAssistantThreadItems(turn),
        );
    };

    const resolveCanonicalTaskTurn = (
        message: CanonicalTaskMessage,
        options?: { allowCreate?: boolean },
    ): AssistantTurnItem | null => {
        if (currentAssistantTurn?.taskCard) {
            currentAssistantTurn.timestamp = message.timestamp;
            return currentAssistantTurn;
        }

        const activeTaskTurn = getActiveTaskTurn();
        if (activeTaskTurn) {
            activeTaskTurn.timestamp = message.timestamp;
            return activeTaskTurn;
        }

        if (options?.allowCreate === false) {
            return null;
        }

        currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
        return currentAssistantTurn;
    };

    const hasRenderableAssistantTurnContent = (turn: AssistantTurnItem): boolean => (
        turn.messages.length > 0
        || (turn.systemEvents?.length ?? 0) > 0
        || (turn.toolCalls?.length ?? 0) > 0
        || (turn.effectRequests?.length ?? 0) > 0
        || (turn.patches?.length ?? 0) > 0
        || Boolean(turn.taskCard)
    );

    const flushAssistantTurn = () => {
        if (!currentAssistantTurn) {
            return;
        }
        if (!hasRenderableAssistantTurnContent(currentAssistantTurn)) {
            currentAssistantTurn = null;
            return;
        }
        if (currentAssistantTurn.taskCard) {
            syncTaskTurnSteps(currentAssistantTurn);
        }
        items.push(currentAssistantTurn);
        if (currentAssistantTurn.taskCard) {
            activeTaskTurnIndex = items.length - 1;
        } else if (activeTaskTurnIndex === null) {
            phaseLines = createEmptyPhaseLines();
            taskById = new Map();
        }
        currentAssistantTurn = null;
    };

    const sortedMessages = [...canonicalMessages].sort((left, right) => {
        if (left.sequence !== right.sequence) {
            return left.sequence - right.sequence;
        }
        return left.timestamp.localeCompare(right.timestamp);
    });

    for (const message of sortedMessages) {
        const textParts = message.parts
            .filter((part): part is CanonicalTextPart => part.type === 'text')
            .map((part) => sanitizeNoiseText(part.text))
            .filter((text) => text.length > 0);

        const canonicalAssistantTurnId = `assistant-turn-canonical-${message.id}`;
        if (
            message.role === 'assistant'
            && textParts.length > 0
            && currentAssistantTurn
            && currentAssistantTurn.id !== canonicalAssistantTurnId
            && currentAssistantTurn.messages.length > 0
        ) {
            flushAssistantTurn();
        }

        if (message.role === 'user') {
            if (scheduledSession) {
                continue;
            }
            if (textParts.length === 0) {
                const activeTaskTurn = getActiveTaskTurn();
                if (activeTaskTurn?.taskCard && (activeTaskTurn.taskCard.status === 'finished' || activeTaskTurn.taskCard.status === 'failed')) {
                    clearActiveTaskContext();
                }
                continue;
            }
            flushAssistantTurn();
            items.push({
                type: 'user_message',
                id: message.id,
                content: textParts.join('\n\n'),
                timestamp: message.timestamp,
            });
            const activeTaskTurn = getActiveTaskTurn();
            if (activeTaskTurn?.taskCard && (activeTaskTurn.taskCard.status === 'finished' || activeTaskTurn.taskCard.status === 'failed')) {
                clearActiveTaskContext();
            }
            continue;
        }

        let suppressTextParts = false;

        for (const part of message.parts) {
            switch (part.type) {
                case 'text':
                    break;
                case 'tool-call':
                    currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
                    upsertCanonicalToolCall(currentAssistantTurn, message, part.toolId, {
                        toolName: part.toolName || part.toolId || 'Tool',
                        args: part.input,
                        status: 'running',
                    });
                    break;
                case 'tool-result':
                    currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
                    upsertCanonicalToolCall(currentAssistantTurn, message, part.toolId, {
                        toolName: part.toolId || 'Tool',
                        status: part.success ? 'success' : 'failed',
                        result: part.result ?? part.resultSummary,
                    });
                    break;
                case 'effect':
                    currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
                    upsertCanonicalEffectRequest(currentAssistantTurn, message, part.requestId, part);
                    break;
                case 'patch':
                    currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
                    upsertCanonicalPatch(currentAssistantTurn, message, part.patchId, part);
                    break;
                case 'status':
                    if (currentAssistantTurn?.taskCard) {
                        currentAssistantTurn.taskCard.status = toCanonicalTaskStatus(part.status);
                        if (part.status === 'running') {
                            currentAssistantTurn.taskCard.collaboration = undefined;
                        }
                    }
                    if (part.label && !isChatSession) {
                        currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
                        appendCanonicalSystemEvent(currentAssistantTurn, part.label);
                    }
                    break;
                case 'task':
                    if (part.event === 'plan_ready') {
                        const activeTaskTurn = getActiveTaskTurn();
                        if (activeTaskTurn?.taskCard && (activeTaskTurn.taskCard.status === 'finished' || activeTaskTurn.taskCard.status === 'failed')) {
                            clearActiveTaskContext();
                        }
                    }
                    currentAssistantTurn = resolveCanonicalTaskTurn(message);
                    if (!currentAssistantTurn) {
                        break;
                    }
                    if (!(scheduledSession && part.event === 'research_updated')) {
                        updateCanonicalTaskCardFromTaskPart(session, currentAssistantTurn, message, part, phaseLines, taskById);
                        syncTaskTurnSteps(currentAssistantTurn);
                    }
                    break;
                case 'collaboration':
                    {
                        const taskTurn = resolveCanonicalTaskTurn(message);
                        if (!taskTurn) {
                            break;
                        }
                        updateCanonicalTaskCardCollaboration(session, taskTurn, message, part, phaseLines);
                        syncTaskTurnSteps(taskTurn);
                    }
                    break;
                case 'finish':
                    {
                        const taskTurn = resolveCanonicalTaskTurn(message, { allowCreate: scheduledSession });
                        if (taskTurn) {
                            applyCanonicalTaskCardFinish(taskTurn, session, message, part, phaseLines, taskById);
                            syncTaskTurnSteps(taskTurn);
                        }
                    }
                    break;
                case 'error':
                    {
                        const taskTurn = resolveCanonicalTaskTurn(message, { allowCreate: scheduledSession });
                        if (taskTurn) {
                            applyCanonicalTaskCardError(taskTurn, session, message, part, phaseLines);
                            syncTaskTurnSteps(taskTurn);
                            break;
                        }
                        currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
                        appendCanonicalSystemEvent(currentAssistantTurn, part.message ? `Task failed: ${part.message}` : 'Task failed');
                        if (part.suggestion) {
                            appendCanonicalSystemEvent(currentAssistantTurn, part.suggestion);
                        }
                        suppressTextParts = true;
                    }
                    break;
                default:
                    break;
            }
        }

        if (textParts.length === 0 || suppressTextParts) {
            continue;
        }

        currentAssistantTurn = ensureCanonicalAssistantTurn(currentAssistantTurn, message);
        const suppressScheduledTerminalText = scheduledSession
            && (message.parts.some((part) => part.type === 'finish' || part.type === 'error'))
            && Boolean(currentAssistantTurn.taskCard || getActiveTaskTurn()?.taskCard);
        if (suppressScheduledTerminalText) {
            continue;
        }
        if (message.role === 'system' || message.role === 'runtime') {
            for (const text of textParts) {
                appendCanonicalSystemEvent(currentAssistantTurn, text);
            }
            continue;
        }

        const dedupedTextParts = textParts.filter((text, index) => {
            const comparable = normalizeComparableText(text);
            if (!comparable) {
                return false;
            }
            const previousText = index > 0
                ? textParts[index - 1]
                : currentAssistantTurn?.messages[currentAssistantTurn.messages.length - 1];
            return normalizeComparableText(previousText) !== comparable;
        });

        if (dedupedTextParts.length === 0) {
            continue;
        }

        currentAssistantTurn.messages = [
            ...currentAssistantTurn.messages,
            ...dedupedTextParts,
        ];
    }

    const resumeNotice = formatResumeReasonNotice(resolveLastResumeReason(session));
    if (resumeNotice) {
        const targetTurn = currentAssistantTurn?.taskCard
            ? currentAssistantTurn
            : getActiveTaskTurn();
        if (targetTurn?.taskCard) {
            appendCanonicalPhaseLines(phaseLines, 'execute', [resumeNotice], { mode: 'append', maxLines: 10 });
            upsertCanonicalTaskCardSection(targetTurn.taskCard, 'Execute', [resumeNotice], { mode: 'append', maxLines: 10 });
            appendCanonicalSystemEvent(targetTurn, resumeNotice);
            syncTaskTurnSteps(targetTurn);
        }
    }

    flushAssistantTurn();
    return items;
}

function countMeaningfulUserMessages(messages: TaskSession['messages']): number {
    return messages.filter((message) => (
        message.role === 'user'
        && normalizeText(message.content).length > 0
    )).length;
}

function shouldPreserveTaskMessageTrajectory(session: TaskSession): boolean {
    if (!session.taskMode || session.taskMode === 'chat' || isScheduledMode(session.taskMode)) {
        return false;
    }

    const userMessageCount = countMeaningfulUserMessages(session.messages);
    return userMessageCount >= 1;
}

function buildRawConversationTrajectoryItems(session: TaskSession): TimelineItemType[] {
    const items: TimelineItemType[] = [];

    for (const message of session.messages) {
        const content = message.role === 'assistant'
            ? sanitizeNoiseText(message.content)
            : sanitizeDisplayText(message.content);
        if (!content) {
            continue;
        }

        if (message.role === 'user') {
            items.push({
                type: 'user_message',
                id: message.id,
                content,
                timestamp: message.timestamp,
            });
            continue;
        }

        if (message.role !== 'assistant') {
            continue;
        }

        items.push({
            type: 'assistant_turn',
            id: `assistant-trajectory-${message.id}`,
            timestamp: message.timestamp,
            lead: sanitizeDisplayText(content),
            steps: [],
            messages: [content],
        });
    }

    return items;
}

function hasAssistantTurnNarrative(item: AssistantTurnItem): boolean {
    return (
        normalizeText(item.lead).length > 0
        || item.messages.some((message) => normalizeText(message).length > 0)
        || (item.systemEvents?.some((message) => normalizeText(message).length > 0) ?? false)
        || (item.taskCard?.result
            ? (
                normalizeText(item.taskCard.result.summary).length > 0
                || normalizeText(item.taskCard.result.error).length > 0
                || normalizeText(item.taskCard.result.suggestion).length > 0
            )
            : false)
    );
}

function extractLatestAssistantTurnForTrajectory(items: TimelineItemType[]): AssistantTurnItem | null {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item?.type !== 'assistant_turn') {
            continue;
        }

        const taskCard = item.taskCard;
        const hasActiveTaskState = taskCard
            ? (
                taskCard.status === 'running'
                || taskCard.status === 'idle'
                || Boolean(taskCard.collaboration)
            )
            : false;
        const hasStructuredArtifacts = hasActiveTaskState
            || (item.toolCalls?.length ?? 0) > 0
            || (item.effectRequests?.length ?? 0) > 0
            || (item.patches?.length ?? 0) > 0;
        const hasNarrative = hasAssistantTurnNarrative(item);
        if (!hasStructuredArtifacts && !hasNarrative) {
            continue;
        }

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

    return null;
}

function appendLatestStructuredAssistantTurn(
    rawItems: TimelineItemType[],
    standardItems: TimelineItemType[],
): TimelineItemType[] {
    const latestTurn = extractLatestAssistantTurnForTrajectory(standardItems);
    if (!latestTurn) {
        return rawItems;
    }

    const latestRawAssistantTurn = [...rawItems]
        .reverse()
        .find((item): item is AssistantTurnItem => item.type === 'assistant_turn');

    if (!latestRawAssistantTurn) {
        return [...rawItems, latestTurn];
    }

    const candidateHasStructuredArtifacts = Boolean(
        latestTurn.taskCard
        || (latestTurn.toolCalls?.length ?? 0) > 0
        || (latestTurn.effectRequests?.length ?? 0) > 0
        || (latestTurn.patches?.length ?? 0) > 0,
    );
    if (!candidateHasStructuredArtifacts) {
        return rawItems;
    }

    return [...rawItems, latestTurn];
}

function mergeUniqueTextParts(base: string[], incoming: string[]): string[] {
    const merged: string[] = [];
    for (const text of [...base, ...incoming]) {
        const normalized = normalizeComparableText(text);
        if (!normalized) {
            continue;
        }
        if (merged.some((candidate) => normalizeComparableText(candidate) === normalized)) {
            continue;
        }
        merged.push(text);
    }
    return merged;
}

function mergeById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
    const merged = new Map<string, T>();
    for (const entry of base) {
        merged.set(entry.id, entry);
    }
    for (const entry of incoming) {
        merged.set(entry.id, entry);
    }
    return [...merged.values()];
}

function cloneTaskCard(card: TaskCardItem): TaskCardItem {
    return {
        ...card,
        sections: [...card.sections],
        tasks: card.tasks ? [...card.tasks] : undefined,
        collaboration: card.collaboration
            ? {
                ...card.collaboration,
                questions: [...card.collaboration.questions],
                instructions: [...card.collaboration.instructions],
                input: card.collaboration.input ? { ...card.collaboration.input } : undefined,
                action: card.collaboration.action ? { ...card.collaboration.action } : undefined,
                choices: card.collaboration.choices ? [...card.collaboration.choices] : undefined,
            }
            : undefined,
        result: card.result
            ? {
                ...card.result,
                artifacts: card.result.artifacts ? [...card.result.artifacts] : undefined,
                files: card.result.files ? [...card.result.files] : undefined,
            }
            : undefined,
    };
}

function mergeTaskCard(base: TaskCardItem | undefined, incoming: TaskCardItem | undefined): TaskCardItem | undefined {
    if (!base && !incoming) {
        return undefined;
    }
    if (!base) {
        return incoming ? cloneTaskCard(incoming) : undefined;
    }
    if (!incoming) {
        return cloneTaskCard(base);
    }

    const mergedSections = new Map<string, { label: string; lines: string[] }>();
    for (const section of base.sections) {
        mergedSections.set(section.label, {
            label: section.label,
            lines: [...section.lines],
        });
    }
    for (const section of incoming.sections) {
        const existing = mergedSections.get(section.label);
        if (!existing) {
            mergedSections.set(section.label, {
                label: section.label,
                lines: [...section.lines],
            });
            continue;
        }
        existing.lines = mergeUniqueTextParts(existing.lines, section.lines);
        mergedSections.set(section.label, existing);
    }

    return {
        ...base,
        ...incoming,
        sections: [...mergedSections.values()],
        tasks: incoming.tasks ? [...incoming.tasks] : base.tasks ? [...base.tasks] : undefined,
        collaboration: incoming.collaboration
            ? {
                ...incoming.collaboration,
                questions: [...incoming.collaboration.questions],
                instructions: [...incoming.collaboration.instructions],
                input: incoming.collaboration.input ? { ...incoming.collaboration.input } : undefined,
                action: incoming.collaboration.action ? { ...incoming.collaboration.action } : undefined,
                choices: incoming.collaboration.choices ? [...incoming.collaboration.choices] : undefined,
            }
            : base.collaboration
                ? {
                    ...base.collaboration,
                    questions: [...base.collaboration.questions],
                    instructions: [...base.collaboration.instructions],
                    input: base.collaboration.input ? { ...base.collaboration.input } : undefined,
                    action: base.collaboration.action ? { ...base.collaboration.action } : undefined,
                    choices: base.collaboration.choices ? [...base.collaboration.choices] : undefined,
                }
                : undefined,
        result: incoming.result
            ? {
                ...incoming.result,
                artifacts: incoming.result.artifacts ? [...incoming.result.artifacts] : undefined,
                files: incoming.result.files ? [...incoming.result.files] : undefined,
            }
            : base.result
                ? {
                    ...base.result,
                    artifacts: base.result.artifacts ? [...base.result.artifacts] : undefined,
                    files: base.result.files ? [...base.result.files] : undefined,
                }
                : undefined,
    };
}

function cloneAssistantTurn(turn: AssistantTurnItem): AssistantTurnItem {
    return {
        ...turn,
        steps: [...turn.steps],
        messages: [...turn.messages],
        systemEvents: turn.systemEvents ? [...turn.systemEvents] : undefined,
        toolCalls: turn.toolCalls ? [...turn.toolCalls] : undefined,
        effectRequests: turn.effectRequests ? [...turn.effectRequests] : undefined,
        patches: turn.patches ? [...turn.patches] : undefined,
        taskCard: turn.taskCard ? cloneTaskCard(turn.taskCard) : undefined,
    };
}

function mergeAssistantTurn(base: AssistantTurnItem, incoming: AssistantTurnItem): AssistantTurnItem {
    const mergedLead = sanitizeDisplayText(incoming.lead || '') || sanitizeDisplayText(base.lead || '') || '';
    const incomingSteps = incoming.steps.length > 0 ? incoming.steps : base.steps;
    const baseSystemEvents = base.systemEvents ?? [];
    const incomingSystemEvents = incoming.systemEvents ?? [];
    const baseToolCalls = base.toolCalls ?? [];
    const incomingToolCalls = incoming.toolCalls ?? [];
    const baseEffects = base.effectRequests ?? [];
    const incomingEffects = incoming.effectRequests ?? [];
    const basePatches = base.patches ?? [];
    const incomingPatches = incoming.patches ?? [];

    return {
        ...base,
        timestamp: incoming.timestamp,
        lead: mergedLead || undefined,
        steps: [...incomingSteps],
        messages: mergeUniqueTextParts(base.messages, incoming.messages),
        systemEvents: mergeUniqueTextParts(baseSystemEvents, incomingSystemEvents),
        toolCalls: mergeById(baseToolCalls, incomingToolCalls),
        effectRequests: mergeById(baseEffects, incomingEffects),
        patches: mergeById(basePatches, incomingPatches),
        taskCard: mergeTaskCard(base.taskCard, incoming.taskCard),
    };
}

function normalizeTimelineToTurnRounds(items: TimelineItemType[]): TimelineItemType[] {
    const output: TimelineItemType[] = [];

    const ensureAssistantTurn = (seed: { id: string; timestamp: string }): AssistantTurnItem => {
        const last = output[output.length - 1];
        if (last?.type === 'assistant_turn') {
            return last;
        }
        const turn: AssistantTurnItem = {
            type: 'assistant_turn',
            id: `assistant-turn-round-${seed.id}`,
            timestamp: seed.timestamp,
            steps: [],
            messages: [],
        };
        output.push(turn);
        return turn;
    };

    for (const item of items) {
        switch (item.type) {
            case 'user_message':
                output.push(item);
                break;
            case 'assistant_turn': {
                const last = output[output.length - 1];
                if (last?.type === 'assistant_turn' && last.id === item.id) {
                    output[output.length - 1] = mergeAssistantTurn(last, item);
                } else {
                    output.push(cloneAssistantTurn(item));
                }
                break;
            }
            case 'assistant_message': {
                const turn = ensureAssistantTurn({ id: item.id, timestamp: item.timestamp });
                turn.timestamp = item.timestamp;
                turn.lead = sanitizeDisplayText(item.content);
                turn.messages = mergeUniqueTextParts(turn.messages, [sanitizeDisplayText(item.content)]);
                break;
            }
            case 'system_event': {
                const turn = ensureAssistantTurn({ id: item.id, timestamp: item.timestamp });
                turn.timestamp = item.timestamp;
                turn.systemEvents = mergeUniqueTextParts(turn.systemEvents ?? [], [sanitizeDisplayText(item.content)]);
                break;
            }
            case 'tool_call': {
                const turn = ensureAssistantTurn({ id: item.id, timestamp: item.timestamp });
                turn.timestamp = item.timestamp;
                turn.toolCalls = mergeById(turn.toolCalls ?? [], [item]);
                break;
            }
            case 'effect_request': {
                const turn = ensureAssistantTurn({ id: item.id, timestamp: item.timestamp });
                turn.timestamp = item.timestamp;
                turn.effectRequests = mergeById(turn.effectRequests ?? [], [item]);
                break;
            }
            case 'patch': {
                const turn = ensureAssistantTurn({ id: item.id, timestamp: item.timestamp });
                turn.timestamp = item.timestamp;
                turn.patches = mergeById(turn.patches ?? [], [item]);
                break;
            }
            case 'task_card': {
                const turn = ensureAssistantTurn({ id: item.id, timestamp: item.timestamp });
                turn.timestamp = item.timestamp;
                turn.taskCard = mergeTaskCard(turn.taskCard, item);
                break;
            }
            default:
                break;
        }
    }

    return output;
}

function ensureVisibleUserEntry(items: TimelineItemType[], session: TaskSession): TimelineItemType[] {
    if (items.some((item) => item.type === 'user_message')) {
        return items;
    }

    const fallbackUserMessage = [...session.messages]
        .reverse()
        .find((message) => message.role === 'user' && normalizeText(message.content).length > 0);
    if (!fallbackUserMessage) {
        return items;
    }

    const content = sanitizeDisplayText(fallbackUserMessage.content);
    if (!content) {
        return items;
    }

    return [{
        type: 'user_message',
        id: fallbackUserMessage.id,
        content,
        timestamp: fallbackUserMessage.timestamp || session.updatedAt,
    }, ...items];
}

function buildCanonicalMessagesFromTaskEvents(taskId: string, events: TaskSession['events']): CanonicalTaskMessage[] {
    const canonicalEvents = events.flatMap((event): CanonicalStreamEvent[] => {
        if (event.type === 'RATE_LIMITED') {
            return [{
                type: 'canonical_message',
                payload: {
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    status: 'complete',
                    parts: [{
                        type: 'status',
                        status: 'running',
                        label: normalizeText((event.payload as Record<string, unknown>).message)
                            || `API rate limited (attempt ${String((event.payload as Record<string, unknown>).attempt ?? '?')}/${String((event.payload as Record<string, unknown>).maxRetries ?? '?')}). Retrying...`,
                    }],
                },
            }];
        }

        return taskEventToCanonicalStreamEvents(event as SidecarTaskEvent);
    });
    return materializeCanonicalMessages(taskId, canonicalEvents);
}

function buildCanonicalMessagesFromSessionMessages(session: TaskSession): CanonicalTaskMessage[] {
    return session.messages
        .map((message, index): CanonicalTaskMessage | null => {
            const normalizedText = normalizeText(message.content);
            if (!normalizedText) {
                return null;
            }

            const role = message.role === 'user' || message.role === 'assistant' || message.role === 'system'
                ? message.role
                : 'runtime';

            return {
                id: message.id || `session-message-${session.taskId}-${index}`,
                taskId: session.taskId,
                role,
                timestamp: message.timestamp || session.updatedAt,
                sequence: index + 1,
                status: 'complete',
                parts: [{
                    type: 'text',
                    text: normalizedText,
                }],
            };
        })
        .filter((message): message is CanonicalTaskMessage => message !== null);
}

function applyHistoryClearBoundaryToCanonicalMessages(
    events: TaskSession['events'],
    messages: CanonicalTaskMessage[] | undefined,
): CanonicalTaskMessage[] | undefined {
    if (!messages || messages.length === 0) {
        return messages;
    }

    const latestClearEvent = [...events]
        .reverse()
        .find((event) => event.type === 'TASK_HISTORY_CLEARED');
    if (!latestClearEvent) {
        return messages;
    }

    const clearTimestamp = latestClearEvent.timestamp;
    const clearTimestampMs = Date.parse(clearTimestamp);
    const clearSequence = latestClearEvent.sequence;
    return messages.filter((message) => {
        const messageTimestampMs = Date.parse(message.timestamp);
        const timestampAfterClear = (
            !Number.isNaN(clearTimestampMs)
            && !Number.isNaN(messageTimestampMs)
            && messageTimestampMs >= clearTimestampMs
        ) || message.timestamp >= clearTimestamp;
        const sequenceAfterClear = typeof clearSequence === 'number' && message.sequence > clearSequence;
        return sequenceAfterClear || timestampAfterClear;
    });
}

// Keep helper symbols referenced for replay/debug parity during staged migration.
void shouldPreserveTaskMessageTrajectory;
void buildRawConversationTrajectoryItems;
void appendLatestStructuredAssistantTurn;
void buildCanonicalMessagesFromSessionMessages;

export function buildTimelineItems(
    session: TaskSession,
    maxRecentEvents?: number,
    canonicalMessages?: CanonicalTaskMessage[],
): TimelineItemsResult {
    const sourceEvents = typeof maxRecentEvents === 'number' && maxRecentEvents > 0
        ? session.events.slice(Math.max(0, session.events.length - maxRecentEvents))
        : session.events;

    const providedCanonicalMessages = canonicalMessages && canonicalMessages.length > 0
        ? canonicalMessages
        : undefined;
    const scopedCanonicalMessages = applyHistoryClearBoundaryToCanonicalMessages(sourceEvents, providedCanonicalMessages);
    const localCanonicalMessages = buildCanonicalMessagesFromTaskEvents(session.taskId, sourceEvents);
    const effectiveCanonicalMessages = scopedCanonicalMessages ?? localCanonicalMessages;
    const standardItems = buildCanonicalTimelineItems(session, effectiveCanonicalMessages);
    const turnRoundItems = normalizeTimelineToTurnRounds(standardItems);
    const items = ensureVisibleUserEntry(turnRoundItems, session);

    return {
        items,
        hiddenEventCount: session.events.length - sourceEvents.length,
    };
}

/**
 * Process session events into timeline items
 */
export function useTimelineItems(
    session: TaskSession,
    maxRecentEvents?: number,
    canonicalMessages?: CanonicalTaskMessage[],
): TimelineItemsResult {
    return useMemo(
        () => buildTimelineItems(session, maxRecentEvents, canonicalMessages),
        [canonicalMessages, maxRecentEvents, session],
    );
}
