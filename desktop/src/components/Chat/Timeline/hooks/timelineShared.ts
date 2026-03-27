import { sanitizeDisplayText } from '../textSanitizer';
import type {
    AssistantTurnStep,
    PlanStep,
    TaskCardItem,
    TimelineItemType,
} from '../../../../types';

export type TaskCardTask = NonNullable<TaskCardItem['tasks']>[number];
export type TaskPhaseKey = 'plan' | 'thinking' | 'execute' | 'summary';
export type AssistantThreadItem = Exclude<TimelineItemType, { type: 'user_message' | 'assistant_turn' }>;

export function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeLines(values: unknown[]): string[] {
    const lines = values
        .map((value) => normalizeText(value))
        .filter((line) => line.length > 0);
    return Array.from(new Set(lines));
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
