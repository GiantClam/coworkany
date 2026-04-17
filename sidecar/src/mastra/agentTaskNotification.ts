export type AgentTaskStatus = 'running' | 'completed' | 'failed' | 'killed';

export type AgentTaskUsage = {
    totalTokens?: number;
    toolUses?: number;
    durationMs?: number;
};

export type AgentTaskNotification = {
    taskId: string;
    status: AgentTaskStatus;
    summary: string;
    result?: string;
    usage?: AgentTaskUsage;
};

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function toOptionalFiniteNumber(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return value;
}

function extractTaskId(payload: Record<string, unknown>): string | null {
    const direct = payload.taskId ?? payload.agentId ?? payload.id;
    if (typeof direct === 'string' && direct.trim().length > 0) {
        return direct.trim();
    }
    return null;
}

function resolveStatusFromValue(value: unknown): AgentTaskStatus | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (
        normalized === 'running'
        || normalized === 'completed'
        || normalized === 'failed'
        || normalized === 'killed'
    ) {
        return normalized;
    }
    return null;
}

function extractSummary(payload: Record<string, unknown>, status: AgentTaskStatus, taskId: string): string {
    const summary = payload.summary;
    if (typeof summary === 'string' && summary.trim().length > 0) {
        return summary.trim();
    }
    if (status === 'completed') {
        return `Agent task "${taskId}" completed`;
    }
    if (status === 'failed') {
        return `Agent task "${taskId}" failed`;
    }
    if (status === 'killed') {
        return `Agent task "${taskId}" was stopped`;
    }
    return `Agent task "${taskId}" started`;
}

function extractResult(payload: Record<string, unknown>): string | undefined {
    const result = payload.result ?? payload.output ?? payload.message;
    if (typeof result !== 'string') {
        return undefined;
    }
    const normalized = result.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function extractUsage(payload: Record<string, unknown>): AgentTaskUsage | undefined {
    const usage = payload.usage;
    if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
        return undefined;
    }
    const usageRecord = usage as Record<string, unknown>;
    const totalTokens = toOptionalFiniteNumber(usageRecord.totalTokens ?? usageRecord.total_tokens);
    const toolUses = toOptionalFiniteNumber(usageRecord.toolUses ?? usageRecord.tool_uses);
    const durationMs = toOptionalFiniteNumber(usageRecord.durationMs ?? usageRecord.duration_ms);
    if (totalTokens === undefined && toolUses === undefined && durationMs === undefined) {
        return undefined;
    }
    return {
        totalTokens,
        toolUses,
        durationMs,
    };
}

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

export function buildAgentTaskNotificationXml(notification: AgentTaskNotification): string {
    const resultSection = notification.result
        ? `\n<result>${escapeXml(notification.result)}</result>`
        : '';
    const usage = notification.usage;
    const usageSection = usage && (
        usage.totalTokens !== undefined
        || usage.toolUses !== undefined
        || usage.durationMs !== undefined
    )
        ? `\n<usage>${usage.totalTokens !== undefined ? `<total_tokens>${usage.totalTokens}</total_tokens>` : ''}${usage.toolUses !== undefined ? `<tool_uses>${usage.toolUses}</tool_uses>` : ''}${usage.durationMs !== undefined ? `<duration_ms>${usage.durationMs}</duration_ms>` : ''}</usage>`
        : '';
    return `<task-notification>
<task-id>${escapeXml(notification.taskId)}</task-id>
<status>${notification.status}</status>
<summary>${escapeXml(notification.summary)}</summary>${resultSection}${usageSection}
</task-notification>`;
}

function resolveStatusFromChunkType(chunkType: string): AgentTaskStatus | null {
    const normalized = chunkType.trim().toLowerCase();
    if (normalized.endsWith('agent-start') || normalized.endsWith('agent-running')) {
        return 'running';
    }
    if (normalized.endsWith('agent-finish') || normalized.endsWith('agent-complete') || normalized.endsWith('agent-completed')) {
        return 'completed';
    }
    if (normalized.endsWith('agent-error') || normalized.endsWith('agent-failed') || normalized.endsWith('agent-failure')) {
        return 'failed';
    }
    if (normalized.endsWith('agent-killed') || normalized.endsWith('agent-stopped') || normalized.endsWith('agent-cancelled') || normalized.endsWith('agent-canceled')) {
        return 'killed';
    }
    return null;
}

export function tryBuildAgentTaskNotificationFromEvent(
    chunkType: string,
    payload: Record<string, unknown>,
): AgentTaskNotification | null {
    const status = resolveStatusFromChunkType(chunkType);
    if (!status) {
        return null;
    }
    return coerceAgentTaskNotification({
        ...payload,
        status,
    });
}

export function coerceAgentTaskNotification(value: unknown): AgentTaskNotification | null {
    const payload = toRecord(value);
    if (!payload) {
        return null;
    }
    const taskId = extractTaskId(payload);
    const status = resolveStatusFromValue(payload.status);
    if (!taskId || !status) {
        return null;
    }
    return {
        taskId,
        status,
        summary: extractSummary(payload, status, taskId),
        result: extractResult(payload),
        usage: extractUsage(payload),
    };
}
