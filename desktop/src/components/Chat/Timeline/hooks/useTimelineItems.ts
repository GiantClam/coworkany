/**
 * useTimelineItems Hook
 *
 * Transforms TaskSession events into TimelineItems for display.
 * Task-related state is consolidated into a single task center card.
 */

import { useMemo } from 'react';
import type { PlanStep, TaskCardItem, TaskSession, TimelineItemType } from '../../../../types';

export interface TimelineItemsResult {
    items: TimelineItemType[];
    hiddenEventCount: number;
}

type TaskCardTask = NonNullable<TaskCardItem['tasks']>[number];

type BuildState = {
    items: TimelineItemType[];
    taskCardIndex: number | null;
    hasTaskContext: boolean;
    isChatMode: boolean;
    currentDraftIndex: number | null;
    taskOutputDraft: string;
    toolIndex: Map<string, number>;
    effectIndex: Map<string, number>;
    patchIndex: Map<string, number>;
    toolNameById: Map<string, string>;
    taskById: Map<string, TaskCardTask>;
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

function upsertTaskCardSection(
    card: TaskCardItem,
    label: string,
    lines: unknown[],
    mode: 'replace' | 'append' = 'replace',
    maxLines: number = 8,
): void {
    const normalizedLabel = normalizeText(label);
    if (!normalizedLabel) {
        return;
    }

    const normalized = normalizeLines(Array.isArray(lines) ? lines : []);
    const index = card.sections.findIndex((section) => section.label.toLowerCase() === normalizedLabel.toLowerCase());

    if (mode === 'replace') {
        if (normalized.length === 0) {
            if (index >= 0) {
                card.sections.splice(index, 1);
            }
            return;
        }

        const nextSection = {
            label: normalizedLabel,
            lines: normalized,
        };
        if (index >= 0) {
            card.sections[index] = nextSection;
        } else {
            card.sections.push(nextSection);
        }
        return;
    }

    const existing = index >= 0 ? card.sections[index].lines : [];
    const merged = Array.from(new Set([...existing, ...normalized])).slice(-maxLines);
    if (merged.length === 0) {
        if (index >= 0) {
            card.sections.splice(index, 1);
        }
        return;
    }

    const nextSection = {
        label: normalizedLabel,
        lines: merged,
    };
    if (index >= 0) {
        card.sections[index] = nextSection;
    } else {
        card.sections.push(nextSection);
    }
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
            const content = payload.context?.userQuery || payload.description;
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
                const card = ensureTaskCard(state, session, event);
                if (role === 'assistant') {
                    upsertTaskCardSection(card, 'Process · Assistant output', [payload.content], 'append', 6);
                    state.taskOutputDraft = '';
                } else {
                    upsertTaskCardSection(card, 'Process · System updates', [payload.content], 'append', 6);
                }
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                state.currentDraftIndex = null;
                break;
            }

            if (role === 'system') {
                appendSystemEvent(state, event, String(payload.content ?? ''));
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
                const card = ensureTaskCard(state, session, event);
                state.taskOutputDraft += delta;
                upsertTaskCardSection(card, 'Process · Assistant output', [state.taskOutputDraft], 'replace');
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
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
            if (state.isChatMode && !state.hasTaskContext) {
                break;
            }
            if (state.hasTaskContext) {
                const card = ensureTaskCard(state, session, event);
                card.status = status;
                if (status === 'running') {
                    card.collaboration = undefined;
                }
                upsertTaskCardSection(card, 'Task · Status', [`Status: ${mapStatusLabel(status)}`], 'replace');
                card.timestamp = event.timestamp;
                commitTaskCard(state, card);
                break;
            }

            const statusLabel = status === 'running'
                ? 'Status updated: in progress'
                : status === 'finished'
                    ? 'Status updated: completed'
                    : status === 'failed'
                        ? 'Status updated: failed'
                        : status === 'idle'
                            ? 'Status updated: waiting'
                            : '';
            appendSystemEvent(state, event, statusLabel);
            break;
        }

        case 'TASK_PLAN_READY': {
            const mode = normalizeText(payload.mode) as TaskSession['taskMode'] | '';
            state.isChatMode = mode === 'chat' || session.taskMode === 'chat';
            if (state.isChatMode) {
                state.hasTaskContext = false;
                break;
            }

            state.hasTaskContext = true;
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

            upsertTaskCardSection(card, 'Plan · Deliverables', ((Array.isArray(payload.deliverables) ? payload.deliverables : []) as Array<Record<string, unknown>>)
                .map((deliverable) => {
                    const title = normalizeText(deliverable.title);
                    const path = normalizeText(deliverable.path);
                    const description = normalizeText(deliverable.description);
                    if (path) return `${title || 'Deliverable'}: ${path}`;
                    if (description) return `${title || 'Deliverable'}: ${description}`;
                    return title || '';
                }), 'replace');

            upsertTaskCardSection(card, 'Plan · Checkpoints', ((Array.isArray(payload.checkpoints) ? payload.checkpoints : []) as Array<Record<string, unknown>>)
                .map((checkpoint) => {
                    const title = normalizeText(checkpoint.title);
                    const reason = normalizeText(checkpoint.reason);
                    return reason ? `${title || 'Checkpoint'}: ${reason}` : title;
                }), 'replace');

            upsertTaskCardSection(card, 'Plan · User actions', ((Array.isArray(payload.userActionsRequired) ? payload.userActionsRequired : []) as Array<Record<string, unknown>>)
                .map((action) => {
                    const title = normalizeText(action.title);
                    const description = normalizeText(action.description);
                    return description ? `${title || 'Action'}: ${description}` : title;
                }), 'replace');

            upsertTaskCardSection(card, 'Plan · Needs from you', ((Array.isArray(payload.missingInfo) ? payload.missingInfo : []) as Array<Record<string, unknown>>)
                .map((entry) => {
                    const field = normalizeText(entry.field);
                    const question = normalizeText(entry.question);
                    const reason = normalizeText(entry.reason);
                    return question || reason ? `${field || 'Item'}: ${question || reason}` : field;
                }), 'replace');

            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'PLAN_UPDATED': {
            if (state.isChatMode || !state.hasTaskContext) {
                break;
            }

            const card = ensureTaskCard(state, session, event);
            upsertTaskCardSection(card, 'Process · Plan updates', [payload.summary], 'append', 8);
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
            if (state.isChatMode) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            card.subtitle = normalizeText(payload.summary) || card.subtitle;
            upsertTaskCardSection(card, 'Research · Sources checked', Array.isArray(payload.sourcesChecked) ? payload.sourcesChecked : [], 'replace');
            upsertTaskCardSection(card, 'Research · Blocking unknowns', Array.isArray(payload.blockingUnknowns) ? payload.blockingUnknowns : [], 'replace');
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_CONTRACT_REOPENED': {
            if (state.isChatMode) {
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
            upsertTaskCardSection(card, 'Contract · Reason', payload.reason ? [payload.reason] : [], 'replace');
            upsertTaskCardSection(card, 'Contract · Changed fields', changedFields, 'replace');
            upsertTaskCardSection(card, 'Contract · Diff', diffLines, 'replace');
            card.timestamp = event.timestamp;
            commitTaskCard(state, card);
            break;
        }

        case 'TASK_CHECKPOINT_REACHED': {
            if (state.isChatMode) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            card.subtitle = normalizeText(payload.userMessage) || normalizeText(payload.reason) || card.subtitle;
            upsertTaskCardSection(card, 'Checkpoint · Current', [[normalizeText(payload.title), normalizeText(payload.reason)].filter(Boolean).join(': ')], 'replace');
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
            if (state.isChatMode) {
                break;
            }
            state.hasTaskContext = true;
            const card = ensureTaskCard(state, session, event);
            const questions = normalizeLines(Array.isArray(payload.questions) ? payload.questions : []);
            const instructions = normalizeLines(Array.isArray(payload.instructions) ? payload.instructions : []);
            card.subtitle = normalizeText(payload.description) || card.subtitle;
            upsertTaskCardSection(card, 'Action · Questions', questions, 'replace');
            upsertTaskCardSection(card, 'Action · Instructions', instructions, 'replace');
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
            if (state.isChatMode) {
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
            upsertTaskCardSection(
                card,
                isRouteDisambiguation
                    ? 'Action · Route choices'
                    : isTaskDraftConfirmation
                        ? 'Action · Draft confirmation'
                        : 'Action · Clarification questions',
                questions,
                'replace',
            );
            upsertTaskCardSection(card, 'Action · Missing fields', missingFields, 'replace');
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
                upsertTaskCardSection(card, 'Process · Tool activity', [`Running: ${toolName}`], 'append', 8);
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
                upsertTaskCardSection(card, 'Process · Tool activity', [`${toolName}: ${resultLabel}`], 'append', 8);
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
                upsertTaskCardSection(card, 'Process · Effect requests', [`Requested: ${normalizeText(req?.effectType) || 'effect'} (risk ${String(payload.riskLevel ?? 'n/a')})`], 'append', 6);
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
                upsertTaskCardSection(card, 'Process · Effect requests', [
                    `${requestId || 'Effect request'}: ${event.type === 'EFFECT_APPROVED' ? 'Approved' : 'Denied'}`,
                ], 'append', 6);
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
                upsertTaskCardSection(card, 'Process · Patches', [
                    `Proposed: ${normalizeText(patch.filePath) || 'unknown file'}`,
                ], 'append', 6);
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
                upsertTaskCardSection(card, 'Process · Patches', [
                    `${statusLabel}: ${filePath || normalizeText(payload.patchId) || 'patch'}`,
                ], 'append', 6);
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
                upsertTaskCardSection(card, 'Process · Runtime notices', [
                    payload.message || `Rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`,
                ], 'append', 5);
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
                if (normalizedSummary) {
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
            upsertTaskCardSection(card, 'Task · Status', [`Status: ${mapStatusLabel('finished')}`], 'replace');
            upsertTaskCardSection(card, 'Result · Summary', [payload.summary], 'replace');
            upsertTaskCardSection(card, 'Result · Artifacts', card.result.artifacts ?? [], 'replace');
            upsertTaskCardSection(card, 'Result · Files changed', card.result.files ?? [], 'replace');
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
            upsertTaskCardSection(card, 'Task · Status', [`Status: ${mapStatusLabel('failed')}`], 'replace');
            upsertTaskCardSection(card, 'Result · Error', [
                card.result.error,
                card.result.suggestion,
            ], 'replace');
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
        hasTaskContext: Boolean(session.taskMode && session.taskMode !== 'chat'),
        isChatMode: session.taskMode === 'chat',
        currentDraftIndex: null,
        taskOutputDraft: '',
        toolIndex: new Map(),
        effectIndex: new Map(),
        patchIndex: new Map(),
        toolNameById: new Map(),
        taskById: new Map(),
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
            upsertTaskCardSection(nextCard, 'Task · Status', [`Status: ${mapStatusLabel(session.status)}`], 'replace');
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
