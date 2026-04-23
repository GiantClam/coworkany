import {
    buildAgentTaskNotificationXml,
    tryBuildAgentTaskNotificationFromEvent,
} from '../mastra/agentTaskNotification';

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

const AGENT_EXECUTION_EVENT_PREFIX = 'agent-execution-event-';
const DATA_EVENT_PREFIX = 'data-';
const COMMAND_EXECUTION_TOOL_PATTERN = /\b(mastra_workspace_execute_command|run_command|bash|bash_approval|exec_shell|shell(?:[_\s-]?command)?|terminal(?:[_\s-]?command)?)\b/iu;
const COMMAND_FAILURE_TEXT_PATTERN = /\b(command not found|no such file or directory|permission denied|operation not permitted|segmentation fault|fatal error|traceback \(most recent call last\)|error while opening encoder|invalid argument|failed to open|cannot open|unable to (?:open|find)|width not divisible by 2)\b/iu;
const COMMAND_EXIT_CODE_PATTERN = /\bexit\s*code\s*[:=]\s*([1-9][0-9]*)\b/iu;

function toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

function normalizeChunkType(rawType: unknown): string | null {
    if (typeof rawType !== 'string') {
        return null;
    }
    const normalized = rawType.trim();
    return normalized.length > 0 ? normalized : null;
}

function normalizeMastraChunk(chunk: MastraChunkLike): MastraChunkLike {
    let type = normalizeChunkType(chunk.type);
    let payload = chunk.payload;
    if (!type) {
        return chunk;
    }

    const payloadRecord = toRecord(payload);
    if (type === 'agent-execution-event' || type.startsWith(AGENT_EXECUTION_EVENT_PREFIX)) {
        const prefixedType = type.startsWith(AGENT_EXECUTION_EVENT_PREFIX)
            ? normalizeChunkType(type.slice(AGENT_EXECUTION_EVENT_PREFIX.length))
            : null;
        let nestedType = prefixedType;
        let nestedPayload = payload;

        const nestedEventRecord = payloadRecord ? toRecord(payloadRecord.event) : null;
        if (nestedEventRecord) {
            nestedType = normalizeChunkType(nestedEventRecord.type) ?? nestedType;
            nestedPayload = Object.prototype.hasOwnProperty.call(nestedEventRecord, 'payload')
                ? nestedEventRecord.payload
                : nestedEventRecord;
        } else if (payloadRecord) {
            nestedType = normalizeChunkType(payloadRecord.type) ?? nestedType;
            nestedPayload = Object.prototype.hasOwnProperty.call(payloadRecord, 'payload')
                ? payloadRecord.payload
                : payloadRecord;
        }

        if (nestedType) {
            type = nestedType;
            payload = nestedPayload;
        }
    }

    if (type.startsWith(DATA_EVENT_PREFIX)) {
        const strippedType = normalizeChunkType(type.slice(DATA_EVENT_PREFIX.length));
        if (strippedType) {
            type = strippedType;
        }
    }

    return {
        ...chunk,
        type,
        payload,
    };
}

function resolveNormalizedChunkType(chunk: MastraChunkLike): string | null {
    return normalizeChunkType(normalizeMastraChunk(chunk).type);
}

const STREAM_PROGRESS_EVENT_TYPES = new Set([
    'start',
    'step-start',
    'step-finish',
    'finish',
    'text-delta',
    'reasoning',
    'reasoning-delta',
    'tool-call',
    'tool-call-approval',
    'tool-call-suspended',
    'tool-result',
    'tool-output-available',
    'tool-output-error',
    'tool-input-start',
    'tool-input-delta',
    'tool-input-available',
]);

export function isMastraOperationalProgressChunk(chunk: MastraChunkLike): boolean {
    const normalizedType = resolveNormalizedChunkType(chunk);
    if (!normalizedType) {
        return false;
    }
    if (STREAM_PROGRESS_EVENT_TYPES.has(normalizedType)) {
        return true;
    }
    if (normalizedType.startsWith('tool-') || normalizedType.startsWith('step-')) {
        return true;
    }
    return normalizedType.endsWith('-delta')
        || normalizedType.endsWith('-start')
        || normalizedType.endsWith('-finish');
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

function resolveToolName(data: Record<string, unknown>): string | null {
    const direct = normalizeText(data.toolName)
        ?? normalizeText(data.name)
        ?? normalizeText(data.tool);
    if (direct) {
        return direct;
    }
    const toolRecord = toRecord(data.tool);
    const nestedTool = toolRecord
        ? (normalizeText(toolRecord.name) ?? normalizeText(toolRecord.id))
        : null;
    if (nestedTool) {
        return nestedTool;
    }
    const toolCallRecord = toRecord(data.toolCall);
    const nestedCallTool = toolCallRecord
        ? (normalizeText(toolCallRecord.toolName) ?? normalizeText(toolCallRecord.name))
        : null;
    return nestedCallTool;
}

function resolveToolArgs(data: Record<string, unknown>): unknown {
    if (Object.prototype.hasOwnProperty.call(data, 'args')) {
        return data.args;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'input')) {
        return data.input;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'arguments')) {
        return data.arguments;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'params')) {
        return data.params;
    }
    const toolCallRecord = toRecord(data.toolCall);
    if (toolCallRecord) {
        if (Object.prototype.hasOwnProperty.call(toolCallRecord, 'args')) {
            return toolCallRecord.args;
        }
        if (Object.prototype.hasOwnProperty.call(toolCallRecord, 'input')) {
            return toolCallRecord.input;
        }
        if (Object.prototype.hasOwnProperty.call(toolCallRecord, 'arguments')) {
            return toolCallRecord.arguments;
        }
    }
    return {};
}

function resolveToolCallId(data: Record<string, unknown>, fallbackToolName?: string): string | null {
    const direct = normalizeText(data.toolCallId)
        ?? normalizeText(data.callId)
        ?? normalizeText(data.id);
    if (direct) {
        return direct;
    }
    const toolCallRecord = toRecord(data.toolCall);
    const nested = toolCallRecord
        ? (normalizeText(toolCallRecord.id) ?? normalizeText(toolCallRecord.toolCallId))
        : null;
    if (nested) {
        return nested;
    }
    if (!fallbackToolName) {
        return null;
    }
    return `unknown:${fallbackToolName}`;
}

function resolveToolResultValue(data: Record<string, unknown>): unknown {
    if (Object.prototype.hasOwnProperty.call(data, 'result')) {
        return data.result;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'output')) {
        return data.output;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'value')) {
        return data.value;
    }
    const toolCallRecord = toRecord(data.toolCall);
    if (toolCallRecord) {
        if (Object.prototype.hasOwnProperty.call(toolCallRecord, 'result')) {
            return toolCallRecord.result;
        }
        if (Object.prototype.hasOwnProperty.call(toolCallRecord, 'output')) {
            return toolCallRecord.output;
        }
    }
    return data;
}

function toFiniteNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim(), 10);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function collectCommandFailureTextCandidates(
    value: unknown,
    depth = 0,
    sink: string[] = [],
): string[] {
    if (depth > 5 || value == null) {
        return sink;
    }
    if (typeof value === 'string') {
        const normalized = normalizeText(value);
        if (normalized && !sink.includes(normalized)) {
            sink.push(normalized);
        }
        return sink;
    }
    const record = toRecord(value);
    if (!record) {
        return sink;
    }
    const directTextKeys = [
        'stderr',
        'stdout',
        'output',
        'message',
        'detail',
        'text',
        'error',
        'reason',
        'summary',
    ];
    for (const key of directTextKeys) {
        const candidate = record[key];
        if (typeof candidate === 'string') {
            const normalized = normalizeText(candidate);
            if (normalized && !sink.includes(normalized)) {
                sink.push(normalized);
            }
            continue;
        }
        if (candidate && typeof candidate === 'object') {
            collectCommandFailureTextCandidates(candidate, depth + 1, sink);
        }
    }
    const nestedKeys = ['result', 'response', 'payload', 'data'];
    for (const key of nestedKeys) {
        const nested = record[key];
        if (nested && typeof nested === 'object') {
            collectCommandFailureTextCandidates(nested, depth + 1, sink);
        }
    }
    return sink;
}

function isLikelyCommandExecutionFailure(input: {
    data: Record<string, unknown>;
    toolName?: string;
}): boolean {
    if (!input.toolName || !COMMAND_EXECUTION_TOOL_PATTERN.test(input.toolName)) {
        return false;
    }

    const topLevelExitCode = toFiniteNumber(input.data.exitCode ?? input.data.exit_code);
    if (topLevelExitCode !== null && topLevelExitCode !== 0) {
        return true;
    }

    const resultValue = resolveToolResultValue(input.data);
    const resultRecord = toRecord(resultValue);
    if (resultRecord) {
        const resultExitCode = toFiniteNumber(resultRecord.exitCode ?? resultRecord.exit_code);
        if (resultExitCode !== null && resultExitCode !== 0) {
            return true;
        }
        const resultStatusCode = toFiniteNumber(resultRecord.statusCode ?? resultRecord.status_code);
        if (resultStatusCode !== null && resultStatusCode >= 400) {
            return true;
        }
        if (resultRecord.success === false || resultRecord.ok === false) {
            return true;
        }
        const stderr = normalizeText(resultRecord.stderr);
        if (stderr && (COMMAND_FAILURE_TEXT_PATTERN.test(stderr) || COMMAND_EXIT_CODE_PATTERN.test(stderr))) {
            return true;
        }
        const textCandidates = collectCommandFailureTextCandidates(resultRecord);
        if (textCandidates.some((candidate) => (
            COMMAND_FAILURE_TEXT_PATTERN.test(candidate) || COMMAND_EXIT_CODE_PATTERN.test(candidate)
        ))) {
            return true;
        }
        const errorMessage = extractErrorMessage(resultRecord.error);
        if (errorMessage && COMMAND_FAILURE_TEXT_PATTERN.test(errorMessage)) {
            return true;
        }
    }

    if (typeof resultValue === 'string') {
        return COMMAND_FAILURE_TEXT_PATTERN.test(resultValue) || COMMAND_EXIT_CODE_PATTERN.test(resultValue);
    }

    return false;
}

function resolveToolResultErrorFlag(data: Record<string, unknown>, toolName?: string): boolean {
    const likelyCommandFailure = isLikelyCommandExecutionFailure({
        data,
        toolName,
    });
    if (data.isError === true || data.error === true) {
        return true;
    }
    const successValue = data.success;
    if (typeof successValue === 'boolean') {
        if (!successValue) {
            return true;
        }
        if (likelyCommandFailure) {
            return true;
        }
    }
    const status = normalizeText(data.status)?.toLowerCase();
    if (status) {
        if (status === 'error' || status === 'failed' || status === 'failure') {
            return true;
        }
        if (likelyCommandFailure) {
            return true;
        }
    }
    const errorMessage = extractErrorMessage(data.error);
    if (errorMessage) {
        return true;
    }
    return likelyCommandFailure;
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
    const normalizedChunk = normalizeMastraChunk(chunk);
    if (normalizedChunk.type !== 'finish') {
        return null;
    }
    const data = resolveChunkData(normalizedChunk);
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
    const normalizedChunk = normalizeMastraChunk(chunk);
    if (normalizedChunk.type !== 'step-finish' && normalizedChunk.type !== 'finish') {
        return null;
    }
    const data = resolveChunkData(normalizedChunk);
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
    const normalizedChunk = normalizeMastraChunk(chunk);
    const data = resolveChunkData(normalizedChunk);
    if (!data) {
        if (normalizedChunk.type === 'finish') {
            return { type: 'complete', runId };
        }
        return null;
    }
    const normalizedType = typeof normalizedChunk.type === 'string' ? normalizedChunk.type : '';
    const agentTaskNotification = tryBuildAgentTaskNotificationFromEvent(normalizedType, data);
    if (agentTaskNotification) {
        const toolName = 'agent_task_notification';
        if (agentTaskNotification.status === 'running') {
            return {
                type: 'tool_call',
                runId,
                toolName,
                args: {
                    ...agentTaskNotification,
                    xml: buildAgentTaskNotificationXml(agentTaskNotification),
                },
            };
        }
        return {
            type: 'tool_result',
            runId,
            toolCallId: `agent-task:${agentTaskNotification.taskId}`,
            toolName,
            result: {
                ...agentTaskNotification,
                xml: buildAgentTaskNotificationXml(agentTaskNotification),
            },
            isError: agentTaskNotification.status === 'failed',
        };
    }
    switch (normalizedChunk.type) {
        case 'text-delta': {
            const text = resolveStreamTextDelta(normalizedChunk, data);
            if (!text) return null;
            return { type: 'text_delta', content: text, runId, role: 'assistant' };
        }
        case 'reasoning':
        case 'reasoning-delta': {
            const text = resolveStreamTextDelta(normalizedChunk, data);
            if (!text) return null;
            return { type: 'text_delta', content: text, runId, role: 'thinking' };
        }
        case 'tool-call': {
            const toolName = resolveToolName(data);
            if (!toolName) return null;
            return {
                type: 'tool_call',
                runId,
                toolName,
                args: resolveToolArgs(data),
            };
        }
        case 'tool-input-available': {
            const toolName = resolveToolName(data);
            if (!toolName) return null;
            return {
                type: 'tool_call',
                runId,
                toolName,
                args: resolveToolArgs(data),
            };
        }
        case 'tool-call-approval': {
            const toolName = resolveToolName(data);
            if (!toolName) return null;
            const toolCallId = resolveToolCallId(data, toolName);
            if (!toolCallId) return null;
            return {
                type: 'approval_required',
                runId,
                toolCallId,
                toolName,
                args: resolveToolArgs(data),
                resumeSchema: typeof data.resumeSchema === 'string' ? data.resumeSchema : '{}',
            };
        }
        case 'tool-call-suspended': {
            const toolName = resolveToolName(data);
            if (!toolName) return null;
            const toolCallId = resolveToolCallId(data, toolName);
            if (!toolCallId) return null;
            return {
                type: 'suspended',
                runId,
                toolCallId,
                toolName,
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
            const toolName = resolveToolName(data);
            if (!toolName) return null;
            const toolCallId = resolveToolCallId(data, toolName);
            if (!toolCallId) return null;
            return {
                type: 'tool_result',
                runId,
                toolCallId,
                toolName,
                result: resolveToolResultValue(data),
                isError: resolveToolResultErrorFlag(data, toolName),
            };
        }
        case 'tool-output-available':
        case 'tool-output-error': {
            const toolName = resolveToolName(data);
            if (!toolName) return null;
            const toolCallId = resolveToolCallId(data, toolName);
            if (!toolCallId) return null;
            const explicitErrorResult = Object.prototype.hasOwnProperty.call(data, 'error')
                ? data.error
                : undefined;
            return {
                type: 'tool_result',
                runId,
                toolCallId,
                toolName,
                result: normalizedChunk.type === 'tool-output-error' && explicitErrorResult !== undefined
                    ? explicitErrorResult
                    : resolveToolResultValue(data),
                isError: normalizedChunk.type === 'tool-output-error'
                    ? true
                    : resolveToolResultErrorFlag(data, toolName),
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
            if (process.env.COWORKANY_PROXY_DEBUG === '1') {
                console.info('[coworkany-bridge-error-chunk-debug]', {
                    runId,
                    chunkType: normalizedChunk.type ?? null,
                    chunk,
                    data,
                    nestedError: data.error ?? null,
                });
            }
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
