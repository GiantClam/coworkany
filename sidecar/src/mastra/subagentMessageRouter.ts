import type { TaskRuntimeAgentTask, TaskRuntimeState } from './taskRuntimeState';
import { parseSendSubagentMessagePayload } from './subagentSchemas';

export const SUBAGENT_FOLLOWUP_CONTRACT_MARKER = '[CoworkAny Subagent Followup Contract]';

export type ResolveSubagentFollowupResult =
    | {
        ok: true;
        taskId: string;
        subagentTaskId: string;
        content: string;
    }
    | {
        ok: false;
        taskId: string;
        error: 'invalid_payload' | 'task_not_found' | 'subagent_not_found';
        details?: Record<string, unknown>;
        availableSubagentTaskIds?: string[];
    };

function collectAddressableSubagentTaskIds(state: TaskRuntimeState | undefined): string[] {
    if (!state || !Array.isArray(state.agentTasks)) {
        return [];
    }
    const ids = state.agentTasks
        .map((task) => task.taskId.trim())
        .filter((taskId) => taskId.length > 0);
    return Array.from(new Set(ids));
}

function findSubagentTask(state: TaskRuntimeState, subagentTaskId: string): TaskRuntimeAgentTask | null {
    const normalized = subagentTaskId.trim();
    if (!normalized) {
        return null;
    }
    return state.agentTasks?.find((task) => task.taskId === normalized) ?? null;
}

function buildSubagentFollowupMessage(input: {
    parentTaskId: string;
    subagentTaskId: string;
    userContent: string;
    task?: TaskRuntimeAgentTask | null;
}): string {
    const normalizedContent = input.userContent.trim();
    if (normalizedContent.includes(SUBAGENT_FOLLOWUP_CONTRACT_MARKER)) {
        return `__route_task__\n${normalizedContent}`;
    }
    const status = input.task?.status ?? 'unknown';
    const summary = input.task?.summary?.trim() ?? '';
    const summaryLine = summary.length > 0
        ? `target_subagent_summary=${summary}`
        : 'target_subagent_summary=(none)';
    const contract = [
        '__route_task__',
        SUBAGENT_FOLLOWUP_CONTRACT_MARKER,
        `parent_task_id=${input.parentTaskId}`,
        `target_subagent_task_id=${input.subagentTaskId}`,
        `target_subagent_status=${status}`,
        summaryLine,
        '- Continue only this target subagent thread before final integration.',
        '- Do not blend unrelated subagent threads.',
        '- If the target subagent is terminal, spawn a successor and reference the predecessor id.',
    ].join('\n');
    return `${contract}\n\n[User Subagent Follow-up]\n${normalizedContent}`;
}

export function resolveSubagentFollowupMessage(input: {
    payload: Record<string, unknown>;
    taskStates: Map<string, TaskRuntimeState>;
}): ResolveSubagentFollowupResult {
    const parsed = parseSendSubagentMessagePayload(input.payload);
    if (!parsed.ok) {
        return {
            ok: false,
            taskId: parsed.details.taskId,
            error: parsed.error,
            details: parsed.details,
        };
    }
    const { taskId, subagentTaskId, content } = parsed.value;
    const state = input.taskStates.get(taskId);
    if (!state) {
        return {
            ok: false,
            taskId,
            error: 'task_not_found',
        };
    }
    const addressableSubagentTaskIds = collectAddressableSubagentTaskIds(state);
    const targetSubagentTask = findSubagentTask(state, subagentTaskId);
    if (!targetSubagentTask) {
        return {
            ok: false,
            taskId,
            error: 'subagent_not_found',
            availableSubagentTaskIds: addressableSubagentTaskIds,
        };
    }
    return {
        ok: true,
        taskId,
        subagentTaskId,
        content: buildSubagentFollowupMessage({
            parentTaskId: taskId,
            subagentTaskId,
            userContent: content,
            task: targetSubagentTask,
        }),
    };
}
