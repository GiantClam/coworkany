type DesktopEventBase = {
    runId?: string;
    traceId?: string;
};

export type DesktopEvent =
    | ({ type: 'text_delta'; content: string } & DesktopEventBase)
    | ({ type: 'tool_call'; toolName: string; args: unknown } & DesktopEventBase)
    | ({ type: 'approval_required'; toolCallId: string; toolName: string; args: unknown; resumeSchema: string } & DesktopEventBase)
    | ({ type: 'suspended'; toolCallId: string; toolName: string; payload: unknown } & DesktopEventBase)
    | {
        type: 'tripwire';
        reason: string;
        retry?: boolean;
        processorId?: string;
        metadata?: Record<string, unknown>;
    } & DesktopEventBase
    | ({ type: 'tool_result'; toolCallId: string; toolName: string; result: unknown; isError?: boolean } & DesktopEventBase)
    | {
        type: 'token_usage';
        modelId?: string;
        provider?: string;
        usage: {
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            cacheCreationInputTokens?: number;
            cacheReadInputTokens?: number;
        };
    } & DesktopEventBase
    | ({ type: 'complete'; finishReason?: string } & DesktopEventBase)
    | ({ type: 'error'; message: string } & DesktopEventBase);
type TokenUsageData = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
};
export interface MastraChunkLike {
    type?: string;
    payload?: unknown;
    [key: string]: unknown;
}
function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}
function getNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function extractErrorMessage(value: unknown, depth = 0): string | null {
    if (depth > 4 || value == null) {
        return null;
    }
    if (typeof value === 'string') {
        return value.length > 0 ? value : null;
    }
    if (value instanceof Error) {
        return value.message.length > 0 ? value.message : null;
    }
    const record = toRecord(value);
    if (!record) {
        return null;
    }

    const directKeys = [
        'message',
        'detail',
        'error_description',
        'reason',
        'title',
    ];
    for (const key of directKeys) {
        const candidate = record[key];
        if (typeof candidate === 'string' && candidate.length > 0) {
            return candidate;
        }
    }

    const nestedKeys = ['error', 'cause', 'response', 'data'];
    for (const key of nestedKeys) {
        const nested = extractErrorMessage(record[key], depth + 1);
        if (nested) {
            return nested;
        }
    }

    const code = typeof record.code === 'string' ? record.code : null;
    const status = typeof record.status === 'number' ? record.status : null;
    if (code || status !== null) {
        const statusText = typeof record.statusText === 'string' ? record.statusText : null;
        return [code, status !== null ? String(status) : null, statusText].filter(Boolean).join(':');
    }
    return null;
}
function resolveChunkData(chunk: MastraChunkLike): Record<string, unknown> | null {
    const payloadRecord = toRecord(chunk.payload);
    if (payloadRecord) {
        return payloadRecord;
    }
    return toRecord(chunk);
}
function resolveUsageNumbers(record: Record<string, unknown>): TokenUsageData | null {
    const usage = toRecord(record.usage);
    if (!usage) {
        return null;
    }
    const inputTokens = getNumber(usage.inputTokens)
        ?? getNumber(usage.promptTokens)
        ?? getNumber(usage.prompt_tokens)
        ?? 0;
    const outputTokens = getNumber(usage.outputTokens)
        ?? getNumber(usage.completionTokens)
        ?? getNumber(usage.completion_tokens)
        ?? 0;
    const totalTokens = getNumber(usage.totalTokens)
        ?? getNumber(usage.total_tokens)
        ?? (inputTokens + outputTokens);
    const cacheCreationInputTokens = getNumber(usage.cacheCreationInputTokens)
        ?? getNumber(usage.cache_creation_input_tokens)
        ?? undefined;
    const cacheReadInputTokens = getNumber(usage.cacheReadInputTokens)
        ?? getNumber(usage.cache_read_input_tokens)
        ?? undefined;
    if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
        return null;
    }
    return {
        inputTokens,
        outputTokens,
        totalTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
    };
}
export function extractMastraTokenUsageEvent(
    chunk: MastraChunkLike,
    runId?: string,
): DesktopEvent | null {
    if (chunk.type !== 'step-finish' && chunk.type !== 'finish') {
        return null;
    }
    const data = resolveChunkData(chunk);
    if (!data) {
        return null;
    }
    const usage = resolveUsageNumbers(data);
    if (!usage) {
        return null;
    }
    const response = toRecord(data.response);
    const responseModelId = response
        ? (typeof response.modelId === 'string'
            ? response.modelId
            : typeof response.model === 'string'
                ? response.model
                : null)
        : null;
    const modelId = responseModelId
        ?? (typeof data.modelId === 'string' ? data.modelId : undefined);
    const provider = modelId?.split('/')[0] || undefined;
    return {
        type: 'token_usage',
        runId,
        modelId,
        provider,
        usage,
    };
}
export function mapMastraChunkToDesktopEvent(chunk: MastraChunkLike, runId?: string): DesktopEvent | null {
    const data = resolveChunkData(chunk);
    if (!data) {
        if (chunk.type === 'finish') {
            return { type: 'complete', runId };
        }
        return null;
    }
    switch (chunk.type) {
        case 'text-delta': {
            const text = typeof data.text === 'string'
                ? data.text
                : typeof chunk.text === 'string'
                    ? chunk.text
                    : '';
            if (!text) return null;
            return { type: 'text_delta', content: text, runId };
        }
        case 'tool-call': {
            if (typeof data.toolName !== 'string') return null;
            return {
                type: 'tool_call',
                runId,
                toolName: data.toolName,
                args: data.args,
            };
        }
        case 'tool-call-approval': {
            if (typeof data.toolCallId !== 'string' || typeof data.toolName !== 'string') return null;
            return {
                type: 'approval_required',
                runId,
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                args: data.args,
                resumeSchema: typeof data.resumeSchema === 'string' ? data.resumeSchema : '{}',
            };
        }
        case 'tool-call-suspended': {
            if (typeof data.toolCallId !== 'string' || typeof data.toolName !== 'string') return null;
            return {
                type: 'suspended',
                runId,
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                payload: data.suspendPayload,
            };
        }
        case 'tripwire': {
            const reason = typeof data.reason === 'string' && data.reason.length > 0
                ? data.reason
                : 'tripwire_triggered';
            const metadata = toRecord(data.metadata) ?? undefined;
            return {
                type: 'tripwire',
                runId,
                reason,
                retry: data.retry === true,
                processorId: typeof data.processorId === 'string' ? data.processorId : undefined,
                metadata,
            };
        }
        case 'tool-result': {
            if (typeof data.toolCallId !== 'string' || typeof data.toolName !== 'string') return null;
            return {
                type: 'tool_result',
                runId,
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                result: data.result,
                isError: data.isError === true,
            };
        }
        case 'finish':
            return {
                type: 'complete',
                runId,
                finishReason: typeof data.finishReason === 'string'
                    ? data.finishReason
                    : typeof data.stepResult === 'object' && data.stepResult !== null
                        ? String((data.stepResult as Record<string, unknown>).reason ?? '')
                        : undefined,
            };
        case 'error': {
            const message = extractErrorMessage(data.error)
                ?? extractErrorMessage(data.message)
                ?? extractErrorMessage(data)
                ?? 'unknown_error';
            return {
                type: 'error',
                runId,
                message,
            };
        }
        default:
            return null;
    }
}
