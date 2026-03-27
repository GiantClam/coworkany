import { sanitizeDisplayText } from '../textSanitizer';
import type {
    AssistantTurnStep,
    PlanStep,
    TaskCardItem,
    TaskSession,
    TimelineItemType,
} from '../../../../types';

export type TaskCardTask = NonNullable<TaskCardItem['tasks']>[number];
export type TaskPhaseKey = 'plan' | 'thinking' | 'execute' | 'summary';
export type AssistantThreadItem = Exclude<TimelineItemType, { type: 'user_message' | 'assistant_turn' }>;
export const TASK_DRAFT_CONFIRMATION_INSTRUCTION = '可直接确认创建，或先输入修改内容后点击“编辑后创建”。';
export const TASK_DRAFT_CONFIRMATION_INPUT = {
    placeholder: '输入修改后的任务说明（可选）',
    submitLabel: '编辑后创建',
} as const;

export function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeLines(values: unknown[]): string[] {
    const lines = values
        .map((value) => normalizeText(value))
        .filter((line) => line.length > 0);
    return Array.from(new Set(lines));
}

function asObjectArray(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value)
        ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        : [];
}

export function normalizeComparableText(value: unknown): string {
    return normalizeText(value).replace(/\s+/g, ' ');
}

export function isScheduledMode(mode: unknown): boolean {
    const normalized = normalizeText(mode);
    return normalized === 'scheduled_task' || normalized === 'scheduled_multi_task';
}

export function hasExplicitTaskIntent(intentRouting: unknown): boolean {
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

export function mapStatusLabel(status: 'idle' | 'running' | 'finished' | 'failed' | ''): string {
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

export function setTaskList(card: TaskCardItem, tasks: TaskCardTask[]): void {
    if (tasks.length === 0) {
        card.tasks = undefined;
        card.workflow = 'single';
        return;
    }

    card.tasks = tasks;
    card.workflow = inferWorkflow(tasks);
}

export function syncTaskCardExecutionProfile(card: TaskCardItem, session: TaskSession): void {
    card.executionProfile = session.executionProfile;
    card.capabilityPlan = session.capabilityPlan;
    card.capabilityReview = session.capabilityReview;
    card.primaryHardness = session.primaryHardness ?? session.executionProfile?.primaryHardness;
    card.activeHardness = session.activeHardness ?? card.primaryHardness;
    card.blockingReason = session.blockingReason;
    card.lastResumeReason = session.lastResumeReason;
}

export function buildPlannedTaskList(value: unknown): TaskCardTask[] {
    return asObjectArray(value)
        .map((task) => ({
            id: normalizeText(task.id),
            title: normalizeText(task.title) || normalizeText(task.objective) || 'Task',
            status: 'pending' as PlanStep['status'],
            dependencies: normalizeLines(Array.isArray(task.dependencies) ? task.dependencies : []),
        }))
        .filter((task) => task.id.length > 0);
}

export function buildPlanSummaryLines(
    data: Record<string, unknown>,
    tasks: TaskCardTask[],
    summary: unknown,
): string[] {
    const deliverableLines = asObjectArray(data.deliverables)
        .map((deliverable) => {
            const title = normalizeText(deliverable.title);
            const path = normalizeText(deliverable.path);
            const description = normalizeText(deliverable.description);
            if (path) return `${title || 'Deliverable'}: ${path}`;
            if (description) return `${title || 'Deliverable'}: ${description}`;
            return title || '';
        });
    const checkpointLines = asObjectArray(data.checkpoints)
        .map((checkpoint) => {
            const title = normalizeText(checkpoint.title);
            const reason = normalizeText(checkpoint.reason);
            return reason ? `${title || 'Checkpoint'}: ${reason}` : title;
        });
    const userActionLines = asObjectArray(data.userActionsRequired)
        .map((action) => {
            const title = normalizeText(action.title);
            const description = normalizeText(action.description);
            return description ? `${title || 'Action'}: ${description}` : title;
        });
    const missingInfoLines = asObjectArray(data.missingInfo)
        .map((entry) => {
            const field = normalizeText(entry.field);
            const question = normalizeText(entry.question);
            const reason = normalizeText(entry.reason);
            return question || reason ? `${field || 'Item'}: ${question || reason}` : field;
        });
    const capabilityReview = data.capabilityReview && typeof data.capabilityReview === 'object'
        ? data.capabilityReview as Record<string, unknown>
        : undefined;
    const capabilityReviewLine = capabilityReview
        ? normalizeText(capabilityReview.summary)
            || (normalizeText(capabilityReview.status) === 'pending'
                ? 'Generated capability is pending review before execution can resume.'
                : '')
        : '';

    return [
        normalizeText(summary),
        ...tasks.map((task) => `Task: ${task.title}`),
        ...deliverableLines,
        ...checkpointLines,
        ...userActionLines,
        ...missingInfoLines,
        capabilityReviewLine,
    ];
}

export function mergeTaskProgressIntoTaskMap(
    taskById: Map<string, TaskCardTask>,
    value: unknown,
): TaskCardTask[] {
    const taskProgress = asObjectArray(value)
        .map((entry) => ({
            id: normalizeText(entry.taskId),
            title: normalizeText(entry.title),
            status: toTaskStatus(entry.status),
            dependencies: normalizeLines(Array.isArray(entry.dependencies) ? entry.dependencies : []),
        }))
        .filter((entry) => entry.id.length > 0);

    if (taskProgress.length === 0) {
        return [];
    }

    for (const entry of taskProgress) {
        const existing = taskById.get(entry.id);
        taskById.set(entry.id, {
            id: entry.id,
            title: entry.title || existing?.title || 'Task',
            status: entry.status,
            dependencies: entry.dependencies.length > 0 ? entry.dependencies : (existing?.dependencies ?? []),
        });
    }

    return Array.from(taskById.values());
}

export function toTaskStatus(value: unknown): PlanStep['status'] {
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

export function cleanTaskCardTitle(raw: string): string {
    return raw.replace(/^\[Scheduled\]\s*/i, '').trim();
}

export function isProceduralLead(text: string): boolean {
    const lowered = text.toLowerCase();
    return (lowered.includes('before final delivery') && lowered.includes('request input'))
        || lowered.includes('execution contract reopened')
        || lowered.includes('clarification required')
        || lowered.includes('checkpoint reached');
}

const STEP_DETAIL_MAX_LINE_CHARS = 140;
const EXECUTE_STEP_MAX_LINES = 4;
const SUMMARY_STEP_MAX_LINES = 5;

function clampStepDetailLine(line: string): string {
    if (line.length <= STEP_DETAIL_MAX_LINE_CHARS) {
        return line;
    }
    return `${line.slice(0, STEP_DETAIL_MAX_LINE_CHARS).trimEnd()}…`;
}

export function buildAssistantTurnSteps(
    phaseLines: Record<TaskPhaseKey, string[]>,
    taskCard: TaskCardItem,
    threadItems: AssistantThreadItem[],
): AssistantTurnStep[] {
    const steps: AssistantTurnStep[] = [];
    const planDetail = sanitizeDisplayText(
        taskCard.tasks?.[0]?.title
        || phaseLines.plan[0]
        || phaseLines.thinking[0]
        || ''
    );
    if (planDetail) {
        steps.push({
            id: `${taskCard.id}-plan`,
            title: 'Task plan',
            detail: planDetail,
            tone: 'neutral',
        });
    }

    const toolCalls = threadItems.filter((item): item is Extract<AssistantThreadItem, { type: 'tool_call' }> => item.type === 'tool_call');
    const runningToolCount = toolCalls.filter((item) => item.status === 'running').length;
    const completedToolCount = toolCalls.filter((item) => item.status === 'success').length;
    const failedToolCount = toolCalls.filter((item) => item.status === 'failed').length;

    const executionSegments = [
        runningToolCount > 0 ? `${runningToolCount} tools running` : '',
        completedToolCount > 0 ? `${completedToolCount} tools completed` : '',
        failedToolCount > 0 ? `${failedToolCount} tools failed` : '',
        ...phaseLines.execute,
    ]
        .map((entry) => sanitizeDisplayText(entry))
        .map((entry) => clampStepDetailLine(entry))
        .filter((entry) => entry.length > 0);
    const executeDetailLines = executionSegments.slice(-EXECUTE_STEP_MAX_LINES);

    if (executeDetailLines.length > 0 || taskCard.status === 'running' || taskCard.status === 'finished' || taskCard.status === 'failed') {
        steps.push({
            id: `${taskCard.id}-execute`,
            title: 'Execute',
            detail: executeDetailLines.join('\n') || 'Running',
            tone: taskCard.status === 'failed'
                ? 'failed'
                : taskCard.status === 'finished'
                    ? 'success'
                    : 'running',
        });
    }

    const summarySegments = [
        ...phaseLines.summary,
        taskCard.result?.summary || '',
        taskCard.result?.error || '',
    ]
        .map((entry) => sanitizeDisplayText(entry))
        .map((entry) => clampStepDetailLine(entry))
        .filter((entry) => entry.length > 0);
    const summaryDetailLines = summarySegments.slice(-SUMMARY_STEP_MAX_LINES);

    if (summaryDetailLines.length > 0 || taskCard.status === 'finished' || taskCard.status === 'failed') {
        steps.push({
            id: `${taskCard.id}-summary`,
            title: 'Summary',
            detail: summaryDetailLines.join('\n'),
            tone: taskCard.status === 'failed' ? 'failed' : 'success',
        });
    }

    return steps;
}
