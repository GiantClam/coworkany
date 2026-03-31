import { randomUUID } from 'crypto';
import type { MastraModelOutput } from '@mastra/core/stream';
import { supervisor } from '../mastra/agents/supervisor';
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
type RunContext = {
    threadId: string;
    resourceId: string;
    taskId: string;
    workspacePath?: string;
    traceId: string;
    traceSampled: boolean;
};
const runContextById = new Map<string, RunContext>();
const MAX_CACHED_RUN_CONTEXTS = 256;
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';
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
async function forwardStream(stream: MastraModelOutput<unknown>, sendToDesktop: SendToDesktop): Promise<void> {
    const runId = stream.runId;
    let hasAssistantTextDelta = false;
    for await (const chunk of stream.fullStream) {
        const tokenUsageEvent = extractMastraTokenUsageEvent(chunk as MastraChunkLike, runId);
        if (tokenUsageEvent) {
            sendToDesktop(tokenUsageEvent);
        }
        if (!hasAssistantTextDelta) {
            const finalTextEvent = extractMastraFinalAssistantTextEvent(chunk as MastraChunkLike, runId);
            if (finalTextEvent && finalTextEvent.type === 'text_delta' && finalTextEvent.content) {
                hasAssistantTextDelta = true;
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
            }
            sendToDesktop(event);
        }
    }
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
        requireToolApproval?: boolean;
        autoResumeSuspendedTools?: boolean;
        toolCallConcurrency?: number;
        maxSteps?: number;
    },
): Promise<{ runId: string }> {
    const modelId = process.env.COWORKANY_MODEL || DEFAULT_MODEL_ID;
    const missingApiKey = resolveMissingApiKeyForModel(modelId);
    if (missingApiKey) {
        const runId = `preflight-${randomUUID()}`;
        sendToDesktop({
            type: 'error',
            runId,
            message: `missing_api_key:${missingApiKey}`,
        });
        return { runId };
    }
    const taskId = options?.taskId ?? threadId;
    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId,
        workspacePath: options?.workspacePath,
    });
    const telemetry = createTelemetryRunContext({
        taskId,
        threadId,
        resourceId,
        workspacePath: options?.workspacePath,
    });
    const dynamicToolsets = await listMcpToolsetsSafe();
    const stream = await supervisor.stream(message, {
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
    });
    cacheRunContext(stream.runId, {
        threadId,
        resourceId,
        taskId,
        workspacePath: options?.workspacePath,
        traceId: telemetry.traceId,
        traceSampled: telemetry.sampled,
    });
    try {
        await forwardStream(stream, sendWithRunContextCleanup(stream.runId, sendToDesktop));
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
        ? await supervisor.approveToolCall(baseOptions)
        : await supervisor.declineToolCall(baseOptions);
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
