import { describe, expect, test } from 'bun:test';
import { Agent } from '@mastra/core/agent';
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { z } from 'zod';
import { coworker } from '../src/mastra/agents/coworker';
import { supervisor } from '../src/mastra/agents/supervisor';
import { getWorkspacePolicySnapshot } from '../src/mastra/workspace/runtime';
import { resolveTelemetryPolicy } from '../src/mastra/telemetry';
import {
    handleApprovalResponse,
    handleUserMessage,
    resolveMissingApiKeyForModel,
} from '../src/ipc/streaming';

const echoTool = createTool({
    id: 'echo',
    description: 'echo input',
    inputSchema: z.object({ message: z.string() }),
    outputSchema: z.object({ echoed: z.string() }),
    execute: async ({ message }) => ({ echoed: message }),
});

describe('Phase 3: Agent Loop', () => {
    test('can create a basic agent', () => {
        const agent = new Agent({
            id: 'phase3-agent',
            name: 'Phase3 Agent',
            instructions: 'Reply briefly.',
            model: 'anthropic/claude-sonnet-4-5',
            tools: {
                echo: echoTool,
            },
        });

        expect(agent).toBeDefined();
        expect(agent.id).toBe('phase3-agent');
    });

    test('coworker and supervisor agents are created', () => {
        expect(coworker).toBeDefined();
        expect(supervisor).toBeDefined();
        expect(coworker.id).toBe('coworker');
        expect(supervisor.id).toBe('supervisor');
    });

    test('supervisor has guardrail processors and task-complete scorers configured', async () => {
        const options = await supervisor.getDefaultOptions();
        expect(options).toBeDefined();
        expect(Array.isArray(options?.inputProcessors)).toBe(true);
        expect(Array.isArray(options?.outputProcessors)).toBe(true);
        expect(Array.isArray((options?.isTaskComplete as { scorers?: unknown[] })?.scorers)).toBe(true);
        expect(
            ((options?.isTaskComplete as { scorers?: unknown[] })?.scorers?.length ?? 0) >= 3,
        ).toBe(true);
        expect(typeof options?.scorers).toBe('object');
    });

    test('supervisor has own memory for propagation', () => {
        expect(supervisor.hasOwnMemory()).toBe(true);
    });

    test('workspace policy enables approval and read-before-write for mutating tools', () => {
        const snapshot = getWorkspacePolicySnapshot();
        expect(snapshot.enabled).toBe(true);
        expect(snapshot.tools[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]?.requireApproval).toBe(true);
        expect(snapshot.tools[WORKSPACE_TOOLS.FILESYSTEM.WRITE_FILE]?.requireReadBeforeWrite).toBe(true);
        expect(snapshot.tools[WORKSPACE_TOOLS.FILESYSTEM.EDIT_FILE]?.requireReadBeforeWrite).toBe(true);
        expect(snapshot.tools[WORKSPACE_TOOLS.FILESYSTEM.DELETE]?.requireApproval).toBe(true);
        expect(snapshot.tools[WORKSPACE_TOOLS.SANDBOX.EXECUTE_COMMAND]?.requireApproval).toBe(true);
    });

    test('telemetry policy defaults to always_on outside production and ratio in production', () => {
        const devPolicy = resolveTelemetryPolicy({ NODE_ENV: 'development' });
        expect(devPolicy.mode).toBe('always_on');
        expect(devPolicy.ratio).toBe(1);

        const prodPolicy = resolveTelemetryPolicy({ NODE_ENV: 'production' });
        expect(prodPolicy.mode).toBe('ratio');
        expect(prodPolicy.ratio).toBe(0.15);
    });

    test('IPC bridge functions exist', () => {
        expect(typeof handleUserMessage).toBe('function');
        expect(typeof handleApprovalResponse).toBe('function');
    });

    test('model api key precheck resolves missing key by provider', () => {
        expect(
            resolveMissingApiKeyForModel('anthropic/claude-sonnet-4-5', {}),
        ).toBe('ANTHROPIC_API_KEY');
        expect(
            resolveMissingApiKeyForModel('openai/gpt-4.1', {}),
        ).toBe('OPENAI_API_KEY');
        expect(
            resolveMissingApiKeyForModel('aiberm/gpt-5.3-codex', {}),
        ).toBe('OPENAI_API_KEY');
        expect(
            resolveMissingApiKeyForModel('anthropic/claude-sonnet-4-5', {
                ANTHROPIC_API_KEY: 'x',
            }),
        ).toBeNull();
        expect(
            resolveMissingApiKeyForModel('aiberm/gpt-5.3-codex', {
                OPENAI_API_KEY: 'x',
            }),
        ).toBeNull();
    });

    test('missing api key preflight emits error without synthetic completion', async () => {
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        delete process.env.ANTHROPIC_API_KEY;

        const events: Array<{ type?: string; message?: string; finishReason?: string }> = [];
        try {
            await handleUserMessage(
                'hello',
                `phase3-preflight-${Date.now()}`,
                'employee-test',
                (event) => events.push(event as { type?: string; message?: string; finishReason?: string }),
            );
        } finally {
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousAnthropic === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropic;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
        }

        expect(events.some((event) => event.type === 'error' && event.message?.includes('missing_api_key:ANTHROPIC_API_KEY'))).toBe(true);
        expect(events.some((event) => event.type === 'complete' && event.finishReason === 'error')).toBe(false);
    });

    test.skip('integration: stream emits text deltas', async () => {
        const events: unknown[] = [];
        await handleUserMessage(
            'Say hello',
            `phase3-${Date.now()}`,
            'employee-test',
            (event) => events.push(event),
        );
        expect(events.length).toBeGreaterThan(0);
    });

    test('handleUserMessage forwards requestContext reserved keys and execution options', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        let capturedOptions: Record<string, unknown> | undefined;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (
                _message: string,
                options?: Record<string, unknown>,
            ) => {
                capturedOptions = options;
                return {
                    runId: 'run-phase3-context',
                    fullStream: (async function* () {
                        // no-op
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'context test',
                'thread-phase3',
                'employee-phase3',
                () => undefined,
                {
                    taskId: 'task-phase3',
                    workspacePath: '/tmp/phase3',
                    requireToolApproval: false,
                    autoResumeSuspendedTools: false,
                    toolCallConcurrency: 2,
                    maxSteps: 9,
                },
            );

            expect(result.runId).toBe('run-phase3-context');
            expect(capturedOptions).toBeDefined();
            expect(capturedOptions?.requireToolApproval).toBe(false);
            expect(capturedOptions?.autoResumeSuspendedTools).toBe(false);
            expect(capturedOptions?.toolCallConcurrency).toBe(2);
            expect(capturedOptions?.maxSteps).toBe(9);

            const requestContext = capturedOptions?.requestContext as {
                get: (key: string) => unknown;
            };
            expect(requestContext.get(MASTRA_RESOURCE_ID_KEY)).toBe('employee-phase3');
            expect(requestContext.get(MASTRA_THREAD_ID_KEY)).toBe('thread-phase3');
            expect(requestContext.get('taskId')).toBe('task-phase3');
            expect(requestContext.get('workspacePath')).toBe('/tmp/phase3');
            const tracingOptions = capturedOptions?.tracingOptions as {
                traceId?: string;
                tags?: string[];
            };
            expect(typeof tracingOptions?.traceId).toBe('string');
            expect(Array.isArray(tracingOptions?.tags)).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousAnthropic === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropic;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
        }
    });

    test('handleUserMessage sets openai providerOptions.store=true by default', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousOpenAiKey = process.env.OPENAI_API_KEY;
        const previousStore = process.env.COWORKANY_OPENAI_RESPONSES_STORE;
        let capturedOptions: Record<string, unknown> | undefined;

        try {
            process.env.COWORKANY_MODEL = 'openai/gpt-5.3-codex';
            process.env.OPENAI_API_KEY = 'test-key';
            delete process.env.COWORKANY_OPENAI_RESPONSES_STORE;
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (
                _message: string,
                options?: Record<string, unknown>,
            ) => {
                capturedOptions = options;
                return {
                    runId: 'run-phase3-openai-provider-options',
                    fullStream: (async function* () {
                        // no-op
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            await handleUserMessage(
                'openai provider options',
                'thread-openai-provider-options',
                'employee-openai-provider-options',
                () => undefined,
                {
                    forcePostAssistantCompletion: true,
                },
            );

            const providerOptions = (capturedOptions?.providerOptions ?? {}) as {
                openai?: {
                    store?: boolean;
                };
            };
            expect(providerOptions.openai?.store).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousOpenAiKey === 'string') {
                process.env.OPENAI_API_KEY = previousOpenAiKey;
            } else {
                delete process.env.OPENAI_API_KEY;
            }
            if (typeof previousStore === 'string') {
                process.env.COWORKANY_OPENAI_RESPONSES_STORE = previousStore;
            } else {
                delete process.env.COWORKANY_OPENAI_RESPONSES_STORE;
            }
        }
    });

    test('chat-mode turn timeout budget stops long startup retries and emits terminal error', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousChatStartRetry = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT;
        const previousChatStartTimeout = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS;
        const previousChatStartRetryDelay = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS;
        const previousChatTurnBudget = process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT = '2';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS = '4000';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS = '2000';
            process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS = '1500';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                await new Promise(() => undefined);
                throw new Error('unreachable');
            }) as typeof supervisor.stream;

            const startedAt = Date.now();
            const result = await handleUserMessage(
                'budget timeout test',
                'thread-timeout-budget',
                'employee-timeout-budget',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );
            const elapsedMs = Date.now() - startedAt;

            expect(result.runId.startsWith('start-failed-')).toBe(true);
            expect(elapsedMs).toBeLessThan(5_000);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('chat_turn_timeout_budget_exhausted')
            ))).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousAnthropic === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropic;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
            if (typeof previousFallback === 'string') {
                process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = previousFallback;
            } else {
                delete process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
            }
            if (typeof previousChatStartRetry === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT = previousChatStartRetry;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT;
            }
            if (typeof previousChatStartTimeout === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS = previousChatStartTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS;
            }
            if (typeof previousChatStartRetryDelay === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS = previousChatStartRetryDelay;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS;
            }
            if (typeof previousChatTurnBudget === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS = previousChatTurnBudget;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS;
            }
        }
    });

    test('handleUserMessage retries transient stream-start failures before succeeding', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousRetryCount = process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT;
        let attempts = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT = '1';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                attempts += 1;
                if (attempts === 1) {
                    throw new Error('network timeout while connecting');
                }
                return {
                    runId: 'run-phase3-retry',
                    fullStream: (async function* () {
                        // no-op
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'retry test',
                'thread-retry',
                'employee-retry',
                () => undefined,
            );

            expect(result.runId).toBe('run-phase3-retry');
            expect(attempts).toBe(2);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousAnthropic === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropic;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
            if (typeof previousRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT = previousRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT;
            }
        }
    });

    test('chat-mode startup timeout emits staged rate-limit telemetry before failing', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousChatStartRetry = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT;
        const previousChatStartTimeout = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT = '1';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS = '1000';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                throw new Error('stream_start_timeout:1000');
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'timeout stage test',
                'thread-timeout-stage',
                'employee-timeout-stage',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId.startsWith('start-failed-')).toBe(true);
            const rateLimitedEvents = events.filter((event) => event.type === 'rate_limited');
            expect(rateLimitedEvents.length).toBeGreaterThan(0);
            const finalRateLimited = rateLimitedEvents.at(-1) as Record<string, unknown>;
            expect(finalRateLimited.stage).toBe('ttfb');
            const timings = finalRateLimited.timings as Record<string, unknown>;
            expect(typeof timings.elapsedMs).toBe('number');
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousAnthropic === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropic;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
            if (typeof previousFallback === 'string') {
                process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = previousFallback;
            } else {
                delete process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
            }
            if (typeof previousChatStartRetry === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT = previousChatStartRetry;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT;
            }
            if (typeof previousChatStartTimeout === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS = previousChatStartTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS;
            }
        }
    });

    test('chat-mode tail stream interruption emits last-token retry telemetry and completes', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousTailRetryCount = process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_COUNT;
        const previousTailRetryDelay = process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_DELAY_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_COUNT = '1';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_DELAY_MS = '1';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* interruptedStream() {
                    yield {
                        type: 'text-delta',
                        payload: { text: 'hello' },
                    };
                    throw new Error('socket hang up');
                }
                return {
                    runId: 'run-phase3-tail-retry',
                    fullStream: interruptedStream(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'tail retry',
                'thread-tail-retry',
                'employee-tail-retry',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-tail-retry');
            expect(events.some((event) => event.type === 'text_delta')).toBe(true);
            const retryEvent = events.find((event) => event.type === 'rate_limited') as Record<string, unknown> | undefined;
            expect(retryEvent?.stage).toBe('last_token');
            const completed = events.find((event) => event.type === 'complete') as Record<string, unknown> | undefined;
            expect(
                completed?.finishReason === 'assistant_text_stream_interrupted'
                || completed?.finishReason === 'stream_exhausted',
            ).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousAnthropic === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropic;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
            if (typeof previousTailRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_COUNT = previousTailRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_COUNT;
            }
            if (typeof previousTailRetryDelay === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_DELAY_MS = previousTailRetryDelay;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_TAIL_RETRY_DELAY_MS;
            }
        }
    });

    test('handleApprovalResponse resumes with requestContext and memory from cached run context', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalApprove = supervisor.approveToolCall.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;

        let capturedApproveOptions: Record<string, unknown> | undefined;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                return {
                    runId: 'run-phase3-approval',
                    fullStream: (async function* () {
                        // no-op
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            (supervisor as unknown as { approveToolCall: typeof supervisor.approveToolCall }).approveToolCall = (async (
                options: Record<string, unknown>,
            ) => {
                capturedApproveOptions = options;
                return {
                    runId: 'run-phase3-approval',
                    fullStream: (async function* () {
                        // no-op
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.approveToolCall>>;
            }) as typeof supervisor.approveToolCall;

            await handleUserMessage(
                'approval test',
                'thread-approval',
                'employee-approval',
                () => undefined,
                {
                    taskId: 'task-approval',
                    workspacePath: '/tmp/approval',
                },
            );

            await handleApprovalResponse(
                'run-phase3-approval',
                'tool-call-1',
                true,
                () => undefined,
            );

            expect(capturedApproveOptions).toBeDefined();
            expect(
                (capturedApproveOptions?.memory as { thread: string }).thread,
            ).toBe('thread-approval');
            expect(
                (capturedApproveOptions?.memory as { resource: string }).resource,
            ).toBe('employee-approval');

            const requestContext = capturedApproveOptions?.requestContext as {
                get: (key: string) => unknown;
            };
            expect(requestContext.get(MASTRA_RESOURCE_ID_KEY)).toBe('employee-approval');
            expect(requestContext.get(MASTRA_THREAD_ID_KEY)).toBe('thread-approval');
            expect(requestContext.get('taskId')).toBe('task-approval');
            expect(requestContext.get('workspacePath')).toBe('/tmp/approval');
            expect(
                typeof (capturedApproveOptions?.tracingOptions as { traceId?: string })?.traceId,
            ).toBe('string');
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { approveToolCall: typeof supervisor.approveToolCall }).approveToolCall = originalApprove as typeof supervisor.approveToolCall;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousAnthropic === 'string') {
                process.env.ANTHROPIC_API_KEY = previousAnthropic;
            } else {
                delete process.env.ANTHROPIC_API_KEY;
            }
        }
    });
});
