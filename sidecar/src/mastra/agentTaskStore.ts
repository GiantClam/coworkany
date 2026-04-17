import type { AgentTaskNotification } from './agentTaskNotification';
import type { TaskRuntimeAgentTask } from './taskRuntimeState';

export const DEFAULT_MAX_AGENT_TASK_RECORDS = 64;

export function isDelegatedAgentToolName(toolName: string): boolean {
    const normalized = toolName.trim();
    return normalized.startsWith('agent-') || normalized === 'agent_task_notification';
}

export function upsertAgentTaskFromNotification(input: {
    existing?: TaskRuntimeAgentTask[];
    notification: AgentTaskNotification;
    at: string;
    runId?: string;
    traceId?: string;
    turnId?: string;
    maxRecords?: number;
}): TaskRuntimeAgentTask[] {
    const existing = Array.isArray(input.existing) ? input.existing : [];
    const prior = existing.find((item) => item.taskId === input.notification.taskId);
    const isTerminalStatus = input.notification.status !== 'running';
    const record: TaskRuntimeAgentTask = {
        taskId: input.notification.taskId,
        status: input.notification.status,
        summary: input.notification.summary,
        result: input.notification.result,
        usage: input.notification.usage,
        startedAt: prior?.startedAt ?? input.at,
        updatedAt: input.at,
        completedAt: isTerminalStatus ? input.at : undefined,
        runId: input.runId ?? prior?.runId,
        traceId: input.traceId ?? prior?.traceId,
        turnId: input.turnId ?? prior?.turnId,
    };

    const deduped = existing.filter((item) => item.taskId !== record.taskId);
    const next = [...deduped, record];
    const maxRecords = Number.isFinite(input.maxRecords)
        ? Math.max(1, Math.floor(input.maxRecords as number))
        : DEFAULT_MAX_AGENT_TASK_RECORDS;
    if (next.length <= maxRecords) {
        return next;
    }
    return next.slice(next.length - maxRecords);
}
