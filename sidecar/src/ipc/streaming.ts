import { randomUUID } from 'crypto';
import type { MastraModelOutput } from '@mastra/core/stream';
import { supervisor } from '../mastra/agents/supervisor';
import {
    extractMastraTokenUsageEvent,
    mapMastraChunkToDesktopEvent,
    type DesktopEvent,
    type MastraChunkLike,
} from './bridge';
type SendToDesktop = (event: DesktopEvent) => void;
type RunContext = {
    threadId: string;
    resourceId: string;
};
const runContextById = new Map<string, RunContext>();
const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-5';
const PROVIDER_KEY_MAP: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
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
    for await (const chunk of stream.fullStream) {
        const tokenUsageEvent = extractMastraTokenUsageEvent(chunk as MastraChunkLike, runId);
        if (tokenUsageEvent) {
            sendToDesktop(tokenUsageEvent);
        }
        const event = mapMastraChunkToDesktopEvent(chunk as MastraChunkLike, runId);
        if (event) {
            sendToDesktop(event);
        }
    }
}
export async function handleUserMessage(
    message: string,
    threadId: string,
    resourceId: string,
    sendToDesktop: SendToDesktop,
    options?: {
        requireToolApproval?: boolean;
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
        sendToDesktop({
            type: 'complete',
            runId,
            finishReason: 'error',
        });
        return { runId };
    }
    const stream = await supervisor.stream(message, {
        memory: {
            thread: threadId,
            resource: resourceId,
        },
        requireToolApproval: options?.requireToolApproval ?? true,
        maxSteps: options?.maxSteps ?? 16,
    });
    runContextById.set(stream.runId, { threadId, resourceId });
    try {
        await forwardStream(stream, sendToDesktop);
    } catch (error) {
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
        memory: runContext
            ? {
                thread: runContext.threadId,
                resource: runContext.resourceId,
            }
            : undefined,
    };
    const stream = approved
        ? await supervisor.approveToolCall(baseOptions)
        : await supervisor.declineToolCall(baseOptions);
    try {
        await forwardStream(stream, sendToDesktop);
    } catch (error) {
        sendToDesktop({
            type: 'error',
            runId,
            message: String(error),
        });
    }
}
