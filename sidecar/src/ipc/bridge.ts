type DesktopEventBase = {
    runId?: string;
    traceId?: string;
    turnId?: string;
};
type DesktopTextDeltaRole = 'assistant' | 'thinking';

export type DesktopEvent =
    | ({ type: 'text_delta'; content: string; role?: DesktopTextDeltaRole } & DesktopEventBase)
    | ({ type: 'tool_call'; toolName: string; args: unknown } & DesktopEventBase)
    | ({ type: 'approval_required'; toolCallId: string; toolName: string; args: unknown; resumeSchema: string } & DesktopEventBase)
    | ({ type: 'suspended'; toolCallId: string; toolName: string; payload: unknown } & DesktopEventBase)
    | ({
        type: 'rate_limited';
        message?: string;
        attempt?: number;
        maxAttempts?: number;
        retryAfterMs?: number;
        error?: string;
        stage?: 'dns' | 'connect' | 'ttfb' | 'first_token' | 'last_token' | 'unknown';
        timings?: {
            elapsedMs?: number;
            dnsMs?: number | null;
            connectMs?: number | null;
            ttfbMs?: number | null;
            firstTokenMs?: number | null;
            lastTokenMs?: number | null;
        };
    } & DesktopEventBase)
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
function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    return value.length > 0 ? value : null;
}
function resolveStreamTextDelta(chunk: MastraChunkLike, data: Record<string, unknown>): string {
    return normalizeText(data.text)
        ?? normalizeText(data.textDelta)
        ?? normalizeText(data.delta)
        ?? normalizeText(chunk.text)
        ?? normalizeText(chunk.textDelta)
        ?? normalizeText(chunk.delta)
        ?? '';
}
function appendUniqueText(target: string[], value: unknown): void {
    const normalized = normalizeText(value);
    if (!normalized) {
        return;
    }
    if (target[target.length - 1] === normalized) {
        return;
    }
    target.push(normalized);
}
function collectTextFragmentsFromMessageLike(value: unknown): string[] {
    const message = toRecord(value);
    if (!message) {
        return [];
    }
    const fragments: string[] = [];
    appendUniqueText(fragments, message.text);
    appendUniqueText(fragments, message.outputText);
    appendUniqueText(fragments, message.content);

    const parts = Array.isArray(message.parts) ? message.parts : [];
    for (const part of parts) {
        const record = toRecord(part);
        if (!record) {
            continue;
        }
        appendUniqueText(fragments, record.text);
        appendUniqueText(fragments, record.content);
    }

    const content = Array.isArray(message.content) ? message.content : [];
    for (const entry of content) {
        const record = toRecord(entry);
        if (!record) {
            continue;
        }
        appendUniqueText(fragments, record.text);
        appendUniqueText(fragments, record.content);
    }

    return fragments;
}

function isAssistantMessageLike(value: unknown): boolean {
    const message = toRecord(value);
    if (!message) {
        return false;
    }
    const role = normalizeText(message.role);
    return role === null || role === 'assistant';
}

function extractAssistantTextFromFinishChunk(data: Record<string, unknown>): string {
    const fragments: string[] = [];
    appendUniqueText(fragments, data.text);
    appendUniqueText(fragments, data.outputText);
    appendUniqueText(fragments, data.content);

    const response = toRecord(data.response);
    if (response) {
        appendUniqueText(fragments, response.text);
        appendUniqueText(fragments, response.outputText);
        appendUniqueText(fragments, response.content);

        const uiMessages = Array.isArray(response.uiMessages) ? response.uiMessages : [];
        for (const message of uiMessages) {
            if (!isAssistantMessageLike(message)) {
                continue;
            }
            const nested = collectTextFragmentsFromMessageLike(message);
            for (const text of nested) {
                appendUniqueText(fragments, text);
            }
        }

        const messages = Array.isArray(response.messages) ? response.messages : [];
        for (const message of messages) {
            if (!isAssistantMessageLike(message)) {
                continue;
            }
            const nested = collectTextFragmentsFromMessageLike(message);
            for (const text of nested) {
                appendUniqueText(fragments, text);
            }
        }
    }

    return fragments.join('\n\n').trim();
}
function resolveFinishReason(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    const record = toRecord(value);
    if (!record) {
        return undefined;
    }
    return normalizeText(record.unified)
        ?? normalizeText(record.raw)
        ?? undefined;
}
export function extractMastraFinalAssistantTextEvent(
    chunk: MastraChunkLike,
    runId?: string,
): DesktopEvent | null {
    if (chunk.type !== 'finish') {
        return null;
    }
    const data = resolveChunkData(chunk);
    if (!data) {
        return null;
    }
    const text = extractAssistantTextFromFinishChunk(data);
    if (!text) {
        return null;
    }
    return {
        type: 'text_delta',
        role: 'assistant',
        content: text,
        runId,
    };
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
            const text = resolveStreamTextDelta(chunk, data);
            if (!text) return null;
            return { type: 'text_delta', content: text, runId, role: 'assistant' };
        }
        case 'reasoning':
        case 'reasoning-delta': {
            const text = resolveStreamTextDelta(chunk, data);
            if (!text) return null;
            return { type: 'text_delta', content: text, runId, role: 'thinking' };
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
                finishReason: resolveFinishReason(data.finishReason)
                    ?? resolveFinishReason((toRecord(data.stepResult) ?? {}).reason)
                    ?? (typeof data.stepResult === 'object' && data.stepResult !== null
                        ? String((data.stepResult as Record<string, unknown>).reason ?? '')
                        : undefined),
            };
        case 'step-finish':
            return null;
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
