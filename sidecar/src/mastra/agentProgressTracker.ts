import type { AgentTaskNotification } from './agentTaskNotification';
import type {
    TaskRuntimeAgentTask,
    TaskRuntimeAgentTaskProgress,
    TaskRuntimeAgentTaskProgressEvent,
    TaskRuntimeAgentTaskUsage,
} from './taskRuntimeState';

const DEFAULT_MAX_ACTIVITY_EVENTS = 24;

function sumUsage(tasks: TaskRuntimeAgentTask[]): TaskRuntimeAgentTaskUsage | undefined {
    let totalTokens = 0;
    let toolUses = 0;
    let durationMs = 0;
    let hasAny = false;
    for (const task of tasks) {
        if (typeof task.usage?.totalTokens === 'number') {
            totalTokens += task.usage.totalTokens;
            hasAny = true;
        }
        if (typeof task.usage?.toolUses === 'number') {
            toolUses += task.usage.toolUses;
            hasAny = true;
        }
        if (typeof task.usage?.durationMs === 'number') {
            durationMs += task.usage.durationMs;
            hasAny = true;
        }
    }
    if (!hasAny) {
        return undefined;
    }
    return {
        totalTokens,
        toolUses,
        durationMs,
    };
}

function toProgressEvent(input: {
    notification: AgentTaskNotification;
    at: string;
    runId?: string;
    traceId?: string;
    turnId?: string;
}): TaskRuntimeAgentTaskProgressEvent {
    return {
        taskId: input.notification.taskId,
        status: input.notification.status,
        summary: input.notification.summary,
        at: input.at,
        runId: input.runId,
        traceId: input.traceId,
        turnId: input.turnId,
    };
}

function dedupeRecentEvents(events: TaskRuntimeAgentTaskProgressEvent[]): TaskRuntimeAgentTaskProgressEvent[] {
    const fingerprints = new Set<string>();
    const output: TaskRuntimeAgentTaskProgressEvent[] = [];
    for (const event of events) {
        const fingerprint = [
            event.taskId,
            event.status,
            event.summary,
            event.at,
            event.runId ?? '',
            event.traceId ?? '',
            event.turnId ?? '',
        ].join('|');
        if (fingerprints.has(fingerprint)) {
            continue;
        }
        fingerprints.add(fingerprint);
        output.push(event);
    }
    return output;
}

export function buildAgentTaskProgressSnapshot(input: {
    agentTasks?: TaskRuntimeAgentTask[];
    previous?: TaskRuntimeAgentTaskProgress;
    latestNotification?: AgentTaskNotification;
    at: string;
    runId?: string;
    traceId?: string;
    turnId?: string;
    maxRecentActivity?: number;
}): TaskRuntimeAgentTaskProgress | undefined {
    const tasks = Array.isArray(input.agentTasks) ? input.agentTasks : [];
    if (tasks.length === 0 && !input.previous) {
        return undefined;
    }
    const running = tasks.filter((task) => task.status === 'running').length;
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const failed = tasks.filter((task) => task.status === 'failed').length;
    const killed = tasks.filter((task) => task.status === 'killed').length;
    const total = tasks.length;
    const terminal = completed + failed + killed;
    const usageTotals = sumUsage(tasks);
    const latestEvent = input.latestNotification
        ? toProgressEvent({
            notification: input.latestNotification,
            at: input.at,
            runId: input.runId,
            traceId: input.traceId,
            turnId: input.turnId,
        })
        : input.previous?.lastEvent;
    const maxRecentActivity = Number.isFinite(input.maxRecentActivity)
        ? Math.max(1, Math.floor(input.maxRecentActivity as number))
        : DEFAULT_MAX_ACTIVITY_EVENTS;
    const historicalEvents = Array.isArray(input.previous?.recentActivity) ? input.previous.recentActivity : [];
    const nextEvents = latestEvent
        ? [...historicalEvents, latestEvent]
        : historicalEvents;
    const recentActivity = dedupeRecentEvents(nextEvents).slice(-maxRecentActivity);
    return {
        total,
        running,
        completed,
        failed,
        killed,
        terminal,
        usageTotals,
        lastUpdatedAt: input.at,
        lastEvent: latestEvent,
        recentActivity,
    };
}
