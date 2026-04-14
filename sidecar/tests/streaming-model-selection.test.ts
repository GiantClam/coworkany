import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleUserMessage } from '../src/ipc/streaming';
import { supervisor } from '../src/mastra/agents/supervisor';

const ORIGINAL_ENV = {
    COWORKANY_MODEL: process.env.COWORKANY_MODEL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    COWORKANY_MASTRA_TASK_PREFER_RESEARCHER: process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER,
    COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT: process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT,
};

afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
        if (typeof value === 'string') {
            process.env[key] = value;
        } else {
            delete process.env[key];
        }
    }
});

describe('streaming model selection', () => {
    test('uses per-turn modelId override for preflight API-key validation', async () => {
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;

        const events: Array<Record<string, unknown>> = [];
        const result = await handleUserMessage(
            'hello',
            'thread-model-override',
            'resource-model-override',
            (event) => events.push(event as Record<string, unknown>),
            {
                modelId: 'openai/gpt-4o-mini',
                forcedRouteMode: 'task',
            },
        );

        expect(result.runId.startsWith('preflight-')).toBe(true);
        expect(events.some((event) => (
            event.type === 'error'
            && event.message === 'missing_api_key:OPENAI_API_KEY'
        ))).toBe(true);
        expect(events.some((event) => (
            event.type === 'error'
            && event.message === 'missing_api_key:ANTHROPIC_API_KEY'
        ))).toBe(false);
    });

    test('passes per-turn model override into stream execution options', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';

        let capturedModelId: string | null = null;
        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (_message, options) => {
            const model = (options as { model?: unknown })?.model;
            capturedModelId = typeof model === 'string'
                ? model
                : (
                    model && typeof model === 'object' && typeof (model as { id?: unknown }).id === 'string'
                        ? (model as { id: string }).id
                        : null
                );
            return {
                runId: 'stream-model-override',
                fullStream: (async function* done() {
                    yield {
                        type: 'text-delta',
                        payload: {
                            text: 'ok',
                        },
                    };
                    yield {
                        type: 'complete',
                        payload: {
                            finishReason: 'stop',
                        },
                    };
                })(),
            } as Awaited<ReturnType<typeof supervisor.stream>>;
        }) as typeof supervisor.stream;

        try {
            const events: Array<Record<string, unknown>> = [];
            const result = await handleUserMessage(
                'hello',
                'thread-stream-model-override',
                'resource-stream-model-override',
                (event) => events.push(event as Record<string, unknown>),
                {
                    modelId: 'openai/gpt-4o-mini',
                    forcedRouteMode: 'task',
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('stream-model-override');
            expect(capturedModelId).toBe('openai/gpt-4o-mini');
            expect(events.some((event) => event.type === 'complete')).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
        }
    });

    test('retries task turn when required output file is missing and succeeds after follow-up attempt', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
        process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT = '1';

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-output-retry-'));
        const outputPath = path.join(workspacePath, 'form_fields.json');
        const streamedMessages: string[] = [];
        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (message) => {
            streamedMessages.push(String(message));
            if (streamedMessages.length >= 2) {
                await fs.writeFile(outputPath, '[]', 'utf8');
            }
            return {
                runId: `stream-output-retry-${streamedMessages.length}`,
                fullStream: (async function* done() {
                    yield {
                        type: 'text-delta',
                        payload: {
                            text: 'ok',
                        },
                    };
                    yield {
                        type: 'complete',
                        payload: {
                            finishReason: 'stop',
                        },
                    };
                })(),
            } as Awaited<ReturnType<typeof supervisor.stream>>;
        }) as typeof supervisor.stream;

        try {
            const events: Array<Record<string, unknown>> = [];
            const result = await handleUserMessage(
                'Read workspace/form.html and write to workspace/form_fields.json.',
                'thread-output-retry',
                'resource-output-retry',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcedRouteMode: 'task',
                    forcePostAssistantCompletion: true,
                    workspacePath,
                },
            );

            expect(result.runId).toBe('stream-output-retry-2');
            expect(streamedMessages.length).toBe(2);
            expect(streamedMessages[1]).toContain('[Required Output Missing]');
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => event.type === 'error' && String(event.message).includes('missing_required_output_files'))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });

    test('retries missing required output before task final synthesis fallback', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
        process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT = '1';

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-output-priority-'));
        const outputPath = path.join(workspacePath, 'result.json');
        let streamCallCount = 0;
        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
            streamCallCount += 1;
            if (streamCallCount === 2) {
                await fs.writeFile(outputPath, '{}', 'utf8');
                return {
                    runId: 'stream-output-priority-2',
                    fullStream: (async function* done() {
                        yield {
                            type: 'text-delta',
                            payload: {
                                text: 'done',
                            },
                        };
                        yield {
                            type: 'complete',
                            payload: {
                                finishReason: 'stop',
                            },
                        };
                    })(),
                } as Awaited<ReturnType<typeof supervisor.stream>>;
            }
            return {
                runId: 'stream-output-priority-1',
                fullStream: (async function* done() {
                    yield {
                        type: 'tool-call',
                        payload: {
                            toolName: 'dummy_tool',
                            args: { action: 'collect' },
                        },
                    };
                    yield {
                        type: 'tool-result',
                        payload: {
                            toolCallId: 'dummy_tool',
                            toolName: 'dummy_tool',
                            result: 'ok',
                            isError: false,
                        },
                    };
                    yield {
                        type: 'complete',
                        payload: {
                            finishReason: 'tool-calls',
                        },
                    };
                })(),
            } as Awaited<ReturnType<typeof supervisor.stream>>;
        }) as typeof supervisor.stream;

        try {
            const events: Array<Record<string, unknown>> = [];
            const result = await handleUserMessage(
                'Collect data and write to workspace/result.json.',
                'thread-output-priority',
                'resource-output-priority',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcedRouteMode: 'task',
                    forcePostAssistantCompletion: true,
                    workspacePath,
                },
            );

            expect(result.runId).toBe('stream-output-priority-2');
            expect(streamCallCount).toBe(2);
            expect(events.some((event) => event.type === 'tool_result' && event.toolName === 'final_synthesis')).toBe(false);
            expect(events.some((event) => event.type === 'error' && String(event.message).includes('missing_required_output_files'))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });
});
