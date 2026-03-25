/**
 * useTimelineItems Hook
 *
 * Transforms TaskSession events into TimelineItems for display.
 * Task flow is rendered as phase bubbles (plan/thinking/execute/summary),
 * with a lightweight task card shown before execution.
 */

import { useMemo } from 'react';
import type { PlanStep, TaskCardItem, TaskSession, TimelineItemType } from '../../../../types';

export interface TimelineItemsResult {
    items: TimelineItemType[];
    hiddenEventCount: number;
}

type TaskCardTask = NonNullable<TaskCardItem['tasks']>[number];
type TaskPhaseKey = 'plan' | 'thinking' | 'execute' | 'summary';

type BuildState = {
    items: TimelineItemType[];
    taskCardIndex: number | null;
    hasTaskContext: boolean;
    isChatMode: boolean;
    taskIntentExplicit: boolean;
    currentDraftIndex: number | null;
    taskOutputDraft: string;
    toolIndex: Map<string, number>;
    effectIndex: Map<string, number>;
    patchIndex: Map<string, number>;
    toolNameById: Map<string, string>;
    taskById: Map<string, TaskCardTask>;
    phaseItemIndex: Partial<Record<TaskPhaseKey, number>>;
    phaseLines: Record<TaskPhaseKey, string[]>;
};

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeLines(values: unknown[]): string[] {
    const lines = values
        .map((value) => normalizeText(value))
        .filter((line) => line.length > 0);
    return Array.from(new Set(lines));
}

function normalizeComparableText(value: unknown): string {
    return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeTaskStartedText(content: unknown): string {
    const text = normalizeText(content);
    if (!text) {
        return '';
    }

    const routedMatch = text.match(
        /^(?:原始任务|Original task)\s*[:：]\s*([\s\S]+?)\n(?:用户路由|User route)\s*[:：]\s*(?:chat|task|immediate_task)\s*$/i
    );
    if (routedMatch?.[1]) {
        return routedMatch[1].trim();
    }

    const commandMatch = text.match(/^\/(?:ask|task)\b\s*([\s\S]*)$/i);
    if (commandMatch?.[1]) {
        const cleaned = commandMatch[1].trim();
        return cleaned || text;
    }

    return text;
}

function hasExplicitTaskIntent(intentRouting: unknown): boolean {
    if (!intentRouting || typeof intentRouting !== 'object') {
        return false;
    }

    const routing = intentRouting as Record<string, unknown>;
    const intent = normalizeText(routing.intent);
    if (!intent || intent === 'chat') {
        return false;
    }

    if (routing.forcedByUserSelection === true) {
        return true;
    }

    const reasonCodes = Array.isArray(routing.reasonCodes)
        ? routing.reasonCodes.filter((code): code is string => typeof code === 'string').map((code) => code.trim().toLowerCase())
        : [];

    return reasonCodes.includes('explicit_command')
        || reasonCodes.includes('user_route_choice')
        || reasonCodes.includes('schedule_phrase');
}

function appendItem(state: BuildState, item: TimelineItemType): number {
    const index = state.items.length;
    state.items.push(item);
    return index;
}

function upsertItem(state: BuildState, index: number, item: TimelineItemType): void {
    state.items[index] = item;
}

function appendSystemEvent(state: BuildState, event: TaskSession['events'][number], content: string): void {
    const normalizedContent = content.trim();
    if (!normalizedContent) {
        return;
    }

    const lastItem = state.items.at(-1);
    if (lastItem?.type === 'system_event' && lastItem.content.trim() === normalizedContent) {
        return;
    }

    appendItem(state, {
        type: 'system_event',
        id: event.id,
        content: normalizedContent,
        timestamp: event.timestamp,
    });
}

function isRuntimeNoiseSystemEvent(content: string): boolean {
    const normalized = content.trim();
    if (!normalized) {
        return true;
    }

    return normalized.startsWith('[SUSPENDED]')
        || normalized.startsWith('[RESUMED]')
        || normalized.toLowerCase().startsWith('status updated:');
}

function mapStatusLabel(status: TaskSession['status'] | ''): string {
    switch (status) {
        case 'running':
            return 'In progress';
        case 'finished':
            return 'Completed';
        case 'failed':
            return 'Failed';
        case 'idle':
            return 'Waiting';
        default:
            return 'Unknown';
    }
}

function phaseTitle(phase: TaskPhaseKey): string {
    switch (phase) {
        case 'plan':
            return 'Task plan';
        case 'thinking':
            return 'Thinking';
        case 'execute':
            return 'Execute';
        case 'summary':
            return 'Summary';
        default:
            return 'Update';
    }
}

function buildPhaseBubbleContent(phase: TaskPhaseKey, lines: string[]): string {
    const title = phaseTitle(phase);
    const bulletLines = lines
        .filter((line) => line.trim().length > 0)
        .map((line) => `- ${line}`);
    return [`**${title}**`, ...bulletLines].join('\n');
}

function upsertPhaseBubble(
    state: BuildState,
    phase: TaskPhaseKey,
    event: TaskSession['events'][number],
    lines: unknown[],
    options?: { mode?: 'replace' | 'append'; maxLines?: number; isStreaming?: boolean },
): void {
    const normalized = normalizeLines(Array.isArray(lines) ? lines : []);
    if (normalized.length === 0) {
        return;
    }

    const mode = options?.mode ?? 'append';
    const maxLines = options?.maxLines ?? 8;
    const isStreaming = options?.isStreaming ?? false;
    const existing = state.phaseLines[phase] ?? [];
    const merged = mode === 'replace'
        ? normalized.slice(-maxLines)
        : Array.from(new Set([...existing, ...normalized])).slice(-maxLines);
    state.phaseLines[phase] = merged;

    const phaseItem: TimelineItemType = {
        type: 'assistant_message',
        id: `${event.id}-${phase}`,
        content: buildPhaseBubbleContent(phase, merged),
        timestamp: event.timestamp,
        isStreaming,
    };

    const existingIndex = state.phaseItemIndex[phase];
    if (typeof existingIndex === 'number') {
        const existingItem = state.items[existingIndex];
        if (existingItem?.type === 'assistant_message') {
            upsertItem(state, existingIndex, {
                ...existingItem,
                content: phaseItem.content,
                timestamp: event.timestamp,
                isStreaming,
            });
            return;
        }
    }

    const index = appendItem(state, phaseItem);
    state.phaseItemIndex[phase] = index;
}

function inferWorkflow(tasks: TaskCardTask[]): NonNullable<TaskCardItem['workflow']> {
    if (tasks.length <= 1) {
        return 'single';
    }

    const allWithoutDependencies = tasks.every((task) => task.dependencies.length === 0);
    if (allWithoutDependencies) {
        return 'parallel';
    }

    const byId = new Map(tasks.map((task) => [task.id, task]));
    const sequential = tasks.every((task, index) => {
        if (index === 0) {
            return task.dependencies.length === 0;
        }
        const previous = tasks[index - 1];
        return task.dependencies.length === 1
            && task.dependencies[0] === previous?.id
            && byId.has(previous.id);
    });

    return sequential ? 'sequential' : 'dag';
}

function ensureTaskCard(
    state: BuildState,
    session: TaskSession,
    event: TaskSession['events'][number],
): TaskCardItem {
    let card = state.taskCardIndex !== null ? state.items[state.taskCardIndex] : undefined;
    if (!card || card.type !== 'task_card') {
        const nextCard: TaskCardItem = {
            type: 'task_card',
            id: `task-center-${session.taskId}`,
            taskId: session.taskId,
            title: 'Task center',
            subtitle: undefined,
            status: session.status,
            sections: [],
            timestamp: event.timestamp,
        };
        const index = appendItem(state, nextCard);
        state.taskCardIndex = index;
        return nextCard;
    }

    return card;
}

function commitTaskCard(state: BuildState, card: TaskCardItem): void {
    if (state.taskCardIndex === null) {
        return;
    }

    upsertItem(state, state.taskCardIndex, {
        ...card,
        sections: [...card.sections],
        tasks: card.tasks ? [...card.tasks] : undefined,
    });
}

function setTaskList(card: TaskCardItem, tasks: TaskCardTask[]): void {
    if (tasks.length === 0) {
        card.tasks = undefined;
        card.workflow = 'single';
        return;
    }

    card.tasks = tasks;
    card.workflow = inferWorkflow(tasks);
}

function toTaskStatus(value: unknown): PlanStep['status'] {
    const normalized = typeof value === 'string' ? value : 'pending';
    switch (normalized) {
        case 'pending':
        case 'in_progress':
        case 'complete':
        case 'completed':
        case 'skipped':
        case 'failed':
        case 'blocked':
            return normalized;
        default:
            return 'pending';
    }
}

function processEvent(state: BuildState, session: TaskSession, event: TaskSession['events'][number]): void {
    const payload = event.payload as Record<string, any>;

    switch (event.type) {
        case 'TASK_STARTED': {
            const content = normalizeTaskStartedText(payload.context?.userQuery || payload.description);
            if (content) {
                appendItem(state, {
                    type: 'user_message',
                    id: event.id,
                    content,
                    timestamp: event.timestamp,
                });
            }

            break;
        }

        case 'CHAT_MESSAGE': {
            const role = payload.role || 'system';
            if (role === 'user') {
                appendItem(state, {
                    type: 'user_message',
                    id: event.id,
                    content: payload.content,
                    timestamp: event.timestamp,
                });
                state.currentDraftIndex = null;
                break;
            }

            if (state.hasTaskContext) {
                if (role === 'assistant') {
                    upsertPhaseBubble(state, 'execute', event, [payload.content], { mode: 'append', maxLines: 8 });
                    state.taskOutputDraft = '';
                } else {
                    const systemContent = String(payload.content ?? '').trim();
                    if (isRuntimeNoiseSystemEvent(systemContent)) {
                        break;
                    }
                    upsertPhaseBubble(state, 'execute', event, [systemContent], { mode: 'append', maxLines: 8 });
                }
                state.currentDraftIndex = null;
                break;
            }

            if (role === 'system') {
                const content = String(payload.content ?? '');
                if (!isRuntimeNoiseSystemEvent(content)) {
                    appendSystemEvent(state, event, content);
                }
                break;
            }

            const assistantItem: TimelineItemType = {
                type: 'assistant_message',
                id: event.id,
                content: payload.content,
                timestamp: event.timestamp,
                isStreaming: false,
            };

            if (state.currentDraftIndex !== null && state.items[state.currentDraftIndex]?.type === 'assistant_message') {
                upsertItem(state, state.currentDraftIndex, assistantItem);
            } else {
                appendItem(state, assistantItem);
            }
            state.currentDraftIndex = null;
            break;
        }

        case 'TEXT_DELTA': {
            if (payload.role === 'thinking') {
                return;
            }

            const delta = payload.delta || '';

            if (state.hasTaskContext) {
                state.taskOutputDraft += delta;
                upsertPhaseBubble(state, 'execute', event, [state.taskOutputDraft], {
                    mode: 'replace',
                    maxLines: 1,
                    isStreaming: session.status === 'running',
                });
                return;
            }

            if (state.currentDraftIndex !== null && state.items[state.currentDraftIndex]?.type === 'assistant_message') {
                const currentItem = state.items[state.currentDraftIndex] as Extract<TimelineItemType, { type: 'assistant_message' }>;
                upsertItem(state, state.currentDraftIndex, {
                    ...currentItem,
                    content: currentItem.content + delta,
                    isStreaming: session.status === 'running',
                });
            } else {
                state.currentDraftIndex = appendItem(state, {
                    type: 'assistant_message',
                    id: event.id,
                    content: delta,
                    timestamp: event.timestamp,
                    isStreaming: session.status === 'running',
                });
            }
            break;
        }

        case 'TASK_STATUS': {
            const status = typeof payload.status === 'string' ? payload.status as TaskSession['status'] : session.status;
            if (!state.hasTaskContext) {
                break;
            }
            const card = ensureTaskCard(state, session, event);
            card.status = status;
            if (status === 'running') {
                card.collaboration = undefined;
                upsertPhaseBubble(state, 'execute', event, [`Status: ${mapStatusLabel(status)}`], { mode: 'append', maxLines: 8 });
            }
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_PLAN_READY': {
            const mode = normalizeText(payload.mode) as TaskSession['taskMode'] | '';
            state.isChatMode = mode === 'chat' || session.taskMode === 'chat';
            const explicitTaskIntent = hasExplicitTaskIntent(payload.intentRouting);
            state.taskIntentExplicit = explicitTaskIntent;
            state.hasTaskContext = explicitTaskIntent;
            if (state.isChatMode || !explicitTaskIntent) {
                state.hasTaskContext = false;
                break;
            }

            const card = ensureTaskCard(state, session, event);
            card.subtitle = normalizeText(payload.summary) || card.subtitle;

            const tasks = ((Array.isArray(payload.tasks) ? payload.tasks : []) as Array<Record<string, unknown>>)
                .map((task) => ({
                    id: normalizeText(task.id),
                    title: normalizeText(task.title) || normalizeText(task.objective) || 'Task',
                    status: 'pending' as PlanStep['status'],
                    dependencies: normalizeLines(Array.isArray(task.dependencies) ? task.dependencies : []),
                }))
                .filter((task) => task.id.length > 0);

            if (tasks.length > 0) {
                state.taskById = new Map(tasks.map((task) => [task.id, task]));
                setTaskList(card, tasks);
            }

            const deliverableLines = ((Array.isArray(payload.deliverables) ? payload.deliverables : []) as Array<Record<string, unknown>>)
                .map((deliverable) => {
                    const title = normalizeText(deliverable.title);
                    const path = normalizeText(deliverable.path);
                    const description = normalizeText(deliverable.description);
                    if (path) return `${title || 'Deliverable'}: ${path}`;
                    if (description) return `${title || 'Deliverable'}: ${description}`;
                    return title || '';
                });
            const checkpointLines = ((Array.isArray(payload.checkpoints) ? payload.checkpoints : []) as Array<Record<string, unknown>>)
                .map((checkpoint) => {
                    const title = normalizeText(checkpoint.title);
                    const reason = normalizeText(checkpoint.reason);
                    return reason ? `${title || 'Checkpoint'}: ${reason}` : title;
                });
            const userActionLines = ((Array.isArray(payload.userActionsRequired) ? payload.userActionsRequired : []) as Array<Record<string, unknown>>)
                .map((action) => {
                    const title = normalizeText(action.title);
                    const description = normalizeText(action.description);
                    return description ? `${title || 'Action'}: ${description}` : title;
                });
            const missingInfoLines = ((Array.isArray(payload.missingInfo) ? payload.missingInfo : []) as Array<Record<string, unknown>>)
                .map((entry) => {
                    const field = normalizeText(entry.field);
                    const question = normalizeText(entry.question);
                    const reason = normalizeText(entry.reason);
                    return question || reason ? `${field || 'Item'}: ${question || reason}` : field;
                });

            upsertPhaseBubble(state, 'plan', event, [
                normalizeText(payload.summary),
                ...tasks.map((task) => `Task: ${task.title}`),
                ...deliverableLines,
                ...checkpointLines,
                ...userActionLines,
                ...missingInfoLines,
            ], { mode: 'replace', maxLines: 10 });

            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'PLAN_UPDATED': {
            if (state.isChatMode || !state.hasTaskContext) {
                break;
            }

            const card = ensureTaskCard(state, session, event);
            upsertPhaseBubble(state, 'execute', event, [payload.summary], { mode: 'append', maxLines: 10 });
            const taskProgress = ((Array.isArray(payload.taskProgress) ? payload.taskProgress : []) as Array<Record<string, unknown>>)
                .map((entry) => ({
                    id: normalizeText(entry.taskId),
                    title: normalizeText(entry.title),
                    status: toTaskStatus(entry.status),
                    dependencies: normalizeLines(Array.isArray(entry.dependencies) ? entry.dependencies : []),
                }))
                .filter((entry) => entry.id.length > 0);

            if (taskProgress.length > 0) {
                for (const entry of taskProgress) {
                    const existing = state.taskById.get(entry.id);
                    state.taskById.set(entry.id, {
                        id: entry.id,
                        title: entry.title || existing?.title || 'Task',
                        status: entry.status,
                        dependencies: entry.dependencies.length > 0 ? entry.dependencies : (existing?.dependencies ?? []),
                    });
                }
                setTaskList(card, Array.from(state.taskById.values()));
            }

            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_RESEARCH_UPDATED': {
            if (state.isChatMode || !state.taskIntentExplicit) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            card.subtitle = normalizeText(payload.summary) || card.subtitle;
            upsertPhaseBubble(state, 'thinking', event, [
                normalizeText(payload.summary),
                ...(Array.isArray(payload.sourcesChecked) ? payload.sourcesChecked : []),
                ...(Array.isArray(payload.blockingUnknowns) ? payload.blockingUnknowns : []),
            ], { mode: 'append', maxLines: 10 });
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_CONTRACT_REOPENED': {
            if (state.isChatMode || !state.taskIntentExplicit) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            card.subtitle = normalizeText(payload.summary) || normalizeText(payload.reason) || card.subtitle;
            const changedFields = Array.isArray(payload.diff?.changedFields)
                ? payload.diff.changedFields.filter((field: unknown): field is string => typeof field === 'string')
                : [];
            const diff = payload.diff as Record<string, any> | undefined;
            const diffLines = [
                diff?.modeChanged
                    ? `Mode: ${normalizeText(diff.modeChanged.before)} -> ${normalizeText(diff.modeChanged.after)}`
                    : '',
                diff?.objectiveChanged
                    ? `Objective: ${normalizeText(diff.objectiveChanged.before)} -> ${normalizeText(diff.objectiveChanged.after)}`
                    : '',
                diff?.deliverablesChanged
                    ? `Deliverables: ${(Array.isArray(diff.deliverablesChanged.before) ? diff.deliverablesChanged.before.join(', ') : 'none')} -> ${(Array.isArray(diff.deliverablesChanged.after) ? diff.deliverablesChanged.after.join(', ') : 'none')}`
                    : '',
                diff?.targetsChanged
                    ? `Targets: ${(Array.isArray(diff.targetsChanged.before) ? diff.targetsChanged.before.join(', ') : 'none')} -> ${(Array.isArray(diff.targetsChanged.after) ? diff.targetsChanged.after.join(', ') : 'none')}`
                    : '',
                diff?.workflowsChanged
                    ? `Workflow: ${(Array.isArray(diff.workflowsChanged.before) ? diff.workflowsChanged.before.join(', ') : 'none')} -> ${(Array.isArray(diff.workflowsChanged.after) ? diff.workflowsChanged.after.join(', ') : 'none')}`
                    : '',
            ];
            upsertPhaseBubble(state, 'thinking', event, [
                normalizeText(payload.reason),
                ...changedFields.map((field: string) => `Changed: ${field}`),
                ...diffLines,
            ], { mode: 'append', maxLines: 10 });
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_CHECKPOINT_REACHED': {
            if (state.isChatMode || !state.taskIntentExplicit) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            card.subtitle = normalizeText(payload.userMessage) || normalizeText(payload.reason) || card.subtitle;
            upsertPhaseBubble(state, 'execute', event, [
                [normalizeText(payload.title), normalizeText(payload.reason)].filter(Boolean).join(': '),
                normalizeText(payload.userMessage),
            ], { mode: 'append', maxLines: 10 });
            card.collaboration = {
                actionId: normalizeText(payload.checkpointId),
                title: normalizeText(payload.title) || 'Checkpoint reached',
                description: normalizeText(payload.userMessage) || normalizeText(payload.reason),
                blocking: Boolean(payload.blocking),
                questions: [],
                instructions: [],
                action: {
                    label: 'Continue',
                },
            };
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_USER_ACTION_REQUIRED': {
            if (state.isChatMode || !state.taskIntentExplicit) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            const questions = normalizeLines(Array.isArray(payload.questions) ? payload.questions : []);
            const instructions = normalizeLines(Array.isArray(payload.instructions) ? payload.instructions : []);
            card.subtitle = normalizeText(payload.description) || card.subtitle;
            upsertPhaseBubble(state, 'execute', event, [
                normalizeText(payload.description),
                ...questions,
                ...instructions,
            ], { mode: 'append', maxLines: 10 });
            card.collaboration = {
                actionId: normalizeText(payload.actionId),
                title: normalizeText(payload.title) || 'User action required',
                description: normalizeText(payload.description),
                blocking: Boolean(payload.blocking),
                questions,
                instructions,
                input: {
                    placeholder: questions[0] || 'Enter your response for this task...',
                    submitLabel: 'Submit and continue',
                },
                action: {
                    label: 'Continue',
                },
            };
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_CLARIFICATION_REQUIRED': {
            if (state.isChatMode || !state.taskIntentExplicit) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            const questions = normalizeLines(Array.isArray(payload.questions) ? payload.questions : []);
            const missingFields = normalizeLines(Array.isArray(payload.missingFields) ? payload.missingFields : []);
            const clarificationType = normalizeText(payload.clarificationType);
            const isRouteDisambiguation = clarificationType === 'route_disambiguation';
            const isTaskDraftConfirmation = clarificationType === 'task_draft_confirmation';
            card.subtitle = normalizeText(payload.reason) || (
                isRouteDisambiguation
                    ? 'Choose response mode'
                    : isTaskDraftConfirmation
                        ? 'Task draft confirmation required'
                        : 'Clarification required'
            );
            upsertPhaseBubble(state, 'execute', event, [
                normalizeText(payload.reason),
                ...(isRouteDisambiguation
                    ? ['Route choice needed']
                    : isTaskDraftConfirmation
                        ? ['Draft confirmation needed']
                        : ['Clarification needed']),
                ...questions,
                ...missingFields.map((field) => `Missing: ${field}`),
            ], { mode: 'append', maxLines: 12 });
            if (isRouteDisambiguation || isTaskDraftConfirmation) {
                const routeChoices = ((Array.isArray(payload.routeChoices) ? payload.routeChoices : []) as Array<Record<string, unknown>>)
                    .map((choice) => ({
                        label: normalizeText(choice.label),
                        value: normalizeText(choice.value),
                    }))
                    .filter((choice) => choice.label.length > 0 && choice.value.length > 0);
                card.collaboration = {
                    actionId: isTaskDraftConfirmation ? 'task_draft_confirm' : 'intent_route',
                    title: isTaskDraftConfirmation ? '任务草稿确认' : '选择处理方式',
                    description: normalizeText(payload.reason),
                    blocking: true,
                    questions,
                    instructions: isTaskDraftConfirmation
                        ? ['可直接确认创建，或先输入修改内容后点击“编辑后创建”。']
                        : [],
                    input: isTaskDraftConfirmation
                        ? {
                            placeholder: '输入修改后的任务说明（可选）',
                            submitLabel: '编辑后创建',
                        }
                        : undefined,
                    choices: routeChoices,
                };
            } else {
                card.collaboration = {
                    actionId: normalizeText(payload.reason) || 'clarification',
                    title: 'Clarification required',
                    description: normalizeText(payload.reason),
                    blocking: true,
                    questions,
                    instructions: [],
                    input: {
                        placeholder: questions[0] || 'Provide clarification to continue...',
                        submitLabel: 'Submit clarification',
                    },
                };
            }
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TOOL_CALLED': {
            if (!state.isChatMode && state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                const toolName = normalizeText(payload.toolName) || 'Tool';
                const toolId = normalizeText(payload.toolId) || event.id;
                state.toolNameById.set(toolId, toolName);
                upsertPhaseBubble(state, 'execute', event, [`Running: ${toolName}`], { mode: 'append', maxLines: 12 });
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            const toolItem: TimelineItemType & { type: 'tool_call' } = {
                type: 'tool_call',
                id: payload.toolId || event.id,
                toolName: payload.toolName,
                args: payload.args,
                status: 'running',
                timestamp: event.timestamp,
            };
            const index = appendItem(state, toolItem);
            state.toolIndex.set(toolItem.id, index);
            state.currentDraftIndex = null;
            break;
        }

        case 'TOOL_RESULT': {
            if (!state.isChatMode && state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                const toolName = state.toolNameById.get(normalizeText(payload.toolId)) || 'Tool';
                const resultLabel = payload.success ? 'Completed' : `Failed: ${normalizeText(payload.error) || 'unknown error'}`;
                upsertPhaseBubble(state, 'execute', event, [`${toolName}: ${resultLabel}`], { mode: 'append', maxLines: 12 });
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            const matchingIndex = state.toolIndex.get(payload.toolId);
            if (matchingIndex !== undefined) {
                const currentItem = state.items[matchingIndex];
                if (currentItem?.type === 'tool_call') {
                    upsertItem(state, matchingIndex, {
                        ...currentItem,
                        status: payload.success ? 'success' : 'failed',
                        result: payload.result || payload.error,
                    });
                }
            }
            break;
        }

        case 'EFFECT_REQUESTED': {
            if (!state.isChatMode && state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                const req = payload.request;
                upsertPhaseBubble(state, 'execute', event, [`Requested: ${normalizeText(req?.effectType) || 'effect'} (risk ${String(payload.riskLevel ?? 'n/a')})`], { mode: 'append', maxLines: 12 });
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            const req = payload.request;
            const effItem: TimelineItemType & { type: 'effect_request' } = {
                type: 'effect_request',
                id: req.id,
                effectType: req.effectType,
                risk: payload.riskLevel,
                timestamp: event.timestamp,
            };
            const index = appendItem(state, effItem);
            state.effectIndex.set(effItem.id, index);
            break;
        }

        case 'EFFECT_APPROVED':
        case 'EFFECT_DENIED': {
            if (!state.isChatMode && state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                const response = payload.response as Record<string, unknown>;
                const requestId = normalizeText(response?.requestId);
                upsertPhaseBubble(state, 'execute', event, [
                    `${requestId || 'Effect request'}: ${event.type === 'EFFECT_APPROVED' ? 'Approved' : 'Denied'}`,
                ], { mode: 'append', maxLines: 12 });
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            const resp = payload.response;
            const effIndex = state.effectIndex.get(resp.requestId);
            if (effIndex !== undefined) {
                const currentItem = state.items[effIndex];
                if (currentItem?.type === 'effect_request') {
                    upsertItem(state, effIndex, {
                        ...currentItem,
                        approved: event.type === 'EFFECT_APPROVED',
                    });
                }
            }
            break;
        }

        case 'PATCH_PROPOSED': {
            if (!state.isChatMode && state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                const patch = payload.patch as Record<string, unknown>;
                upsertPhaseBubble(state, 'execute', event, [
                    `Proposed: ${normalizeText(patch.filePath) || 'unknown file'}`,
                ], { mode: 'append', maxLines: 12 });
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            const patchItem: TimelineItemType & { type: 'patch' } = {
                type: 'patch',
                id: payload.patch.id,
                filePath: payload.patch.filePath,
                status: 'proposed',
                timestamp: event.timestamp,
            };
            const index = appendItem(state, patchItem);
            state.patchIndex.set(patchItem.id, index);
            break;
        }

        case 'PATCH_APPLIED':
        case 'PATCH_REJECTED': {
            if (!state.isChatMode && state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                const filePath = normalizeText(payload.filePath);
                const statusLabel = event.type === 'PATCH_APPLIED' ? 'Applied' : 'Rejected';
                upsertPhaseBubble(state, 'execute', event, [
                    `${statusLabel}: ${filePath || normalizeText(payload.patchId) || 'patch'}`,
                ], { mode: 'append', maxLines: 12 });
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            const patchIndex = state.patchIndex.get(payload.patchId);
            if (patchIndex !== undefined) {
                const currentItem = state.items[patchIndex];
                if (currentItem?.type === 'patch') {
                    upsertItem(state, patchIndex, {
                        ...currentItem,
                        status: event.type === 'PATCH_APPLIED' ? 'applied' : 'rejected',
                    });
                }
            }
            break;
        }

        case 'RATE_LIMITED': {
            if (!state.isChatMode && state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                upsertPhaseBubble(state, 'execute', event, [
                    payload.message || `Rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`,
                ], { mode: 'append', maxLines: 12 });
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            appendSystemEvent(state, event, payload.message || `API rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`);
            break;
        }

        case 'TASK_FINISHED': {
            if (state.isChatMode || !state.hasTaskContext) {
                const normalizedSummary = normalizeText(payload.summary);
                const summaryComparable = normalizeComparableText(payload.summary);

                if (state.currentDraftIndex !== null) {
                    const draftItem = state.items[state.currentDraftIndex];
                    if (draftItem?.type === 'assistant_message') {
                        upsertItem(state, state.currentDraftIndex, {
                            ...draftItem,
                            content: normalizedSummary || draftItem.content,
                            timestamp: event.timestamp,
                            isStreaming: false,
                        });
                        state.currentDraftIndex = null;
                        state.taskOutputDraft = '';
                        break;
                    }
                }

                const lastIndex = state.items.length - 1;
                const lastItem = lastIndex >= 0 ? state.items[lastIndex] : undefined;
                const canReuseLastAssistant = lastItem?.type === 'assistant_message'
                    && summaryComparable.length > 0
                    && normalizeComparableText(lastItem.content) === summaryComparable;

                if (canReuseLastAssistant && lastItem?.type === 'assistant_message') {
                    upsertItem(state, lastIndex, {
                        ...lastItem,
                        content: normalizedSummary || lastItem.content,
                        timestamp: event.timestamp,
                        isStreaming: false,
                    });
                } else if (normalizedSummary) {
                    appendItem(state, {
                        type: 'assistant_message',
                        id: `${event.id}-assistant`,
                        content: normalizedSummary,
                        timestamp: event.timestamp,
                        isStreaming: false,
                    });
                }
                state.currentDraftIndex = null;
                state.taskOutputDraft = '';
                break;
            }

            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            card.status = 'finished';
            card.result = {
                summary: normalizeText(payload.summary),
                artifacts: normalizeLines(Array.isArray(payload.artifactsCreated) ? payload.artifactsCreated : []),
                files: normalizeLines(Array.isArray(payload.filesModified) ? payload.filesModified : []),
            };
            card.collaboration = undefined;
            const completedTasks = Array.from(state.taskById.values()).map((task) => ({
                ...task,
                status: (task.status === 'failed' ? 'failed' : 'completed') as PlanStep['status'],
            }));
            if (completedTasks.length > 0) {
                state.taskById = new Map(completedTasks.map((task) => [task.id, task]));
                setTaskList(card, completedTasks);
            }
            upsertPhaseBubble(state, 'summary', event, [
                `Status: ${mapStatusLabel('finished')}`,
                normalizeText(payload.summary),
                ...(card.result.artifacts ?? []).map((artifact) => `Artifact: ${artifact}`),
                ...(card.result.files ?? []).map((file) => `File changed: ${file}`),
            ], { mode: 'replace', maxLines: 12 });
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            state.currentDraftIndex = null;
            state.taskOutputDraft = '';
            break;
        }

        case 'TASK_FAILED': {
            if (state.isChatMode || !state.hasTaskContext) {
                const error = normalizeText(payload.error);
                const suggestion = normalizeText(payload.suggestion);
                appendSystemEvent(state, event, error ? `Task failed: ${error}` : 'Task failed');
                if (suggestion) {
                    appendSystemEvent(state, event, suggestion);
                }
                state.currentDraftIndex = null;
                state.taskOutputDraft = '';
                break;
            }

            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            card.status = 'failed';
            card.result = {
                error: normalizeText(payload.error) || 'Unknown error',
                suggestion: normalizeText(payload.suggestion),
            };
            card.collaboration = undefined;
            upsertPhaseBubble(state, 'summary', event, [
                `Status: ${mapStatusLabel('failed')}`,
                card.result.error,
                card.result.suggestion,
            ], { mode: 'replace', maxLines: 12 });
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            state.currentDraftIndex = null;
            state.taskOutputDraft = '';
            break;
        }

        default:
            break;
    }
}

export function buildTimelineItems(
    session: TaskSession,
    maxRecentEvents?: number,
): TimelineItemsResult {
    const sourceEvents = typeof maxRecentEvents === 'number' && maxRecentEvents > 0
        ? session.events.slice(Math.max(0, session.events.length - maxRecentEvents))
        : session.events;

    const state: BuildState = {
        items: [],
        taskCardIndex: null,
        hasTaskContext: false,
        isChatMode: session.taskMode === 'chat',
        taskIntentExplicit: false,
        currentDraftIndex: null,
        taskOutputDraft: '',
        toolIndex: new Map(),
        effectIndex: new Map(),
        patchIndex: new Map(),
        toolNameById: new Map(),
        taskById: new Map(),
        phaseItemIndex: {},
        phaseLines: {
            plan: [],
            thinking: [],
            execute: [],
            summary: [],
        },
    };

    for (const event of sourceEvents) {
        processEvent(state, session, event);
    }

    if (state.taskCardIndex !== null) {
        const current = state.items[state.taskCardIndex];
        if (current?.type === 'task_card' && current.status !== session.status) {
            const nextCard: TaskCardItem = {
                ...current,
                status: session.status,
                timestamp: session.updatedAt,
            };
            if (session.status === 'running') {
                nextCard.collaboration = undefined;
            }
            state.items[state.taskCardIndex] = nextCard;
        }
    }

    return {
        items: state.items,
        hiddenEventCount: session.events.length - sourceEvents.length,
    };
}

/**
 * Process session events into timeline items
 */
export function useTimelineItems(session: TaskSession, maxRecentEvents?: number): TimelineItemsResult {
    return useMemo(() => buildTimelineItems(session, maxRecentEvents), [maxRecentEvents, session]);
}
