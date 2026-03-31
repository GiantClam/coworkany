import { describe, expect, test } from 'bun:test';
import { Agent } from '@mastra/core/agent';
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { coworker } from '../src/mastra/agents/coworker';
import { supervisor } from '../src/mastra/agents/supervisor';
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

    test('supervisor has own memory for propagation', () => {
        expect(supervisor.hasOwnMemory()).toBe(true);
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
