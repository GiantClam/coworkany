import { afterEach, describe, expect, test } from 'bun:test';
import { handleUserMessage } from '../src/ipc/streaming';
import { supervisor } from '../src/mastra/agents/supervisor';
import { supervisorSolo } from '../src/mastra/agents/supervisorSolo';
import { MULTI_AGENT_EXECUTION_CONTRACT_MARKER } from '../src/mastra/multiAgentExecution';
import { DELEGATION_PLAN_CONTRACT_MARKER } from '../src/mastra/delegationPlanner';
import { DELEGATION_SYNTHESIS_CONTRACT_MARKER } from '../src/mastra/delegationSynthesizer';

const ORIGINAL_NETWORK_ENV = process.env.COWORKANY_MASTRA_ENABLE_AGENT_NETWORK;
const ORIGINAL_TASK_NETWORK_ENV = process.env.COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK;
const ORIGINAL_PREFER_NETWORK_ENV = process.env.COWORKANY_MASTRA_PREFER_AGENT_NETWORK;
const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

(
    supervisorSolo as unknown as {
        stream: (...args: unknown[]) => unknown;
    }
).stream = ((...args: unknown[]) => (
    supervisor.stream as unknown as (...streamArgs: unknown[]) => unknown
)(...args));

afterEach(() => {
    if (ORIGINAL_NETWORK_ENV === undefined) {
        delete process.env.COWORKANY_MASTRA_ENABLE_AGENT_NETWORK;
    } else {
        process.env.COWORKANY_MASTRA_ENABLE_AGENT_NETWORK = ORIGINAL_NETWORK_ENV;
    }
    if (ORIGINAL_TASK_NETWORK_ENV === undefined) {
        delete process.env.COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK;
    } else {
        process.env.COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK = ORIGINAL_TASK_NETWORK_ENV;
    }
    if (ORIGINAL_PREFER_NETWORK_ENV === undefined) {
        delete process.env.COWORKANY_MASTRA_PREFER_AGENT_NETWORK;
    } else {
        process.env.COWORKANY_MASTRA_PREFER_AGENT_NETWORK = ORIGINAL_PREFER_NETWORK_ENV;
    }
    if (ORIGINAL_ANTHROPIC_API_KEY === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
    } else {
        process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
    }
});

describe('streaming multi-agent network route', () => {
    test('task route with explicit multi-agent signal uses supervisor.network', async () => {
        process.env.COWORKANY_MASTRA_ENABLE_AGENT_NETWORK = '1';
        process.env.COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK = '1';
        process.env.COWORKANY_MASTRA_PREFER_AGENT_NETWORK = '1';
        process.env.ANTHROPIC_API_KEY = 'test-key';

        const originalNetwork = supervisor.network.bind(supervisor);
        const originalStream = supervisor.stream.bind(supervisor);
        let networkCalled = 0;
        let streamCalled = 0;
        const collectedText: string[] = [];

        (supervisor as unknown as { network: typeof supervisor.network }).network = (async () => {
            networkCalled += 1;
            return {
                runId: 'network-run-test',
                async *[Symbol.asyncIterator]() {
                    yield { type: 'text-delta', payload: { text: 'network-path-ok' } };
                    yield { type: 'finish', payload: { finishReason: 'stop' } };
                },
            } as Awaited<ReturnType<typeof supervisor.network>>;
        }) as typeof supervisor.network;

        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
            streamCalled += 1;
            return {
                runId: 'stream-run-test',
                fullStream: (async function* () {
                    yield { type: 'text-delta', payload: { text: 'stream-path' } };
                    yield { type: 'finish', payload: { finishReason: 'stop' } };
                })(),
            } as Awaited<ReturnType<typeof supervisor.stream>>;
        }) as typeof supervisor.stream;

        try {
            const result = await handleUserMessage(
                'Please orchestrate a multi-agent role-based pipeline: developer + reviewer + synthesizer.',
                'thread-network-route',
                'resource-network-route',
                (event) => {
                    if (event.type === 'text_delta') {
                        collectedText.push(event.content);
                    }
                },
                {
                    forcedRouteMode: 'task',
                    taskId: 'task-network-route',
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('network-run-test');
            expect(networkCalled).toBe(1);
            expect(streamCalled).toBe(0);
            expect(collectedText.join('\n')).toContain('network-path-ok');
        } finally {
            (supervisor as unknown as { network: typeof supervisor.network }).network = originalNetwork as typeof supervisor.network;
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
        }
    });

    test('uses supervisor.stream by default and still injects multi-agent contract', async () => {
        process.env.COWORKANY_MASTRA_ENABLE_AGENT_NETWORK = '1';
        process.env.COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK = '1';
        delete process.env.COWORKANY_MASTRA_PREFER_AGENT_NETWORK;
        process.env.ANTHROPIC_API_KEY = 'test-key';

        const originalNetwork = supervisor.network.bind(supervisor);
        const originalStream = supervisor.stream.bind(supervisor);
        let networkCalled = 0;
        let streamCalled = 0;
        let lastStreamPrompt = '';
        let lastToolCallConcurrency: number | null = null;

        (supervisor as unknown as { network: typeof supervisor.network }).network = (async () => {
            networkCalled += 1;
            return {
                runId: 'network-run-test-default-off',
                async *[Symbol.asyncIterator]() {
                    yield { type: 'text-delta', payload: { text: 'network-should-not-run' } };
                    yield { type: 'finish', payload: { finishReason: 'stop' } };
                },
            } as Awaited<ReturnType<typeof supervisor.network>>;
        }) as typeof supervisor.network;

        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (
            prompt: string,
            options?: Record<string, unknown>,
        ) => {
            streamCalled += 1;
            lastStreamPrompt = prompt;
            const concurrencyValue = options?.toolCallConcurrency;
            lastToolCallConcurrency = typeof concurrencyValue === 'number' ? concurrencyValue : null;
            return {
                runId: 'stream-run-default',
                fullStream: (async function* () {
                    yield { type: 'text-delta', payload: { text: 'stream-default-ok' } };
                    yield { type: 'finish', payload: { finishReason: 'stop' } };
                })(),
            } as Awaited<ReturnType<typeof supervisor.stream>>;
        }) as typeof supervisor.stream;

        try {
            const result = await handleUserMessage(
                'Please orchestrate a multi-agent role-based pipeline: developer + reviewer + synthesizer.',
                'thread-stream-default',
                'resource-stream-default',
                () => {},
                {
                    forcedRouteMode: 'task',
                    taskId: 'task-stream-default',
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('stream-run-default');
            expect(streamCalled).toBe(1);
            expect(networkCalled).toBe(0);
            expect(lastStreamPrompt.includes(MULTI_AGENT_EXECUTION_CONTRACT_MARKER)).toBe(true);
            expect(lastStreamPrompt.includes(DELEGATION_PLAN_CONTRACT_MARKER)).toBe(true);
            expect(lastStreamPrompt.includes(DELEGATION_SYNTHESIS_CONTRACT_MARKER)).toBe(true);
            expect(lastToolCallConcurrency).toBe(3);
        } finally {
            (supervisor as unknown as { network: typeof supervisor.network }).network = originalNetwork as typeof supervisor.network;
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
        }
    });

    test('does not inject multi-agent contract for role-hint-only single-agent execution prompts', async () => {
        process.env.COWORKANY_MASTRA_ENABLE_AGENT_NETWORK = '1';
        process.env.COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK = '1';
        delete process.env.COWORKANY_MASTRA_PREFER_AGENT_NETWORK;
        process.env.ANTHROPIC_API_KEY = 'test-key';

        const originalNetwork = supervisor.network.bind(supervisor);
        const originalStream = supervisor.stream.bind(supervisor);
        let networkCalled = 0;
        let streamCalled = 0;
        let lastStreamPrompt = '';
        let lastToolCallConcurrency: number | null = null;

        (supervisor as unknown as { network: typeof supervisor.network }).network = (async () => {
            networkCalled += 1;
            return {
                runId: 'network-run-role-hint-only',
                async *[Symbol.asyncIterator]() {
                    yield { type: 'text-delta', payload: { text: 'network-should-not-run' } };
                    yield { type: 'finish', payload: { finishReason: 'stop' } };
                },
            } as Awaited<ReturnType<typeof supervisor.network>>;
        }) as typeof supervisor.network;

        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (
            prompt: string,
            options?: Record<string, unknown>,
        ) => {
            streamCalled += 1;
            lastStreamPrompt = prompt;
            const concurrencyValue = options?.toolCallConcurrency;
            lastToolCallConcurrency = typeof concurrencyValue === 'number' ? concurrencyValue : null;
            return {
                runId: 'stream-run-role-hint-only',
                fullStream: (async function* () {
                    yield { type: 'text-delta', payload: { text: 'stream-role-hint-ok' } };
                    yield { type: 'finish', payload: { finishReason: 'stop' } };
                })(),
            } as Awaited<ReturnType<typeof supervisor.stream>>;
        }) as typeof supervisor.stream;

        try {
            const result = await handleUserMessage(
                'Please let developer reviewer tester collaborate on a calculator function implementation.',
                'thread-role-hint-only',
                'resource-role-hint-only',
                () => {},
                {
                    forcedRouteMode: 'task',
                    taskId: 'task-role-hint-only',
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('stream-run-role-hint-only');
            expect(streamCalled).toBe(1);
            expect(networkCalled).toBe(0);
            expect(lastStreamPrompt.includes(MULTI_AGENT_EXECUTION_CONTRACT_MARKER)).toBe(false);
            expect(lastStreamPrompt.includes(DELEGATION_PLAN_CONTRACT_MARKER)).toBe(false);
            expect(lastStreamPrompt.includes(DELEGATION_SYNTHESIS_CONTRACT_MARKER)).toBe(false);
            expect(lastToolCallConcurrency).not.toBe(3);
        } finally {
            (supervisor as unknown as { network: typeof supervisor.network }).network = originalNetwork as typeof supervisor.network;
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
        }
    });

    test('mirrors final_synthesis tool result as assistant text output', async () => {
        process.env.COWORKANY_MASTRA_ENABLE_AGENT_NETWORK = '1';
        process.env.COWORKANY_MASTRA_TASK_ENABLE_MULTI_AGENT_NETWORK = '1';
        delete process.env.COWORKANY_MASTRA_PREFER_AGENT_NETWORK;
        process.env.ANTHROPIC_API_KEY = 'test-key';

        const originalStream = supervisor.stream.bind(supervisor);
        const collectedText: string[] = [];

        (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
            return {
                runId: 'stream-run-final-synthesis-mirror',
                fullStream: (async function* () {
                    yield { type: 'text-delta', payload: { text: '已完成检索，正在整理。' } };
                    yield {
                        type: 'tool-result',
                        payload: {
                            toolName: 'final_synthesis',
                            toolCallId: 'final_synthesis:test',
                            result: '这是最终综合报告，包含关键结论与可执行建议。',
                            isError: false,
                        },
                    };
                    yield { type: 'finish', payload: { finishReason: 'stop' } };
                })(),
            } as Awaited<ReturnType<typeof supervisor.stream>>;
        }) as typeof supervisor.stream;

        try {
            const result = await handleUserMessage(
                '请整理现有信息并给出最终综合报告。',
                'thread-final-synthesis-mirror',
                'resource-final-synthesis-mirror',
                (event) => {
                    if (event.type === 'text_delta' && event.role === 'assistant') {
                        collectedText.push(event.content);
                    }
                },
                {
                    forcedRouteMode: 'task',
                    taskId: 'task-final-synthesis-mirror',
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('stream-run-final-synthesis-mirror');
            const merged = collectedText.join('\n');
            expect(merged).toContain('已完成检索');
            expect(merged).toContain('最终综合报告');
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
        }
    });
});
