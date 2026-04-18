import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { handleUserMessage } from '../src/ipc/streaming';
import { supervisor } from '../src/mastra/agents/supervisor';
import { supervisorSolo } from '../src/mastra/agents/supervisorSolo';

const ORIGINAL_ENV = {
    COWORKANY_MODEL: process.env.COWORKANY_MODEL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    COWORKANY_MASTRA_TASK_PREFER_RESEARCHER: process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER,
    COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT: process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT,
    COWORKANY_MASTRA_REQUIRED_OUTPUT_RECOVERY_PASS_COUNT: process.env.COWORKANY_MASTRA_REQUIRED_OUTPUT_RECOVERY_PASS_COUNT,
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
        const originalSoloStream = supervisorSolo.stream.bind(supervisorSolo);
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
        (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = (async (_message, options) => {
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
            } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
        }) as typeof supervisorSolo.stream;

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
            (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = originalSoloStream as typeof supervisorSolo.stream;
        }
    });

    test('retries task turn when required output file is missing and succeeds after follow-up attempt', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalSoloStream = supervisorSolo.stream.bind(supervisorSolo);
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
        (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = (async (message) => {
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
            } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
        }) as typeof supervisorSolo.stream;

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
            expect(streamedMessages[1]).toContain('FILE: <exact path>');
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => event.type === 'error' && String(event.message).includes('missing_required_output_files'))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = originalSoloStream as typeof supervisorSolo.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });

    test('injects workspace input snapshot for task turns with referenced input files', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalSoloStream = supervisorSolo.stream.bind(supervisorSolo);
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-input-snapshot-'));
        const inputPath = path.join(workspacePath, 'raw_data.csv');
        const outputPath = path.join(workspacePath, 'report.md');
        await fs.writeFile(inputPath, 'id,value\n1,42\n2,88\n', 'utf8');
        let capturedMessage = '';
        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (message) => {
            capturedMessage = String(message);
            await fs.writeFile(
                outputPath,
                [
                    '# Report',
                    '',
                    'The data snapshot was read directly from workspace/raw_data.csv.',
                    'It contains two records and demonstrates that input inlining is available',
                    'for task-route artifact generation when tools are unavailable.',
                    'Values observed: 42 and 88.',
                ].join('\n'),
                'utf8',
            );
            return {
                runId: 'stream-input-snapshot',
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
        (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = (async (message) => {
            capturedMessage = String(message);
            await fs.writeFile(
                outputPath,
                [
                    '# Report',
                    '',
                    'The data snapshot was read directly from workspace/raw_data.csv.',
                    'It contains two records and demonstrates that input inlining is available',
                    'for task-route artifact generation when tools are unavailable.',
                    'Values observed: 42 and 88.',
                ].join('\n'),
                'utf8',
            );
            return {
                runId: 'stream-input-snapshot',
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
            } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
        }) as typeof supervisorSolo.stream;

        try {
            await handleUserMessage(
                'Read workspace/raw_data.csv and write to workspace/report.md.',
                'thread-input-snapshot',
                'resource-input-snapshot',
                () => undefined,
                {
                    forcedRouteMode: 'task',
                    forcePostAssistantCompletion: true,
                    workspacePath,
                },
            );

            expect(capturedMessage).toContain('[Workspace Input Snapshot]');
            expect(capturedMessage).toContain(`Path: ${inputPath}`);
            expect(capturedMessage).toContain('id,value');
            expect(capturedMessage).not.toContain(`Path: ${outputPath}`);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = originalSoloStream as typeof supervisorSolo.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });

    test('treats status-only required markdown outputs as unsatisfied and retries', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalSoloStream = supervisorSolo.stream.bind(supervisorSolo);
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
        process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT = '1';

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-markdown-quality-retry-'));
        const outputPath = path.join(workspacePath, 'analysis.md');
        let streamCallCount = 0;
        const substantiveMarkdown = [
            '# Analysis',
            '',
            'The implementation should proceed with a phased rollout, explicit observability,',
            'and rollback criteria that are validated in staging before production adoption.',
            'This approach balances delivery speed and operational safety while keeping risk bounded.',
        ].join('\n');
        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
            streamCallCount += 1;
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            if (streamCallCount === 1) {
                await fs.writeFile(outputPath, 'Implemented.\n', 'utf8');
            } else {
                await fs.writeFile(outputPath, `${substantiveMarkdown}\n`, 'utf8');
            }
            return {
                runId: `stream-markdown-quality-retry-${streamCallCount}`,
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
        (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = (async () => {
            streamCallCount += 1;
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            if (streamCallCount === 1) {
                await fs.writeFile(outputPath, 'Implemented.\n', 'utf8');
            } else {
                await fs.writeFile(outputPath, `${substantiveMarkdown}\n`, 'utf8');
            }
            return {
                runId: `stream-markdown-quality-retry-${streamCallCount}`,
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
            } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
        }) as typeof supervisorSolo.stream;

        try {
            const events: Array<Record<string, unknown>> = [];
            const result = await handleUserMessage(
                'Write final analysis to workspace/analysis.md.',
                'thread-markdown-quality-retry',
                'resource-markdown-quality-retry',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcedRouteMode: 'task',
                    forcePostAssistantCompletion: true,
                    workspacePath,
                },
            );

            expect(result.runId).toBe('stream-markdown-quality-retry-2');
            expect(streamCallCount).toBe(2);
            expect(events.some((event) => event.type === 'error' && String(event.message).includes('missing_required_output_files'))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = originalSoloStream as typeof supervisorSolo.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });

    test('treats syntactically broken required python outputs as unsatisfied and retries', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalSoloStream = supervisorSolo.stream.bind(supervisorSolo);
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
        process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT = '1';

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-python-quality-retry-'));
        const outputPath = path.join(workspacePath, 'main.py');
        let streamCallCount = 0;
        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
            streamCallCount += 1;
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            if (streamCallCount === 1) {
                await fs.writeFile(outputPath, [
                    'def main():',
                    "print('broken indent')",
                    '',
                    "if __name__ == '__main__':",
                    '    main()',
                ].join('\n'), 'utf8');
            } else {
                await fs.writeFile(outputPath, [
                    'def main():',
                    "    print('ok')",
                    '',
                    "if __name__ == '__main__':",
                    '    main()',
                ].join('\n'), 'utf8');
            }
            return {
                runId: `stream-python-quality-retry-${streamCallCount}`,
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
        (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = (async () => {
            streamCallCount += 1;
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            if (streamCallCount === 1) {
                await fs.writeFile(outputPath, [
                    'def main():',
                    "print('broken indent')",
                    '',
                    "if __name__ == '__main__':",
                    '    main()',
                ].join('\n'), 'utf8');
            } else {
                await fs.writeFile(outputPath, [
                    'def main():',
                    "    print('ok')",
                    '',
                    "if __name__ == '__main__':",
                    '    main()',
                ].join('\n'), 'utf8');
            }
            return {
                runId: `stream-python-quality-retry-${streamCallCount}`,
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
            } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
        }) as typeof supervisorSolo.stream;

        try {
            const result = await handleUserMessage(
                'Write runnable Python CLI to workspace/main.py.',
                'thread-python-quality-retry',
                'resource-python-quality-retry',
                () => undefined,
                {
                    forcedRouteMode: 'task',
                    forcePostAssistantCompletion: true,
                    workspacePath,
                },
            );
            expect(result.runId).toBe('stream-python-quality-retry-2');
            expect(streamCallCount).toBe(2);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = originalSoloStream as typeof supervisorSolo.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });

    test('retries missing required output before task final synthesis fallback', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalSoloStream = supervisorSolo.stream.bind(supervisorSolo);
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
        (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = (async () => {
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
                } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
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
            } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
        }) as typeof supervisorSolo.stream;

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
            (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = originalSoloStream as typeof supervisorSolo.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });

    test('runs forced required-output recovery pass before materialization fallback', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalSoloStream = supervisorSolo.stream.bind(supervisorSolo);
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_API_KEY = 'test-openai-key';
        process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
        process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
        process.env.COWORKANY_MASTRA_OUTPUT_PATH_RETRY_COUNT = '0';
        process.env.COWORKANY_MASTRA_REQUIRED_OUTPUT_RECOVERY_PASS_COUNT = '1';

        const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'coworkany-output-recovery-pass-'));
        const outputPath = path.join(workspacePath, 'result.json');
        const streamedMessages: string[] = [];
        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (message) => {
            streamedMessages.push(String(message));
            if (streamedMessages.length >= 2) {
                await fs.writeFile(outputPath, '{}', 'utf8');
            }
            return {
                runId: `stream-output-recovery-pass-${streamedMessages.length}`,
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
        }) as typeof supervisor.stream;
        (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = (async (message) => {
            streamedMessages.push(String(message));
            if (streamedMessages.length >= 2) {
                await fs.writeFile(outputPath, '{}', 'utf8');
            }
            return {
                runId: `stream-output-recovery-pass-${streamedMessages.length}`,
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
            } as Awaited<ReturnType<typeof supervisorSolo.stream>>;
        }) as typeof supervisorSolo.stream;

        try {
            const events: Array<Record<string, unknown>> = [];
            const result = await handleUserMessage(
                'Collect result and write to workspace/result.json.',
                'thread-output-recovery-pass',
                'resource-output-recovery-pass',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcedRouteMode: 'task',
                    forcePostAssistantCompletion: true,
                    workspacePath,
                },
            );

            expect(result.runId).toBe('stream-output-recovery-pass-2');
            expect(streamedMessages.length).toBe(2);
            expect(streamedMessages[1]).toContain('[Required Output Recovery Pass]');
            expect(streamedMessages[1]).toContain('FILE:<path>');
            expect(events.some((event) => event.type === 'error' && String(event.message).includes('missing_required_output_files'))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisorSolo as unknown as { stream: typeof supervisorSolo.stream }).stream = originalSoloStream as typeof supervisorSolo.stream;
            await fs.rm(workspacePath, { recursive: true, force: true });
        }
    });
});
