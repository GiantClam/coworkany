import { AUTH_OPEN_PAGE_PREFIX } from '../../collaborationMessage';
import { sanitizeDisplayText, sanitizeNoiseText } from '../textSanitizer';
import type { AssistantTurnItem, AssistantTurnStep, PlanStep, TaskCardItem, TaskSession, TimelineItemType } from '../../../../types';
import {
    buildPlannedTaskList,
    buildPlanSummaryLines,
    buildAssistantTurnSteps,
    cleanTaskCardTitle,
    hasExplicitTaskIntent,
    isProceduralLead,
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

type BuildState = {
    items: TimelineItemType[];
    taskCardIndex: number | null;
    hasTaskContext: boolean;
    isChatMode: boolean;
    isScheduledSession: boolean;
    taskIntentExplicit: boolean;
    currentDraftIndex: number | null;
    toolIndex: Map<string, number>;
    effectIndex: Map<string, number>;
    patchIndex: Map<string, number>;
    toolNameById: Map<string, string>;
    taskById: Map<string, TaskCardTask>;
    phaseLines: Record<TaskPhaseKey, string[]>;
};

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

const UUID_V4_TOKEN_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const CONTROL_REPLY_WITH_UUID_SUFFIX_REGEX = new RegExp(
    `^(继续执行|继续处理|继续吧|继续|接着|往下|continue|go on|carry on|keep going|proceed)\\s*[（(]\\s*${UUID_V4_TOKEN_PATTERN}\\s*[）)]\\s*([.!?？。!]*)$`,
    'i'
);

function normalizeUserMessageText(content: unknown): string {
    const text = normalizeText(content);
    if (!text) {
        return '';
    }

    const match = text.match(CONTROL_REPLY_WITH_UUID_SUFFIX_REGEX);
    if (!match) {
        return text;
    }

    const command = match[1] || text;
    const punctuation = match[2] || '';
    return `${command}${punctuation}`.trim();
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

function formatResumeReasonNotice(reason: unknown): string | null {
    const normalized = normalizeText(reason);
    if (normalized === 'capability_review_approved') {
        return 'Approved the generated capability and resumed the original task.';
    }
    return null;
}

function upsertPhaseBubble(
    state: BuildState,
    phase: TaskPhaseKey,
    _event: TaskSession['events'][number],
    lines: unknown[],
    options?: { mode?: 'replace' | 'append'; maxLines?: number },
): void {
    const normalized = normalizeLines(Array.isArray(lines) ? lines : []);
    if (normalized.length === 0) {
        return;
    }

    const mode = options?.mode ?? 'append';
    const maxLines = options?.maxLines ?? 8;
    const existing = state.phaseLines[phase] ?? [];
    const merged = mode === 'replace'
        ? normalized.slice(-maxLines)
        : Array.from(new Set([...existing, ...normalized])).slice(-maxLines);
    state.phaseLines[phase] = merged;
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
        syncTaskCardExecutionProfile(nextCard, session);
        const index = appendItem(state, nextCard);
        state.taskCardIndex = index;
        return nextCard;
    }

    syncTaskCardExecutionProfile(card, session);
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

function hasTaskCardContext(state: BuildState): boolean {
    return !state.isChatMode && state.hasTaskContext;
}

function enterTaskIntentContext(state: BuildState): boolean {
    if (state.isChatMode || !state.taskIntentExplicit) {
        return false;
    }
    state.hasTaskContext = true;
    return true;
}

function updateTaskCard(
    state: BuildState,
    session: TaskSession,
    event: TaskSession['events'][number],
    updater: (card: TaskCardItem) => void,
): void {
    const card = ensureTaskCard(state, session, event);
    updater(card);
    syncTaskCardExecutionProfile(card, session);
    card.timestamp = event.timestamp;
    commitTaskCard(state, card);
}

function resetDraftState(state: BuildState): void {
    state.currentDraftIndex = null;
}

function isScheduledContext(state: BuildState, session: TaskSession): boolean {
    return state.isScheduledSession || isScheduledMode(session.taskMode);
}

function appendAssistantDelta(
    state: BuildState,
    event: TaskSession['events'][number],
    delta: string,
): void {
    if (!delta) {
        return;
    }

    if (state.currentDraftIndex !== null && state.items[state.currentDraftIndex]?.type === 'assistant_message') {
        const currentItem = state.items[state.currentDraftIndex] as Extract<TimelineItemType, { type: 'assistant_message' }>;
        upsertItem(state, state.currentDraftIndex, {
            ...currentItem,
            content: currentItem.content + delta,
        });
        return;
    }

    state.currentDraftIndex = appendItem(state, {
        type: 'assistant_message',
        id: event.id,
        content: delta,
        timestamp: event.timestamp,
    });
}

function finalizeAssistantMessage(
    state: BuildState,
    event: TaskSession['events'][number],
    content: string,
): void {
    if (!content.trim()) {
        resetDraftState(state);
        return;
    }

    const assistantItem: TimelineItemType = {
        type: 'assistant_message',
        id: event.id,
        content,
        timestamp: event.timestamp,
    };

    if (state.currentDraftIndex !== null && state.items[state.currentDraftIndex]?.type === 'assistant_message') {
        upsertItem(state, state.currentDraftIndex, assistantItem);
    } else {
        appendItem(state, assistantItem);
    }
    resetDraftState(state);
}

function shouldCreateCompactTaskCardOnFinish(
    state: BuildState,
    session: TaskSession,
    payload: Record<string, any>,
): boolean {
    if (state.hasTaskContext) {
        return true;
    }

    if (state.isChatMode || session.taskMode === 'chat') {
        return false;
    }

    if (isScheduledContext(state, session)) {
        return true;
    }

    const artifactsCreated = normalizeLines(Array.isArray(payload.artifactsCreated) ? payload.artifactsCreated : []);
    const filesModified = normalizeLines(Array.isArray(payload.filesModified) ? payload.filesModified : []);
    return artifactsCreated.length > 0 || filesModified.length > 0;
}

function collapseTaskThreadToAssistantTurn(
    items: TimelineItemType[],
    taskCardIndex: number | null,
    phaseLines: Record<TaskPhaseKey, string[]>,
): TimelineItemType[] {
    if (taskCardIndex === null) {
        return items;
    }
    const cardItem = items[taskCardIndex];
    if (!cardItem || cardItem.type !== 'task_card') {
        return items;
    }

    let start = taskCardIndex;
    while (start > 0 && items[start - 1]?.type !== 'user_message') {
        start -= 1;
    }
    let end = taskCardIndex;
    while (end < items.length - 1 && items[end + 1]?.type !== 'user_message') {
        end += 1;
    }

    const threadItems = items
        .slice(start, end + 1)
        .filter((item): item is AssistantThreadItem => item.type !== 'user_message' && item.type !== 'assistant_turn');
    const taskCard = [...threadItems]
        .reverse()
        .find((item): item is TaskCardItem => item.type === 'task_card');
    if (!taskCard) {
        return items;
    }

    const leadCandidates = [
        sanitizeDisplayText(taskCard.subtitle || ''),
        ...threadItems
            .filter((item): item is Extract<AssistantThreadItem, { type: 'assistant_message' }> => item.type === 'assistant_message')
            .map((item) => sanitizeDisplayText(item.content)),
    ].filter((entry) => entry.length > 0 && !isProceduralLead(entry));
    const lead = leadCandidates[0] || '';

    const messages = threadItems
        .filter((item): item is Extract<AssistantThreadItem, { type: 'assistant_message' }> => item.type === 'assistant_message')
        .map((item) => sanitizeNoiseText(item.content))
        .filter((entry) => entry.length > 0);

    const systemEvents = threadItems
        .filter((item): item is Extract<AssistantThreadItem, { type: 'system_event' }> => item.type === 'system_event')
        .map((item) => sanitizeDisplayText(item.content))
        .filter((entry) => entry.length > 0);

    const toolCalls = threadItems
        .filter((item): item is Extract<AssistantThreadItem, { type: 'tool_call' }> => item.type === 'tool_call');
    const effectRequests = threadItems
        .filter((item): item is Extract<AssistantThreadItem, { type: 'effect_request' }> => item.type === 'effect_request');
    const patches = threadItems
        .filter((item): item is Extract<AssistantThreadItem, { type: 'patch' }> => item.type === 'patch');

    const steps = buildAssistantTurnSteps(phaseLines, taskCard, threadItems);
    const lastItem = threadItems.at(-1);
    const timestamp = lastItem?.timestamp || taskCard.timestamp;
    const assistantTurn: AssistantTurnItem = {
        type: 'assistant_turn',
        id: `assistant-turn-${taskCard.taskId || taskCard.id}`,
        timestamp,
        lead,
        steps,
        messages,
        taskCard,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        effectRequests: effectRequests.length > 0 ? effectRequests : undefined,
        patches: patches.length > 0 ? patches : undefined,
        systemEvents: systemEvents.length > 0 ? systemEvents : undefined,
    };

    return [
        ...items.slice(0, start),
        assistantTurn,
        ...items.slice(end + 1),
    ];
}

type LegacyAssistantItem = Extract<
    TimelineItemType,
    { type: 'assistant_message' | 'tool_call' | 'system_event' | 'task_card' | 'effect_request' | 'patch' }
>;

function collapseLegacyAssistantRunsToTurns(
    items: TimelineItemType[],
    phaseLines: Record<TaskPhaseKey, string[]>,
): TimelineItemType[] {
    const output: TimelineItemType[] = [];
    let run: LegacyAssistantItem[] = [];

    const flushRun = () => {
        if (run.length === 0) {
            return;
        }

        const taskCard = [...run]
            .reverse()
            .find((item): item is TaskCardItem => item.type === 'task_card');
        const messages = run
            .filter((item): item is Extract<LegacyAssistantItem, { type: 'assistant_message' }> => item.type === 'assistant_message')
            .map((item) => sanitizeNoiseText(item.content))
            .filter((line) => line.length > 0);
        const systemEvents = run
            .filter((item): item is Extract<LegacyAssistantItem, { type: 'system_event' }> => item.type === 'system_event')
            .map((item) => sanitizeDisplayText(item.content))
            .filter((line) => line.length > 0);
        const toolCalls = run
            .filter((item): item is Extract<LegacyAssistantItem, { type: 'tool_call' }> => item.type === 'tool_call');
        const effectRequests = run
            .filter((item): item is Extract<LegacyAssistantItem, { type: 'effect_request' }> => item.type === 'effect_request');
        const patches = run
            .filter((item): item is Extract<LegacyAssistantItem, { type: 'patch' }> => item.type === 'patch');

        const leadCandidates = [
            sanitizeDisplayText(taskCard?.subtitle || ''),
            ...(taskCard ? messages.map((line) => sanitizeDisplayText(line)) : []),
        ].filter((line) => line.length > 0 && !isProceduralLead(line));
        const lead = leadCandidates[0] || '';

        let steps: AssistantTurnStep[] = [];
        if (taskCard) {
            steps = buildAssistantTurnSteps(phaseLines, taskCard, run);
        } else if (toolCalls.length > 0) {
            const running = toolCalls.filter((item) => item.status === 'running').length;
            const success = toolCalls.filter((item) => item.status === 'success').length;
            const failed = toolCalls.filter((item) => item.status === 'failed').length;
            const detail = [
                running > 0 ? `${running} tools running` : '',
                success > 0 ? `${success} tools completed` : '',
                failed > 0 ? `${failed} tools failed` : '',
            ].filter((line) => line.length > 0).join('\n');
            steps = [{
                id: `legacy-step-${run[0]?.id || 'execute'}`,
                title: 'Execute',
                detail: detail || 'Executing tools',
                tone: failed > 0 ? 'failed' : running > 0 ? 'running' : 'success',
            }];
        }

        const first = run[0];
        const last = run[run.length - 1];
        output.push({
            type: 'assistant_turn',
            id: `assistant-turn-legacy-${first?.id || 'start'}-${last?.id || 'end'}`,
            timestamp: last?.timestamp || first?.timestamp || new Date().toISOString(),
            lead,
            steps,
            messages,
            taskCard,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            effectRequests: effectRequests.length > 0 ? effectRequests : undefined,
            patches: patches.length > 0 ? patches : undefined,
            systemEvents: systemEvents.length > 0 ? systemEvents : undefined,
        });
        run = [];
    };

    for (const item of items) {
        if (item.type === 'user_message' || item.type === 'assistant_turn') {
            flushRun();
            output.push(item);
            continue;
        }
        run.push(item as LegacyAssistantItem);
    }
    flushRun();
    return output;
}

function processEvent(state: BuildState, session: TaskSession, event: TaskSession['events'][number]): void {
    const payload = event.payload as Record<string, any>;

    switch (event.type) {
        case 'TASK_STARTED': {
            const scheduledStart = isScheduledContext(state, session)
                || normalizeText(payload.title).startsWith('[Scheduled]');
            if (scheduledStart) {
                state.isScheduledSession = true;
                break;
            }
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
                if (isScheduledContext(state, session)) {
                    break;
                }
                appendItem(state, {
                    type: 'user_message',
                    id: event.id,
                    content: normalizeUserMessageText(payload.content),
                    timestamp: event.timestamp,
                });
                resetDraftState(state);
                break;
            }

            if (state.hasTaskContext) {
                if (role === 'assistant') {
                    finalizeAssistantMessage(state, event, String(payload.content ?? ''));
                } else {
                    const systemContent = String(payload.content ?? '').trim();
                    if (isRuntimeNoiseSystemEvent(systemContent)) {
                        break;
                    }
                    upsertPhaseBubble(state, 'execute', event, [systemContent], { mode: 'append', maxLines: 8 });
                    resetDraftState(state);
                }
                break;
            }

            if (role === 'system') {
                const content = String(payload.content ?? '');
                if (!isRuntimeNoiseSystemEvent(content)) {
                    appendSystemEvent(state, event, content);
                }
                break;
            }

            finalizeAssistantMessage(state, event, String(payload.content ?? ''));
            break;
        }

        case 'TEXT_DELTA': {
            if (payload.role === 'thinking') {
                return;
            }

            const delta = payload.delta || '';
            appendAssistantDelta(state, event, delta);
            break;
        }

        case 'TASK_STATUS': {
            const status = typeof payload.status === 'string' ? payload.status as TaskSession['status'] : session.status;
            if (!state.hasTaskContext) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
                card.status = status;
                if (status === 'running') {
                    card.collaboration = undefined;
                    upsertPhaseBubble(state, 'execute', event, [`Status: ${mapStatusLabel(status)}`], { mode: 'append', maxLines: 8 });
                }
            });
            break;
        }

        case 'TASK_RESUMED': {
            const resumeNotice = formatResumeReasonNotice(payload.resumeReason);
            if (!resumeNotice || !state.hasTaskContext) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
                upsertPhaseBubble(state, 'execute', event, [resumeNotice], { mode: 'append', maxLines: 10 });
                if (!card.subtitle) {
                    card.subtitle = resumeNotice;
                }
            });
            break;
        }

        case 'TASK_PLAN_READY': {
            const mode = normalizeText(payload.mode) as TaskSession['taskMode'] | '';
            state.isChatMode = mode === 'chat' || session.taskMode === 'chat';
            state.isScheduledSession = isScheduledMode(mode) || isScheduledMode(session.taskMode);
            const explicitTaskIntent = hasExplicitTaskIntent(payload.intentRouting);
            state.taskIntentExplicit = explicitTaskIntent;
            state.hasTaskContext = explicitTaskIntent;
            if (state.isChatMode || !explicitTaskIntent) {
                state.hasTaskContext = false;
                break;
            }
            updateTaskCard(state, session, event, (card) => {
                card.subtitle = normalizeText(payload.summary) || card.subtitle;

                const tasks = buildPlannedTaskList(payload.tasks);

                if (tasks.length > 0) {
                    state.taskById = new Map(tasks.map((task) => [task.id, task]));
                    setTaskList(card, tasks);
                }

                upsertPhaseBubble(
                    state,
                    'plan',
                    event,
                    buildPlanSummaryLines(payload, tasks, payload.summary),
                    { mode: 'replace', maxLines: 10 },
                );
            });
            break;
        }

        case 'PLAN_UPDATED': {
            if (!hasTaskCardContext(state)) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
                upsertPhaseBubble(state, 'execute', event, [payload.summary], { mode: 'append', maxLines: 10 });
                const tasks = mergeTaskProgressIntoTaskMap(state.taskById, payload.taskProgress);

                if (tasks.length > 0) {
                    setTaskList(card, tasks);
                }
            });
            break;
        }

        case 'TASK_RESEARCH_UPDATED': {
            if (isScheduledContext(state, session)) {
                break;
            }
            if (!enterTaskIntentContext(state)) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
                card.subtitle = normalizeText(payload.summary) || card.subtitle;
                upsertPhaseBubble(state, 'thinking', event, [
                    normalizeText(payload.summary),
                    ...(Array.isArray(payload.sourcesChecked) ? payload.sourcesChecked : []),
                    ...(Array.isArray(payload.blockingUnknowns) ? payload.blockingUnknowns : []),
                ], { mode: 'append', maxLines: 10 });
            });
            break;
        }

        case 'TASK_CONTRACT_REOPENED': {
            if (!enterTaskIntentContext(state)) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
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
            });
            break;
        }

        case 'TASK_CHECKPOINT_REACHED': {
            if (!enterTaskIntentContext(state)) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
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
                    action: { label: 'Continue' },
                };
            });
            break;
        }

        case 'TASK_USER_ACTION_REQUIRED': {
            if (!enterTaskIntentContext(state)) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
                const questions = normalizeLines(Array.isArray(payload.questions) ? payload.questions : []);
                const instructions = normalizeLines(Array.isArray(payload.instructions) ? payload.instructions : []);
                const kind = normalizeText(payload.kind);
                const isExternalAuth = kind === 'external_auth';
                const authUrl = normalizeText(payload.authUrl);
                const canAutoResume = Boolean(payload.canAutoResume);
                card.subtitle = normalizeText(payload.description) || card.subtitle;
                upsertPhaseBubble(state, 'execute', event, [
                    normalizeText(payload.description),
                    ...questions,
                    ...instructions,
                ], { mode: 'append', maxLines: 10 });
                const choices = isExternalAuth
                    ? [
                        ...(authUrl ? [{ label: '打开登录页面', value: `${AUTH_OPEN_PAGE_PREFIX}${authUrl}` }] : []),
                        { label: '我已登录，继续执行', value: '继续执行' },
                    ]
                    : undefined;
                card.collaboration = {
                    actionId: normalizeText(payload.actionId),
                    title: normalizeText(payload.title) || (isExternalAuth ? '需要登录' : 'User action required'),
                    description: normalizeText(payload.description),
                    blocking: Boolean(payload.blocking),
                    questions,
                    instructions,
                    input: isExternalAuth
                        ? undefined
                        : {
                            placeholder: questions[0] || 'Enter your response for this task...',
                            submitLabel: 'Submit and continue',
                        },
                    action: isExternalAuth ? undefined : { label: 'Continue' },
                    choices,
                };
                if (isExternalAuth && canAutoResume) {
                    upsertPhaseBubble(state, 'execute', event, ['登录完成后将自动继续执行。'], { mode: 'append', maxLines: 10 });
                }
            });
            break;
        }

        case 'TASK_CLARIFICATION_REQUIRED': {
            if (!enterTaskIntentContext(state)) {
                break;
            }
            updateTaskCard(state, session, event, (card) => {
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
                    ...(isRouteDisambiguation ? ['Route choice needed'] : isTaskDraftConfirmation ? ['Draft confirmation needed'] : ['Clarification needed']),
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
                        instructions: isTaskDraftConfirmation ? [TASK_DRAFT_CONFIRMATION_INSTRUCTION] : [],
                        input: isTaskDraftConfirmation
                            ? TASK_DRAFT_CONFIRMATION_INPUT
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
            });
            break;
        }

        case 'TOOL_CALLED': {
            if (hasTaskCardContext(state)) {
                const toolName = normalizeText(payload.toolName) || 'Tool';
                const toolId = normalizeText(payload.toolId) || event.id;
                state.toolNameById.set(toolId, toolName);
                updateTaskCard(state, session, event, () => {
                    upsertPhaseBubble(state, 'execute', event, [`Running: ${toolName}`], { mode: 'append', maxLines: 12 });
                });
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
            resetDraftState(state);
            break;
        }

        case 'TOOL_RESULT': {
            if (hasTaskCardContext(state)) {
                const toolName = state.toolNameById.get(normalizeText(payload.toolId)) || 'Tool';
                const resultLabel = payload.success ? 'Completed' : `Failed: ${normalizeText(payload.error) || 'unknown error'}`;
                updateTaskCard(state, session, event, () => {
                    upsertPhaseBubble(state, 'execute', event, [`${toolName}: ${resultLabel}`], { mode: 'append', maxLines: 12 });
                });
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
            if (hasTaskCardContext(state)) {
                const req = payload.request;
                updateTaskCard(state, session, event, () => {
                    upsertPhaseBubble(state, 'execute', event, [`Requested: ${normalizeText(req?.effectType) || 'effect'} (risk ${String(payload.riskLevel ?? 'n/a')})`], { mode: 'append', maxLines: 12 });
                });
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
            if (hasTaskCardContext(state)) {
                const response = payload.response as Record<string, unknown>;
                const requestId = normalizeText(response?.requestId);
                updateTaskCard(state, session, event, () => {
                    upsertPhaseBubble(state, 'execute', event, [`${requestId || 'Effect request'}: ${event.type === 'EFFECT_APPROVED' ? 'Approved' : 'Denied'}`], { mode: 'append', maxLines: 12 });
                });
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
            if (hasTaskCardContext(state)) {
                const patch = payload.patch as Record<string, unknown>;
                updateTaskCard(state, session, event, () => {
                    upsertPhaseBubble(state, 'execute', event, [`Proposed: ${normalizeText(patch.filePath) || 'unknown file'}`], { mode: 'append', maxLines: 12 });
                });
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
            if (hasTaskCardContext(state)) {
                const filePath = normalizeText(payload.filePath);
                const statusLabel = event.type === 'PATCH_APPLIED' ? 'Applied' : 'Rejected';
                updateTaskCard(state, session, event, () => {
                    upsertPhaseBubble(state, 'execute', event, [`${statusLabel}: ${filePath || normalizeText(payload.patchId) || 'patch'}`], { mode: 'append', maxLines: 12 });
                });
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
            if (hasTaskCardContext(state)) {
                updateTaskCard(state, session, event, () => {
                    upsertPhaseBubble(state, 'execute', event, [
                        payload.message || `Rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`,
                    ], { mode: 'append', maxLines: 12 });
                });
                break;
            }

            appendSystemEvent(state, event, payload.message || `API rate limited (attempt ${payload.attempt}/${payload.maxRetries}). Retrying...`);
            break;
        }

        case 'TASK_FINISHED': {
            if (!hasTaskCardContext(state)) {
                const normalizedSummary = normalizeText(payload.summary);
                const summaryComparable = normalizeComparableText(payload.summary);
                const artifacts = normalizeLines(Array.isArray(payload.artifactsCreated) ? payload.artifactsCreated : []);
                const files = normalizeLines(Array.isArray(payload.filesModified) ? payload.filesModified : []);

                if (state.currentDraftIndex !== null) {
                    const draftItem = state.items[state.currentDraftIndex];
                    if (draftItem?.type === 'assistant_message') {
                        upsertItem(state, state.currentDraftIndex, {
                            ...draftItem,
                            content: normalizedSummary || draftItem.content,
                            timestamp: event.timestamp,
                        });
                        resetDraftState(state);
                        break;
                    }
                }

                const lastIndex = state.items.length - 1;
                const lastItem = lastIndex >= 0 ? state.items[lastIndex] : undefined;
                const canReuseLastAssistant = lastItem?.type === 'assistant_message'
                    && !state.isScheduledSession
                    && summaryComparable.length > 0
                    && normalizeComparableText(lastItem.content) === summaryComparable;

                if (canReuseLastAssistant && lastItem?.type === 'assistant_message') {
                    upsertItem(state, lastIndex, {
                        ...lastItem,
                        content: normalizedSummary || lastItem.content,
                        timestamp: event.timestamp,
                    });
                } else if (normalizedSummary) {
                    appendItem(state, {
                        type: 'assistant_message',
                        id: `${event.id}-assistant`,
                        content: normalizedSummary,
                        timestamp: event.timestamp,
                    });
                }

                if (shouldCreateCompactTaskCardOnFinish(state, session, payload)) {
                    state.hasTaskContext = true;
                    updateTaskCard(state, session, event, (card) => {
                        const sessionTitle = cleanTaskCardTitle(normalizeText(session.title));
                        if (card.title === 'Task center') {
                            card.title = sessionTitle || (isScheduledContext(state, session) ? 'Scheduled task' : 'Task result');
                        }
                        if (!card.subtitle) {
                            card.subtitle = normalizedSummary || card.subtitle;
                        }
                        card.status = 'finished';
                        card.result = {
                            summary: normalizedSummary,
                            artifacts,
                            files,
                        };
                        card.collaboration = undefined;
                    });
                }

                resetDraftState(state);
                break;
            }

            state.hasTaskContext = true;
            updateTaskCard(state, session, event, (card) => {
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
            });
            resetDraftState(state);
            break;
        }

        case 'TASK_FAILED': {
            if (!hasTaskCardContext(state)) {
                const error = normalizeText(payload.error);
                const suggestion = normalizeText(payload.suggestion);
                appendSystemEvent(state, event, error ? `Task failed: ${error}` : 'Task failed');
                if (suggestion) {
                    appendSystemEvent(state, event, suggestion);
                }
                resetDraftState(state);
                break;
            }

            state.hasTaskContext = true;
            updateTaskCard(state, session, event, (card) => {
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
            });
            resetDraftState(state);
            break;
        }

        default:
            break;
    }
}

function createLegacyBuildState(session: TaskSession): BuildState {
    return {
        items: [],
        taskCardIndex: null,
        hasTaskContext: false,
        isChatMode: session.taskMode === 'chat',
        isScheduledSession: isScheduledMode(session.taskMode) || normalizeText(session.title).startsWith('[Scheduled]'),
        taskIntentExplicit: false,
        currentDraftIndex: null,
        toolIndex: new Map(),
        effectIndex: new Map(),
        patchIndex: new Map(),
        toolNameById: new Map(),
        taskById: new Map(),
        phaseLines: {
            plan: [],
            thinking: [],
            execute: [],
            summary: [],
        },
    };
}

export function buildLegacyTimelineItems(
    session: TaskSession,
    sourceEvents: TaskSession['events'],
): TimelineItemType[] {
    const state = createLegacyBuildState(session);

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

    const turnFirstItems = collapseTaskThreadToAssistantTurn(state.items, state.taskCardIndex, state.phaseLines);
    return collapseLegacyAssistantRunsToTurns(turnFirstItems, state.phaseLines);
}
