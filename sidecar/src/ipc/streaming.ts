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
    workspacePath?: string;
    enabledSkills?: string[];
    traceId: string;
    traceSampled: boolean;
};

const runContextById = new Map<string, RunContext>();
const MAX_CACHED_RUN_CONTEXTS = 256;
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';
const STREAM_START_RETRY_COUNT = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT ?? '1', 10);
const STREAM_START_RETRY_DELAY_MS = Number.parseInt(process.env.COWORKANY_MASTRA_STREAM_RETRY_DELAY_MS ?? '250', 10);
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

function isTransientStartError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /\b(timeout|timed out|econnreset|network|429|rate.?limit|temporar(?:y|ily)|unavailable)\b/i.test(message);
}

async function withStartRetries<T>(factory: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    const retryCount = Number.isFinite(STREAM_START_RETRY_COUNT) && STREAM_START_RETRY_COUNT > 0
        ? STREAM_START_RETRY_COUNT
        : 0;

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
            return await factory();
        } catch (error) {
            lastError = error;
            if (attempt >= retryCount || !isTransientStartError(error)) {
                throw error;
            }
            await delay(STREAM_START_RETRY_DELAY_MS);
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function forwardStream(
    stream: MastraModelOutput<unknown>,
    sendToDesktop: SendToDesktop,
): Promise<{ assistantText: string }> {
    const runId = stream.runId;
    let hasAssistantTextDelta = false;
    let assistantText = '';
    for await (const chunk of stream.fullStream) {
        const tokenUsageEvent = extractMastraTokenUsageEvent(chunk as MastraChunkLike, runId);
        if (tokenUsageEvent) {
            sendToDesktop(tokenUsageEvent);
        }
        if (!hasAssistantTextDelta) {
            const finalTextEvent = extractMastraFinalAssistantTextEvent(chunk as MastraChunkLike, runId);
            if (finalTextEvent && finalTextEvent.type === 'text_delta' && finalTextEvent.content) {
                hasAssistantTextDelta = true;
                if (finalTextEvent.role !== 'thinking') {
                    assistantText += finalTextEvent.content;
                }
                sendToDesktop(finalTextEvent);
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
                assistantText += event.content;
            }
            sendToDesktop(event);
        }
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
        const withTrace = runContext && event.runId === runId && !event.traceId
            ? {
                ...event,
                traceId: runContext.traceId,
            }
            : event;
        sendToDesktop(withTrace);
        if (event.runId === runId && (event.type === 'complete' || event.type === 'error' || event.type === 'tripwire')) {
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
        workspacePath?: string;
        enabledSkills?: string[];
        skillPrompt?: string;
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
    const contextPreamble = promptPack?.preamble;
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
    const promptSections: string[] = [];
    if (typeof options?.skillPrompt === 'string' && options.skillPrompt.trim().length > 0) {
        promptSections.push(options.skillPrompt.trim());
    }
    if (typeof contextPreamble === 'string' && contextPreamble.trim().length > 0) {
        promptSections.push(contextPreamble.trim());
    }
    const effectiveMessage = promptSections.length > 0
        ? `${promptSections.join('\n\n')}\n\n[Latest User Request]\n${message}`
        : message;

    const modelId = process.env.COWORKANY_MODEL || DEFAULT_MODEL_ID;
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
    });
    const telemetry = createTelemetryRunContext({
        taskId,
        threadId,
        resourceId,
        workspacePath: options?.workspacePath,
    });
    const dynamicToolsets = await listMcpToolsetsSafe();
    const stream = await withStartRetries(async () => await supervisor.stream(effectiveMessage, {
        memory: {
            thread: threadId,
            resource: resourceId,
        },
        requestContext,
        tracingOptions: telemetry.tracingOptions,
        toolsets: Object.keys(dynamicToolsets).length > 0 ? dynamicToolsets : undefined,
        requireToolApproval: options?.requireToolApproval ?? true,
        autoResumeSuspendedTools: options?.autoResumeSuspendedTools ?? true,
        toolCallConcurrency: options?.toolCallConcurrency ?? 1,
        maxSteps: options?.maxSteps ?? 16,
    }));
    cacheRunContext(stream.runId, {
        threadId,
        resourceId,
        taskId,
        workspacePath: options?.workspacePath,
        enabledSkills: options?.enabledSkills,
        traceId: telemetry.traceId,
        traceSampled: telemetry.sampled,
    });
    try {
        const forwarded = await forwardStream(stream, sendWithRunContextCleanup(stream.runId, sendToDesktop));
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
        } else if (promptPack) {
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
    } catch (error) {
        runContextById.delete(stream.runId);
        sendToDesktop({
            type: 'error',
            runId: stream.runId,
            message: String(error),
        });
    }
    return { runId: stream.runId };
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
