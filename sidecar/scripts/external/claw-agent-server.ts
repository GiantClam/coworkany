#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { handleUserMessage } from '../../src/ipc/streaming.ts';
import { seedRuntimeLlmEnvFromConfig } from '../../src/config/runtimeConfig.ts';

type DesktopEvent = {
    type: string;
    runId?: string;
    role?: string;
    content?: string;
    message?: string;
    inputTokens?: number;
    outputTokens?: number;
    [key: string]: unknown;
};

type ClawTaskRequest = {
    task_id?: string;
    instruction?: string;
    workspace?: string;
    timeout_seconds?: number;
};

type ClawTaskResponse = {
    status: 'completed' | 'failed' | 'timeout';
    output: string;
    tokens_used?: number;
    duration_seconds?: number;
};

type ServerConfig = {
    host: string;
    port: number;
    name: string;
    maxSteps: number;
    maxConcurrency: number;
    defaultTimeoutSeconds: number;
    requestBodyLimit: string;
};

class TaskTimeoutError extends Error {
    readonly timeoutMs: number;

    constructor(timeoutMs: number) {
        super(`task_timeout:${timeoutMs}`);
        this.name = 'TaskTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}

function usage(): never {
    console.log(
        'Usage: bun scripts/external/claw-agent-server.ts'
        + ' [--host <host>] [--port <port>] [--name <agent-name>]'
        + ' [--max-steps <n>] [--max-concurrency <n>] [--default-timeout <seconds>]',
    );
    process.exit(0);
}

function readArg(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    if (index < 0) {
        return undefined;
    }
    return args[index + 1];
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
    if (!raw) {
        return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBoundedInt(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.floor(value)));
}

function parseConfig(argv: string[]): ServerConfig {
    if (argv.includes('--help') || argv.includes('-h')) {
        usage();
    }

    const host = readArg(argv, '--host')?.trim()
        || process.env.COWORKANY_AGENT_HOST?.trim()
        || '127.0.0.1';
    const port = toPositiveInt(
        readArg(argv, '--port') ?? process.env.COWORKANY_AGENT_PORT,
        3000,
    );
    const name = readArg(argv, '--name')?.trim()
        || process.env.COWORKANY_AGENT_NAME?.trim()
        || 'coworkany-sidecar';
    const maxSteps = toPositiveInt(
        readArg(argv, '--max-steps') ?? process.env.COWORKANY_CLAW_MAX_STEPS,
        16,
    );
    const maxConcurrency = toPositiveInt(
        readArg(argv, '--max-concurrency') ?? process.env.COWORKANY_AGENT_MAX_CONCURRENCY,
        1,
    );
    const defaultTimeoutSeconds = toPositiveInt(
        readArg(argv, '--default-timeout') ?? process.env.COWORKANY_AGENT_DEFAULT_TIMEOUT_SECONDS,
        300,
    );
    const requestBodyLimit = process.env.COWORKANY_AGENT_REQUEST_BODY_LIMIT?.trim() || '1mb';

    return {
        host,
        port,
        name,
        maxSteps: toBoundedInt(maxSteps, 1, 128),
        maxConcurrency: toBoundedInt(maxConcurrency, 1, 128),
        defaultTimeoutSeconds: toBoundedInt(defaultTimeoutSeconds, 5, 3600),
        requestBodyLimit,
    };
}

function assertTaskRequest(input: unknown): asserts input is ClawTaskRequest {
    if (!input || typeof input !== 'object') {
        throw new Error('invalid_request_body');
    }
}

function normalizeTaskRequest(
    body: ClawTaskRequest,
    config: ServerConfig,
): {
    taskId: string;
    instruction: string;
    workspacePath: string;
    timeoutSeconds: number;
} {
    const taskId = typeof body.task_id === 'string' ? body.task_id.trim() : '';
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    const workspaceRaw = typeof body.workspace === 'string' ? body.workspace.trim() : '';
    const timeoutCandidate = typeof body.timeout_seconds === 'number'
        ? body.timeout_seconds
        : config.defaultTimeoutSeconds;
    const timeoutSeconds = toBoundedInt(
        Number.isFinite(timeoutCandidate) ? timeoutCandidate : config.defaultTimeoutSeconds,
        5,
        3600,
    );

    if (!taskId) {
        throw new Error('invalid_task_id');
    }
    if (!instruction) {
        throw new Error('invalid_instruction');
    }
    if (!workspaceRaw) {
        throw new Error('invalid_workspace');
    }

    return {
        taskId,
        instruction,
        workspacePath: path.resolve(workspaceRaw),
        timeoutSeconds,
    };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeoutHandle = setTimeout(() => {
                    reject(new TaskTimeoutError(timeoutMs));
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }
}

function buildOutputText(input: {
    assistantOutput: string;
    status: ClawTaskResponse['status'];
    errorMessage: string | null;
}): string {
    const assistantOutput = input.assistantOutput.trim();
    if (assistantOutput.length > 0) {
        return assistantOutput;
    }
    if (input.status === 'completed') {
        return 'Task completed.';
    }
    if (input.status === 'timeout') {
        return `Task timed out. ${input.errorMessage ?? ''}`.trim();
    }
    return `Task failed. ${input.errorMessage ?? ''}`.trim();
}

async function main(): Promise<void> {
    const workspaceRoot = process.cwd();
    const config = parseConfig(process.argv.slice(2));
    const llmSeed = seedRuntimeLlmEnvFromConfig({
        cwd: workspaceRoot,
        env: process.env,
    });
    if (llmSeed.seededKeys.length > 0) {
        console.info('[claw-agent-server] seeded llm env from config', {
            path: llmSeed.loadedFromPath,
            provider: llmSeed.provider,
            modelId: llmSeed.modelId,
            seededKeys: llmSeed.seededKeys,
        });
    }

    const app = express();
    app.use(express.json({ limit: config.requestBodyLimit }));

    let activeRequests = 0;

    app.get('/v1/health', (_req, res) => {
        res.json({
            name: config.name,
            status: 'ready',
            model: process.env.COWORKANY_MODEL ?? null,
            capabilities: ['file-ops', 'code', 'web', 'task-route'],
            active_requests: activeRequests,
            max_concurrency: config.maxConcurrency,
        });
    });

    app.post('/v1/task', async (req, res) => {
        if (activeRequests >= config.maxConcurrency) {
            res.status(503).json({
                status: 'failed',
                output: 'Agent is busy. Retry later.',
            } satisfies ClawTaskResponse);
            return;
        }

        let requestPayload: ReturnType<typeof normalizeTaskRequest>;
        try {
            assertTaskRequest(req.body);
            requestPayload = normalizeTaskRequest(req.body, config);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.status(400).json({
                status: 'failed',
                output: `Invalid request: ${message}`,
            } satisfies ClawTaskResponse);
            return;
        }

        activeRequests += 1;
        const startedAt = Date.now();
        const timeoutMs = requestPayload.timeoutSeconds * 1000;
        const deadlineAtMs = Date.now() + Math.max(1_000, timeoutMs - 1_000);

        let assistantOutput = '';
        let tokensUsed = 0;
        let eventErrorMessage: string | null = null;

        const threadId = `claw-thread-${requestPayload.taskId}-${randomUUID()}`;
        const resourceId = `claw-resource-${requestPayload.taskId}-${randomUUID()}`;

        try {
            await withTimeout(
                handleUserMessage(
                    requestPayload.instruction,
                    threadId,
                    resourceId,
                    (event: DesktopEvent) => {
                        if (event.type === 'text_delta' && event.role === 'assistant' && typeof event.content === 'string') {
                            assistantOutput += event.content;
                            if (assistantOutput.length > 48_000) {
                                assistantOutput = assistantOutput.slice(-48_000);
                            }
                        }
                        if (event.type === 'token_usage') {
                            tokensUsed += typeof event.inputTokens === 'number' ? event.inputTokens : 0;
                            tokensUsed += typeof event.outputTokens === 'number' ? event.outputTokens : 0;
                        }
                        if (event.type === 'error' && typeof event.message === 'string' && event.message.trim().length > 0) {
                            eventErrorMessage = event.message.trim();
                        }
                    },
                    {
                        taskId: requestPayload.taskId,
                        workspacePath: requestPayload.workspacePath,
                        forcedRouteMode: 'task',
                        modelId: process.env.COWORKANY_MODEL,
                        requireToolApproval: false,
                        autoResumeSuspendedTools: true,
                        forcePostAssistantCompletion: true,
                        maxSteps: config.maxSteps,
                        chatStartupDeadlineAtMs: deadlineAtMs,
                        chatTurnDeadlineAtMs: deadlineAtMs,
                    },
                ),
                timeoutMs,
            );

            const status: ClawTaskResponse['status'] = eventErrorMessage ? 'failed' : 'completed';
            const response: ClawTaskResponse = {
                status,
                output: buildOutputText({
                    assistantOutput,
                    status,
                    errorMessage: eventErrorMessage,
                }),
                tokens_used: tokensUsed > 0 ? tokensUsed : undefined,
                duration_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
            };
            res.status(200).json(response);
        } catch (error) {
            const isTimeout = error instanceof TaskTimeoutError;
            const message = error instanceof Error ? error.message : String(error);
            const status: ClawTaskResponse['status'] = isTimeout ? 'timeout' : 'failed';
            const response: ClawTaskResponse = {
                status,
                output: buildOutputText({
                    assistantOutput,
                    status,
                    errorMessage: message,
                }),
                tokens_used: tokensUsed > 0 ? tokensUsed : undefined,
                duration_seconds: Number(((Date.now() - startedAt) / 1000).toFixed(3)),
            };
            res.status(200).json(response);
        } finally {
            activeRequests = Math.max(0, activeRequests - 1);
        }
    });

    app.listen(config.port, config.host, () => {
        console.info('[claw-agent-server] listening', {
            url: `http://${config.host}:${config.port}`,
            name: config.name,
            model: process.env.COWORKANY_MODEL ?? null,
            maxSteps: config.maxSteps,
            maxConcurrency: config.maxConcurrency,
            defaultTimeoutSeconds: config.defaultTimeoutSeconds,
        });
    });
}

main().catch((error) => {
    console.error('[claw-agent-server] fatal', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
