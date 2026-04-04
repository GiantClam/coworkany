import { randomUUID } from 'crypto';
import type { MastraModelOutput } from '@mastra/core/stream';
import { supervisor } from '../mastra/agents/supervisor';
import { TaskContextCompressionStore, type RecalledTopicMemory } from '../mastra/contextCompression';
import { listMcpToolsetsSafe } from '../mastra/mcp/clients';
import { createTaskRequestContext } from '../mastra/requestContext';
import { createTelemetryRunContext } from '../mastra/telemetry';
import {
    extractMastraFinalAssistantTextEvent,
    extractMastraTokenUsageEvent,
    mapMastraChunkToDesktopEvent,
    type DesktopEvent,
    type MastraChunkLike,
} from './bridge';

type SendToDesktop = (event: DesktopEvent) => void;

type CompactHookPayload = {
    taskId: string;
    threadId: string;
    resourceId: string;
    workspacePath?: string;
    microSummary: string;
    structuredSummary: string;
    recalledMemoryFiles: string[];
};

type RunContext = {
    threadId: string;
    resourceId: string;
    taskId: string;
    turnId?: string;
    workspacePath?: string;
    enabledSkills?: string[];
    skillPrompt?: string;
    traceId: string;
    traceSampled: boolean;
};

type TimeoutStage = 'dns' | 'connect' | 'ttfb' | 'first_token' | 'last_token' | 'unknown';

type StreamTimingSnapshot = {
    elapsedMs: number;
    dnsMs: number | null;
    connectMs: number | null;
    ttfbMs: number | null;
    firstTokenMs: number | null;
    lastTokenMs: number | null;
};

type RateLimitedEmitInput = {
    runId?: string;
    attempt?: number;
    maxAttempts?: number;
    retryAfterMs?: number;
    error: unknown;
    message: string;
    stage?: TimeoutStage;
    timings?: StreamTimingSnapshot;
    turnId?: string;
};

const runContextById = new Map<string, RunContext>();
const MAX_CACHED_RUN_CONTEXTS = 256;
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';
const STREAM_START_RETRY_COUNT = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT ?? '1', 10);
const STREAM_START_RETRY_DELAY_MS = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_RETRY_DELAY_MS ?? '250', 10);
const STREAM_FORWARD_RETRY_COUNT = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT ?? '2', 10);
const STREAM_FORWARD_RETRY_DELAY_MS = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_DELAY_MS ?? '800', 10);
const contextCompressionStore = new TaskContextCompressionStore();

const PROVIDER_KEY_MAP: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    aiberm: 'OPENAI_API_KEY',
    google: 'GOOGLE_GENERATIVE_AI_API_KEY',
    xai: 'XAI_API_KEY',
    groq: 'GROQ_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
    mistral: 'MISTRAL_API_KEY',
};

export function resolveMissingApiKeyForModel(
    modelId: string,
    env: Record<string, string | undefined> = process.env,
): string | null {
    const provider = modelId.split('/')[0]?.toLowerCase();
    if (!provider) {
        return null;
    }
    const apiKeyEnv = PROVIDER_KEY_MAP[provider];
    if (!apiKeyEnv) {
        return null;
    }
    return env[apiKeyEnv] ? null : apiKeyEnv;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePositiveIntFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }
    return fallback;
}

function resolveNonNegativeIntFromEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return fallback;
}

function resolveBooleanFromEnv(name: string, fallback: boolean): boolean {
    const raw = process.env[name];
    if (typeof raw !== 'string') {
        return fallback;
    }
    const normalized = raw.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
        return true;
    }
    if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
        return false;
    }
    return fallback;
}

function resolveRemainingBudgetMs(deadlineAt?: number): number | null {
    if (typeof deadlineAt !== 'number' || !Number.isFinite(deadlineAt)) {
        return null;
    }
    return Math.max(0, deadlineAt - Date.now());
}

function isTurnBudgetTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\bchat_turn_timeout_budget_exhausted\b/i.test(message);
}

function isTransientStartError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(stream_start_timeout|timeout|timed out|econnreset|network|429|rate.?limit|temporar(?:y|ily)|unavailable)\b/i.test(message);
}

function isRetryableForwardError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(stream_idle_timeout|stream_progress_timeout|timeout|timed out|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream)\b/i
        .test(message);
}

function resolveTimeoutStageFromError(
    error: unknown,
    context?: { hasAssistantText?: boolean; streamReady?: boolean },
): TimeoutStage {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (context?.hasAssistantText) {
        return 'last_token';
    }
    if (/getaddrinfo|enotfound|eai_again|dns/.test(normalized)) {
        return 'dns';
    }
    if (/econnrefused|connect|socket hang up/.test(normalized)) {
        return 'connect';
    }
    if (/headers timeout|ttfb|stream_start_timeout/.test(normalized)) {
        return 'ttfb';
    }
    if (context?.streamReady) {
        return 'first_token';
    }
    return 'unknown';
}

function buildTimingSnapshot(input: {
    startedAt: number;
    streamReadyAt: number | null;
    firstTokenAt: number | null;
    lastTokenAt: number | null;
    now?: number;
}): StreamTimingSnapshot {
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    return {
        elapsedMs: Math.max(0, now - input.startedAt),
        dnsMs: null,
        connectMs: null,
        ttfbMs: input.streamReadyAt !== null ? Math.max(0, input.streamReadyAt - input.startedAt) : null,
        firstTokenMs: input.firstTokenAt !== null ? Math.max(0, input.firstTokenAt - input.startedAt) : null,
        lastTokenMs: input.lastTokenAt !== null ? Math.max(0, input.lastTokenAt - input.startedAt) : null,
    };
}

async function resolveDynamicToolsetsWithTimeout(): Promise<Awaited<ReturnType<typeof listMcpToolsetsSafe>>> {
    const timeoutMs = resolvePositiveIntFromEnv('COWORKANY_MCP_TOOLSETS_TIMEOUT_MS', 8_000);
    const timeoutResult: Awaited<ReturnType<typeof listMcpToolsetsSafe>> = {};
    try {
        return await Promise.race([
            listMcpToolsetsSafe(),
            new Promise<Awaited<ReturnType<typeof listMcpToolsetsSafe>>>((resolve) => {
                setTimeout(() => resolve(timeoutResult), timeoutMs);
            }),
        ]);
    } catch (error) {
        console.warn('[streaming] MCP toolset preload failed; continuing without MCP toolsets:', error);
        return {};
    }
}

async function withStartRetries<T>(
    factory: () => Promise<T>,
    options?: {
        retryCount?: number;
        retryDelayMs?: number;
        startTimeoutMs?: number;
        onRetry?: (input: {
            attempt: number;
            maxAttempts: number;
            error: unknown;
            retryAfterMs: number;
            startedAt: number;
            streamReadyAt: number | null;
        }) => void;
        deadlineAt?: number;
    },
): Promise<T> {
    let lastError: unknown;
    const retryCount = Number.isFinite(options?.retryCount)
        ? Math.max(0, Math.floor(options?.retryCount ?? 0))
        : (
            Number.isFinite(STREAM_START_RETRY_COUNT) && STREAM_START_RETRY_COUNT > 0
                ? STREAM_START_RETRY_COUNT
                : 0
        );
    const retryDelayMs = Number.isFinite(options?.retryDelayMs)
        ? Math.max(0, Math.floor(options?.retryDelayMs ?? 0))
        : STREAM_START_RETRY_DELAY_MS;
    const maxAttempts = retryCount + 1;
    const startTimeoutMs = Number.isFinite(options?.startTimeoutMs)
        ? Math.max(1_000, Math.floor(options?.startTimeoutMs ?? 45_000))
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_START_TIMEOUT_MS', 45_000);
    const deadlineAt = options?.deadlineAt;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        const remainingBudgetMs = resolveRemainingBudgetMs(deadlineAt);
        if (remainingBudgetMs !== null && remainingBudgetMs <= 0) {
            throw new Error('chat_turn_timeout_budget_exhausted');
        }
        const effectiveStartTimeoutMs = remainingBudgetMs !== null
            ? Math.max(1_000, Math.min(startTimeoutMs, remainingBudgetMs))
            : startTimeoutMs;
        const startedAt = Date.now();
        let streamReadyAt: number | null = null;
        try {
            const result = await (async () => {
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                try {
                    return await Promise.race<T>([
                        factory(),
                        new Promise<T>((_, reject) => {
                            timeoutId = setTimeout(() => {
                                reject(new Error(`stream_start_timeout:${effectiveStartTimeoutMs}`));
                            }, effectiveStartTimeoutMs);
                        }),
                    ]);
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                }
            })();
            streamReadyAt = Date.now();
            return result;
        } catch (error) {
            lastError = error;
            if (attempt >= retryCount || !isTransientStartError(error)) {
                throw error;
            }
            options?.onRetry?.({
                attempt: attempt + 2,
                maxAttempts,
                error,
                retryAfterMs: retryDelayMs,
                startedAt,
                streamReadyAt,
            });
            const budgetBeforeRetryMs = resolveRemainingBudgetMs(deadlineAt);
            if (budgetBeforeRetryMs !== null && budgetBeforeRetryMs <= retryDelayMs) {
                throw new Error('chat_turn_timeout_budget_exhausted');
            }
            await delay(retryDelayMs);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function forwardStream(
    stream: MastraModelOutput<unknown>,
    sendToDesktop: SendToDesktop,
    options?: {
        forcePostAssistantCompletion?: boolean;
        chatTurn?: boolean;
        streamAttemptStartedAt?: number;
        streamReadyAt?: number | null;
        turnId?: string;
        onRateLimited?: (input: RateLimitedEmitInput) => void;
        deadlineAt?: number;
    },
): Promise<{ assistantText: string }> {
    const runId = stream.runId;
    let hasAssistantTextDelta = false;
    let assistantText = '';
    const iterator = stream.fullStream[Symbol.asyncIterator]();
    const isChatTurn = options?.chatTurn === true;
    const idleTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_IDLE_TIMEOUT_MS', 25_000)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_IDLE_TIMEOUT_MS', 60_000);
    const progressTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_PROGRESS_TIMEOUT_MS', 20_000)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_PROGRESS_TIMEOUT_MS', 45_000);
    const postAssistantIdleCompleteMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_POST_ASSISTANT_IDLE_COMPLETE_MS', 12_000)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_POST_ASSISTANT_IDLE_COMPLETE_MS', 35_000);
    const postAssistantMaxCompleteMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS', 20_000)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_POST_ASSISTANT_MAX_MS', 45_000);
    const maxDurationMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS', 90_000)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_MAX_DURATION_MS', 180_000);
    const streamStartedAt = Date.now();
    let lastProgressAt = Date.now();
    let ignoredChunkCount = 0;
    let sawTerminalEvent = false;
    let firstAssistantTextAt: number | null = null;
    let lastAssistantTextAt: number | null = null;
    let sawToolingAfterAssistantText = false;
    const streamAttemptStartedAt = typeof options?.streamAttemptStartedAt === 'number'
        ? options.streamAttemptStartedAt
        : streamStartedAt;
    const streamReadyAt = typeof options?.streamReadyAt === 'number'
        ? options.streamReadyAt
        : null;
    const tailRetryCount = isChatTurn
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_COUNT', 2)
        : resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_STREAM_TAIL_RETRY_COUNT', 0);
    const tailRetryDelayMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_DELAY_MS', 1_200)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_STREAM_TAIL_RETRY_DELAY_MS', 800);
    let tailRetryAttempt = 0;
    const deadlineAt = options?.deadlineAt;

    while (true) {
        const remainingBudgetMs = resolveRemainingBudgetMs(deadlineAt);
        if (remainingBudgetMs !== null && remainingBudgetMs <= 0) {
            if (hasAssistantTextDelta && !sawTerminalEvent) {
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'assistant_text_turn_timeout_budget',
                });
                break;
            }
            throw new Error('chat_turn_timeout_budget_exhausted');
        }
        if (
            firstAssistantTextAt !== null
            && (options?.forcePostAssistantCompletion === true || !sawToolingAfterAssistantText)
            && Date.now() - firstAssistantTextAt >= postAssistantMaxCompleteMs
            && !sawTerminalEvent
        ) {
            try {
                await iterator.return?.();
            } catch {
                // Ignore cleanup failures.
            }
            sawTerminalEvent = true;
            sendToDesktop({
                type: 'complete',
                runId,
                finishReason: 'assistant_text_settled_max_window',
            });
            break;
        }

        const effectiveMaxDurationMs = remainingBudgetMs !== null
            ? Math.min(maxDurationMs, remainingBudgetMs)
            : maxDurationMs;
        if (Date.now() - streamStartedAt >= effectiveMaxDurationMs) {
            try {
                await iterator.return?.();
            } catch {
                // Ignore cleanup failures.
            }
            if (hasAssistantTextDelta && !sawTerminalEvent) {
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: 'stream_max_duration_after_text',
                });
                break;
            }
            throw new Error(`stream_max_duration_timeout:${maxDurationMs}`);
        }

        let result: IteratorResult<unknown>;
        try {
            result = await (async () => {
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                const boundedIdleTimeoutMs = hasAssistantTextDelta
                    ? Math.min(idleTimeoutMs, postAssistantIdleCompleteMs)
                    : idleTimeoutMs;
                const effectiveIdleTimeoutMs = remainingBudgetMs !== null
                    ? Math.max(1_000, Math.min(boundedIdleTimeoutMs, remainingBudgetMs))
                    : boundedIdleTimeoutMs;
                try {
                    return await Promise.race<IteratorResult<unknown>>([
                        iterator.next(),
                        new Promise<IteratorResult<unknown>>((_, reject) => {
                            timeoutId = setTimeout(() => {
                                reject(new Error(`stream_idle_timeout:${effectiveIdleTimeoutMs}`));
                            }, effectiveIdleTimeoutMs);
                        }),
                    ]);
                } finally {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                    }
                }
            })();
        } catch (error) {
            const canTailRetry = hasAssistantTextDelta
                && isRetryableForwardError(error)
                && tailRetryAttempt < tailRetryCount;
            if (canTailRetry) {
                tailRetryAttempt += 1;
                options?.onRateLimited?.({
                    runId,
                    attempt: tailRetryAttempt + 1,
                    maxAttempts: tailRetryCount + 1,
                    retryAfterMs: tailRetryDelayMs,
                    error,
                    stage: resolveTimeoutStageFromError(error, {
                        hasAssistantText: true,
                        streamReady: streamReadyAt !== null,
                    }),
                    timings: buildTimingSnapshot({
                        startedAt: streamAttemptStartedAt,
                        streamReadyAt,
                        firstTokenAt: firstAssistantTextAt,
                        lastTokenAt: lastAssistantTextAt,
                    }),
                    turnId: options?.turnId,
                    message: `Response tail stalled. Retrying stream tail (${tailRetryAttempt}/${tailRetryCount})...`,
                });
                await delay(tailRetryDelayMs * tailRetryAttempt);
                continue;
            }
            try {
                await iterator.return?.();
            } catch {
                // Ignore cleanup failures.
            }
            if (
                hasAssistantTextDelta
                && !sawTerminalEvent
                && isRetryableForwardError(error)
            ) {
                sawTerminalEvent = true;
                sendToDesktop({
                    type: 'complete',
                    runId,
                    finishReason: /\bstream_(?:idle|progress)_timeout\b/i.test(String(error))
                        ? 'assistant_text_idle'
                        : 'assistant_text_stream_interrupted',
                });
                break;
            }
            throw error;
        }

        if (result.done) {
            break;
        }
        const chunk = result.value;
        let hasProgress = false;
        const tokenUsageEvent = extractMastraTokenUsageEvent(chunk as MastraChunkLike, runId);
        if (tokenUsageEvent) {
            sendToDesktop(tokenUsageEvent);
            hasProgress = true;
        }
        if (!hasAssistantTextDelta) {
            const finalTextEvent = extractMastraFinalAssistantTextEvent(chunk as MastraChunkLike, runId);
            if (finalTextEvent && finalTextEvent.type === 'text_delta' && finalTextEvent.content) {
                hasAssistantTextDelta = true;
                const now = Date.now();
                if (firstAssistantTextAt === null) {
                    firstAssistantTextAt = now;
                }
                lastAssistantTextAt = now;
                if (finalTextEvent.role !== 'thinking') {
                    assistantText += finalTextEvent.content;
                }
                sendToDesktop(finalTextEvent);
                hasProgress = true;
            }
        }
        const event = mapMastraChunkToDesktopEvent(chunk as MastraChunkLike, runId);
        if (event) {
            if (
                event.type === 'text_delta'
                && event.role !== 'thinking'
                && typeof event.content === 'string'
                && event.content.length > 0
            ) {
                hasAssistantTextDelta = true;
                const now = Date.now();
                if (firstAssistantTextAt === null) {
                    firstAssistantTextAt = now;
                }
                lastAssistantTextAt = now;
                assistantText += event.content;
            }
            if (
                hasAssistantTextDelta
                && (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'approval_required' || event.type === 'suspended')
            ) {
                sawToolingAfterAssistantText = true;
            }
            if (event.type === 'complete' || event.type === 'error' || event.type === 'tripwire') {
                sawTerminalEvent = true;
            }
            sendToDesktop(event);
            hasProgress = true;
        }

        if (hasProgress) {
            lastProgressAt = Date.now();
            ignoredChunkCount = 0;
        } else {
            ignoredChunkCount += 1;
            if (Date.now() - lastProgressAt >= progressTimeoutMs) {
                try {
                    await iterator.return?.();
                } catch {
                    // Ignore cleanup failures and report timeout upstream.
                }
                throw new Error(`stream_progress_timeout:${progressTimeoutMs};ignored_chunks:${ignoredChunkCount}`);
            }
        }
    }
    if (!sawTerminalEvent) {
        sendToDesktop({
            type: 'complete',
            runId,
            finishReason: 'stream_exhausted',
        });
    }
    return {
        assistantText: assistantText.trim(),
    };
}

function cacheRunContext(runId: string, context: RunContext): void {
    runContextById.set(runId, context);
    if (runContextById.size <= MAX_CACHED_RUN_CONTEXTS) {
        return;
    }
    const oldestRunId = runContextById.keys().next().value;
    if (typeof oldestRunId === 'string') {
        runContextById.delete(oldestRunId);
    }
}

function sendWithRunContextCleanup(runId: string, sendToDesktop: SendToDesktop): SendToDesktop {
    return (event) => {
        const runContext = runContextById.get(runId);
        const withContext = runContext && event.runId === runId
            ? {
                ...event,
                traceId: event.traceId ?? runContext.traceId,
                turnId: event.turnId ?? runContext.turnId,
            }
            : event;
        sendToDesktop(withContext);
        if (event.runId === runId && (event.type === 'error' || event.type === 'tripwire')) {
            runContextById.delete(runId);
        }
    };
}

export async function handleUserMessage(
    message: string,
    threadId: string,
    resourceId: string,
    sendToDesktop: SendToDesktop,
    options?: {
        taskId?: string;
        turnId?: string;
        workspacePath?: string;
        enabledSkills?: string[];
        skillPrompt?: string;
        forcePostAssistantCompletion?: boolean;
        requireToolApproval?: boolean;
        autoResumeSuspendedTools?: boolean;
        toolCallConcurrency?: number;
        maxSteps?: number;
        onPreCompact?: (payload: CompactHookPayload) => void;
        onPostCompact?: (payload: CompactHookPayload) => void;
    },
): Promise<{ runId: string }> {
    const taskId = options?.taskId ?? threadId;
    contextCompressionStore.recordUserTurn({
        taskId,
        threadId,
        resourceId,
        workspacePath: options?.workspacePath,
        content: message,
    });
    const promptPack = contextCompressionStore.buildPromptPack(taskId);
    const recalledTopicMemories: RecalledTopicMemory[] = promptPack?.recalledTopicMemories ?? [];
    if (promptPack) {
        options?.onPreCompact?.({
            taskId,
            threadId,
            resourceId,
            workspacePath: options?.workspacePath,
            microSummary: promptPack.microSummary,
            structuredSummary: promptPack.structuredSummary,
            recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
        });
    }
    const effectiveMessage = message;

    const modelId = process.env.COWORKANY_MODEL || DEFAULT_MODEL_ID;
    const modelProvider = modelId.split('/')[0]?.toLowerCase() ?? '';
    const openAiResponseStoreEnabled = resolveBooleanFromEnv(
        'COWORKANY_OPENAI_RESPONSES_STORE',
        true,
    );
    const providerOptions = modelProvider === 'openai'
        ? {
            openai: {
                store: openAiResponseStoreEnabled,
            },
        }
        : undefined;
    const missingApiKey = resolveMissingApiKeyForModel(modelId);
    if (missingApiKey) {
        if (promptPack) {
            options?.onPostCompact?.({
                taskId,
                threadId,
                resourceId,
                workspacePath: options?.workspacePath,
                microSummary: promptPack.microSummary,
                structuredSummary: promptPack.structuredSummary,
                recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
            });
        }
        const runId = `preflight-${randomUUID()}`;
        sendToDesktop({
            type: 'error',
            runId,
            message: `missing_api_key:${missingApiKey}`,
        });
        return { runId };
    }

    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId,
        workspacePath: options?.workspacePath,
        enabledSkills: options?.enabledSkills,
        skillPrompt: options?.skillPrompt,
    });
    const telemetry = createTelemetryRunContext({
        taskId,
        threadId,
        resourceId,
        workspacePath: options?.workspacePath,
    });
    const dynamicToolsets = await resolveDynamicToolsetsWithTimeout();
    const streamOptions = {
        memory: {
            thread: threadId,
            resource: resourceId,
        },
        requestContext,
        tracingOptions: telemetry.tracingOptions,
        toolsets: Object.keys(dynamicToolsets).length > 0 ? dynamicToolsets : undefined,
        requireToolApproval: options?.requireToolApproval,
        autoResumeSuspendedTools: options?.autoResumeSuspendedTools ?? true,
        toolCallConcurrency: options?.toolCallConcurrency ?? 1,
        maxSteps: options?.maxSteps ?? 16,
        providerOptions,
    };

    const isChatTurn = options?.forcePostAssistantCompletion === true;
    const chatTurnTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS', 90_000)
        : 0;
    const chatTurnDeadlineAt = isChatTurn
        ? Date.now() + chatTurnTimeoutMs
        : null;
    const forwardRetryCount = isChatTurn
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT', 2)
        : (
            Number.isFinite(STREAM_FORWARD_RETRY_COUNT) && STREAM_FORWARD_RETRY_COUNT > 0
                ? STREAM_FORWARD_RETRY_COUNT
                : 0
        );
    const forwardRetryDelayMs = Number.isFinite(STREAM_FORWARD_RETRY_DELAY_MS) && STREAM_FORWARD_RETRY_DELAY_MS > 0
        ? STREAM_FORWARD_RETRY_DELAY_MS
        : 800;
    const startRetryCount = isChatTurn
        ? resolveNonNegativeIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT', 2)
        : undefined;
    const startRetryDelayMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS', 250)
        : undefined;
    const startTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS', 75_000)
        : undefined;

    const fallbackToGenerateOnStartTimeout = resolveBooleanFromEnv('COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK', true);
    const generateFallbackTimeoutMs = isChatTurn
        ? resolvePositiveIntFromEnv('COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS', 75_000)
        : resolvePositiveIntFromEnv('COWORKANY_MASTRA_GENERATE_FALLBACK_TIMEOUT_MS', 45_000);
    const emitRateLimited = (input: RateLimitedEmitInput): void => {
        sendToDesktop({
            type: 'rate_limited',
            runId: input.runId,
            attempt: input.attempt,
            maxAttempts: input.maxAttempts,
            retryAfterMs: input.retryAfterMs,
            error: String(input.error),
            message: input.message,
            stage: input.stage,
            timings: input.timings,
            turnId: input.turnId,
        });
    };
    const flushPostCompactWithPromptPack = (): void => {
        if (!promptPack) {
            return;
        }
        options?.onPostCompact?.({
            taskId,
            threadId,
            resourceId,
            workspacePath: options?.workspacePath,
            microSummary: promptPack.microSummary,
            structuredSummary: promptPack.structuredSummary,
            recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
        });
    };
    const runGenerateFallback = async (
        reason: string,
    ): Promise<{ runId: string } | null> => {
        if (!fallbackToGenerateOnStartTimeout) {
            return null;
        }
        emitRateLimited({
            attempt: 1,
            maxAttempts: 1,
            retryAfterMs: 0,
            error: reason,
            message: 'Model stream stalled. Switching to non-streaming fallback...',
            turnId: options?.turnId,
            stage: resolveTimeoutStageFromError(reason, {
                hasAssistantText: false,
                streamReady: false,
            }),
            timings: buildTimingSnapshot({
                startedAt: Date.now(),
                streamReadyAt: null,
                firstTokenAt: null,
                lastTokenAt: null,
            }),
        });
        try {
            const remainingBudgetMs = resolveRemainingBudgetMs(chatTurnDeadlineAt ?? undefined);
            const effectiveGenerateFallbackTimeoutMs = remainingBudgetMs !== null
                ? Math.max(1_000, Math.min(generateFallbackTimeoutMs, remainingBudgetMs))
                : generateFallbackTimeoutMs;
            if (remainingBudgetMs !== null && remainingBudgetMs <= 0) {
                throw new Error('chat_turn_timeout_budget_exhausted');
            }
            const generated = await Promise.race([
                supervisor.generate(effectiveMessage, streamOptions),
                new Promise<never>((_, reject) => {
                    setTimeout(() => reject(new Error(`generate_fallback_timeout:${effectiveGenerateFallbackTimeoutMs}`)), effectiveGenerateFallbackTimeoutMs);
                }),
            ]);
            const fallbackRunId = typeof generated.runId === 'string' && generated.runId.length > 0
                ? generated.runId
                : `generate-fallback-${randomUUID()}`;
            cacheRunContext(fallbackRunId, {
                threadId,
                resourceId,
                taskId,
                turnId: options?.turnId,
                workspacePath: options?.workspacePath,
                enabledSkills: options?.enabledSkills,
                skillPrompt: options?.skillPrompt,
                traceId: telemetry.traceId,
                traceSampled: telemetry.sampled,
            });

            if (generated.error) {
                throw generated.error;
            }

            const generatedText = typeof generated.text === 'string' ? generated.text.trim() : '';
            if (generatedText.length > 0) {
                sendToDesktop({
                    type: 'text_delta',
                    runId: fallbackRunId,
                    role: 'assistant',
                    content: generatedText,
                    turnId: options?.turnId,
                });
                const updated = contextCompressionStore.recordAssistantTurn({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    content: generatedText,
                });
                options?.onPostCompact?.({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    microSummary: updated.microSummary,
                    structuredSummary: updated.structuredSummary,
                    recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
                });
            } else {
                flushPostCompactWithPromptPack();
            }
            sendToDesktop({
                type: 'complete',
                runId: fallbackRunId,
                finishReason: generated.finishReason ?? 'fallback_generate',
                turnId: options?.turnId,
            });
            return { runId: fallbackRunId };
        } catch (fallbackError) {
            const runId = `start-failed-${randomUUID()}`;
            sendToDesktop({
                type: 'error',
                runId,
                message: String(fallbackError),
                turnId: options?.turnId,
            });
            return { runId };
        }
    };

    let attempt = 0;
    while (true) {
        if (chatTurnDeadlineAt !== null && Date.now() >= chatTurnDeadlineAt) {
            const runId = `start-failed-${randomUUID()}`;
            emitRateLimited({
                runId,
                attempt: 1,
                maxAttempts: 1,
                retryAfterMs: 0,
                error: 'chat_turn_timeout_budget_exhausted',
                message: 'Chat turn exceeded timeout budget before model response.',
                stage: 'unknown',
                timings: buildTimingSnapshot({
                    startedAt: chatTurnDeadlineAt - chatTurnTimeoutMs,
                    streamReadyAt: null,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                turnId: options?.turnId,
            });
            sendToDesktop({
                type: 'error',
                runId,
                message: 'chat_turn_timeout_budget_exhausted',
                turnId: options?.turnId,
            });
            return { runId };
        }
        let stream: Awaited<ReturnType<typeof supervisor.stream>>;
        const attemptStartedAt = Date.now();
        let streamReadyAt: number | null = null;
        try {
            stream = await withStartRetries(async () => await supervisor.stream(effectiveMessage, streamOptions), {
                retryCount: startRetryCount,
                retryDelayMs: startRetryDelayMs,
                startTimeoutMs,
                deadlineAt: chatTurnDeadlineAt ?? undefined,
                onRetry: ({ attempt: retryAttempt, maxAttempts, error, retryAfterMs, startedAt, streamReadyAt: retryStreamReadyAt }) => {
                    emitRateLimited({
                        attempt: retryAttempt,
                        maxAttempts,
                        retryAfterMs,
                        error,
                        message: `Model startup delayed. Retrying (${retryAttempt}/${maxAttempts})...`,
                        stage: resolveTimeoutStageFromError(error, {
                            hasAssistantText: false,
                            streamReady: retryStreamReadyAt !== null,
                        }),
                        timings: buildTimingSnapshot({
                            startedAt,
                            streamReadyAt: retryStreamReadyAt,
                            firstTokenAt: null,
                            lastTokenAt: null,
                        }),
                        turnId: options?.turnId,
                    });
                },
            });
            streamReadyAt = Date.now();
        } catch (error) {
            if (fallbackToGenerateOnStartTimeout && isTransientStartError(error)) {
                const fallbackResult = await runGenerateFallback(String(error));
                if (fallbackResult) {
                    return fallbackResult;
                }
            }
            const runId = `start-failed-${randomUUID()}`;
            emitRateLimited({
                runId,
                attempt: 1,
                maxAttempts: 1,
                retryAfterMs: 0,
                error,
                message: 'Model startup failed before first token.',
                stage: resolveTimeoutStageFromError(error, {
                    hasAssistantText: false,
                    streamReady: streamReadyAt !== null,
                }),
                timings: buildTimingSnapshot({
                    startedAt: attemptStartedAt,
                    streamReadyAt,
                    firstTokenAt: null,
                    lastTokenAt: null,
                }),
                turnId: options?.turnId,
            });
            sendToDesktop({
                type: 'error',
                runId,
                message: String(error),
                turnId: options?.turnId,
            });
            return { runId };
        }
        cacheRunContext(stream.runId, {
            threadId,
            resourceId,
            taskId,
            turnId: options?.turnId,
            workspacePath: options?.workspacePath,
            enabledSkills: options?.enabledSkills,
            skillPrompt: options?.skillPrompt,
            traceId: telemetry.traceId,
            traceSampled: telemetry.sampled,
        });
        let emittedAssistantText = false;
        const sendWithAttemptTracking = sendWithRunContextCleanup(stream.runId, (event) => {
            if (
                event.type === 'text_delta'
                && event.role !== 'thinking'
                && typeof event.content === 'string'
                && event.content.trim().length > 0
            ) {
                emittedAssistantText = true;
            }
            sendToDesktop(
                options?.turnId && !event.turnId
                    ? { ...event, turnId: options.turnId }
                    : event,
            );
        });
        try {
            const forwarded = await forwardStream(stream, sendWithAttemptTracking, {
                forcePostAssistantCompletion: options?.forcePostAssistantCompletion,
                chatTurn: isChatTurn,
                streamAttemptStartedAt: attemptStartedAt,
                streamReadyAt,
                turnId: options?.turnId,
                onRateLimited: emitRateLimited,
                deadlineAt: chatTurnDeadlineAt ?? undefined,
            });
            if (forwarded.assistantText.length > 0) {
                const updated = contextCompressionStore.recordAssistantTurn({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    content: forwarded.assistantText,
                });
                options?.onPostCompact?.({
                    taskId,
                    threadId,
                    resourceId,
                    workspacePath: options?.workspacePath,
                    microSummary: updated.microSummary,
                    structuredSummary: updated.structuredSummary,
                    recalledMemoryFiles: recalledTopicMemories.map((entry) => entry.relativePath),
                });
            } else {
                flushPostCompactWithPromptPack();
            }
            return { runId: stream.runId };
        } catch (error) {
            runContextById.delete(stream.runId);
            const canRetry = attempt < forwardRetryCount
                && isRetryableForwardError(error)
                && emittedAssistantText === false
                && !isTurnBudgetTimeoutError(error);
            if (canRetry) {
                attempt += 1;
                const maxAttempts = forwardRetryCount + 1;
                emitRateLimited({
                    runId: stream.runId,
                    attempt: attempt + 1,
                    maxAttempts,
                    retryAfterMs: forwardRetryDelayMs,
                    error,
                    message: `Model response delayed. Retrying (${attempt + 1}/${maxAttempts})...`,
                    stage: resolveTimeoutStageFromError(error, {
                        hasAssistantText: emittedAssistantText,
                        streamReady: streamReadyAt !== null,
                    }),
                    timings: buildTimingSnapshot({
                        startedAt: attemptStartedAt,
                        streamReadyAt,
                        firstTokenAt: null,
                        lastTokenAt: null,
                    }),
                });
                await delay(forwardRetryDelayMs * attempt);
                continue;
            }
            if (!emittedAssistantText && isRetryableForwardError(error)) {
                const fallbackResult = await runGenerateFallback(String(error));
                if (fallbackResult) {
                    return fallbackResult;
                }
            }
            sendToDesktop({
                type: 'error',
                runId: stream.runId,
                message: String(error),
            });
            return { runId: stream.runId };
        }
    }
}

export async function handleApprovalResponse(
    runId: string,
    toolCallId: string,
    approved: boolean,
    sendToDesktop: SendToDesktop,
): Promise<void> {
    const runContext = runContextById.get(runId);
    const baseOptions = {
        runId,
        toolCallId,
        requestContext: runContext
            ? createTaskRequestContext({
                threadId: runContext.threadId,
                resourceId: runContext.resourceId,
                taskId: runContext.taskId,
                workspacePath: runContext.workspacePath,
                enabledSkills: runContext.enabledSkills,
                skillPrompt: runContext.skillPrompt,
            })
            : undefined,
        memory: runContext
            ? {
                thread: runContext.threadId,
                resource: runContext.resourceId,
            }
            : undefined,
        tracingOptions: runContext?.traceSampled
            ? {
                traceId: runContext.traceId,
                tags: [
                    'runtime:desktop-sidecar',
                    'resume:tool-approval',
                    `task:${runContext.taskId}`,
                    `resource:${runContext.resourceId}`,
                    `thread:${runContext.threadId}`,
                ],
            }
            : undefined,
    };
    const stream = approved
        ? await withStartRetries(async () => await supervisor.approveToolCall(baseOptions))
        : await withStartRetries(async () => await supervisor.declineToolCall(baseOptions));
    try {
        await forwardStream(stream, sendWithRunContextCleanup(runId, sendToDesktop));
    } catch (error) {
        runContextById.delete(runId);
        sendToDesktop({
            type: 'error',
            runId,
            message: String(error),
        });
    }
}

export function rewindTaskContextCompression(input: {
    taskId: string;
    userTurns: number;
}): {
    success: boolean;
    removedTurns: number;
    remainingTurns: number;
} {
    return contextCompressionStore.rewindByUserTurns(input.taskId, input.userTurns);
}
