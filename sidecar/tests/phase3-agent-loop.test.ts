import { describe, expect, test } from 'bun:test';
import { Agent } from '@mastra/core/agent';
import { MASTRA_RESOURCE_ID_KEY, MASTRA_THREAD_ID_KEY } from '@mastra/core/request-context';
import { createTool } from '@mastra/core/tools';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { z } from 'zod';
import { coworker } from '../src/mastra/agents/coworker';
import { coder } from '../src/mastra/agents/coder';
import { researcher } from '../src/mastra/agents/researcher';
import { supervisor } from '../src/mastra/agents/supervisor';
import { chatResponder } from '../src/mastra/agents/chatResponder';
import { getWorkspacePolicySnapshot } from '../src/mastra/workspace/runtime';
import { resolveTelemetryPolicy } from '../src/mastra/telemetry';
import {
    buildToolsetsForMessageAttempt,
    handleApprovalResponse,
    handleUserMessage,
    isMarketDataResearchQuery,
    isWeatherInformationQuery,
    hasWeatherInformationTool,
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
        const outputGuardrailsEnabled = process.env.COWORKANY_ENABLE_OUTPUT_GUARDRAILS === '1'
            && process.env.COWORKANY_ENABLE_GUARDRAILS !== '0';
        expect(options).toBeDefined();
        expect(Array.isArray(options?.inputProcessors)).toBe(true);
        expect(Array.isArray(options?.outputProcessors)).toBe(true);
        expect(((options?.outputProcessors?.length ?? 0) > 0)).toBe(outputGuardrailsEnabled);
        expect(Array.isArray((options?.isTaskComplete as { scorers?: unknown[] })?.scorers)).toBe(true);
        expect(
            ((options?.isTaskComplete as { scorers?: unknown[] })?.scorers?.length ?? 0) >= 3,
        ).toBe(true);
        expect(typeof options?.scorers).toBe('object');
        expect(options?.requireToolApproval).toBe(false);
        expect(options?.autoResumeSuspendedTools).toBe(false);
    });

    test('supervisor iteration policy stops when answer exists and no tool calls remain', async () => {
        const options = await supervisor.getDefaultOptions();
        const onIterationComplete = options?.onIterationComplete;
        expect(typeof onIterationComplete).toBe('function');
        const decision = onIterationComplete
            ? onIterationComplete({
                iteration: 1,
                toolCalls: [],
                text: '这是一个已经完整的回答，不需要继续迭代。',
                isFinal: false,
            })
            : undefined;
        expect(decision?.continue).toBe(false);
    });

    test('all core agents disable internal auto-resume for tool approvals', async () => {
        const coworkerOptions = await coworker.getDefaultOptions();
        const researcherOptions = await researcher.getDefaultOptions();
        const coderOptions = await coder.getDefaultOptions();
        expect(coworkerOptions?.requireToolApproval).toBe(false);
        expect(coworkerOptions?.autoResumeSuspendedTools).toBe(false);
        expect(researcherOptions?.requireToolApproval).toBe(false);
        expect(researcherOptions?.autoResumeSuspendedTools).toBe(false);
        expect(coderOptions?.requireToolApproval).toBe(false);
        expect(coderOptions?.autoResumeSuspendedTools).toBe(false);
    });

    test('supervisor has own memory for propagation', () => {
        expect(supervisor.hasOwnMemory()).toBe(true);
    });

    test('direct execution agents keep memory enabled for multi-step tool flows', () => {
        expect(researcher.hasOwnMemory()).toBe(true);
        expect(coder.hasOwnMemory()).toBe(true);
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

    test('handleUserMessage routes chat mode to chatResponder and task mode to supervisor', async () => {
        const originalSupervisorStream = supervisor.stream.bind(supervisor);
        const originalChatResponderStream = chatResponder.stream.bind(chatResponder);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        let supervisorCalls = 0;
        let chatResponderCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';

            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                supervisorCalls += 1;
                return {
                    runId: 'run-phase3-route-supervisor',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'task mode response' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = (async () => {
                chatResponderCalls += 1;
                return {
                    runId: 'run-phase3-route-chat',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'chat mode response' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof chatResponder.stream>>;
            }) as typeof chatResponder.stream;

            await handleUserMessage(
                '你好',
                'thread-phase3-chat-route',
                'employee-phase3-chat-route',
                () => undefined,
                {
                    forcedRouteMode: 'chat',
                    useDirectChatResponder: true,
                    forcePostAssistantCompletion: true,
                },
            );

            await handleUserMessage(
                '检查这个任务并执行',
                'thread-phase3-task-route',
                'employee-phase3-task-route',
                () => undefined,
                {
                    forcedRouteMode: 'task',
                },
            );

            expect(chatResponderCalls).toBe(1);
            expect(supervisorCalls).toBe(1);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalSupervisorStream as typeof supervisor.stream;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = originalChatResponderStream as typeof chatResponder.stream;
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

    test('handleUserMessage defaults to chatResponder when forcedRouteMode is chat', async () => {
        const originalSupervisorStream = supervisor.stream.bind(supervisor);
        const originalChatResponderStream = chatResponder.stream.bind(chatResponder);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        let supervisorCalls = 0;
        let chatResponderCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';

            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                supervisorCalls += 1;
                return {
                    runId: 'run-phase3-forced-chat-supervisor',
                    fullStream: (async function* () {
                        yield { type: 'text-delta', payload: { text: 'supervisor response' } };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = (async () => {
                chatResponderCalls += 1;
                return {
                    runId: 'run-phase3-forced-chat-direct',
                    fullStream: (async function* () {
                        yield { type: 'text-delta', payload: { text: 'chat response' } };
                    })(),
                } as unknown as Awaited<ReturnType<typeof chatResponder.stream>>;
            }) as typeof chatResponder.stream;

            await handleUserMessage(
                '今天天气怎么样',
                'thread-phase3-forced-chat-route',
                'employee-phase3-forced-chat-route',
                () => undefined,
                {
                    forcedRouteMode: 'chat',
                    forcePostAssistantCompletion: true,
                },
            );

            expect(chatResponderCalls).toBe(1);
            expect(supervisorCalls).toBe(0);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalSupervisorStream as typeof supervisor.stream;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = originalChatResponderStream as typeof chatResponder.stream;
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

    test('handleUserMessage routes task web-research turns to researcher directly', async () => {
        const originalSupervisorStream = supervisor.stream.bind(supervisor);
        const originalResearcherStream = researcher.stream.bind(researcher);
        const originalChatResponderStream = chatResponder.stream.bind(chatResponder);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        let supervisorCalls = 0;
        let researcherCalls = 0;
        let chatResponderCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '1';

            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                supervisorCalls += 1;
                return {
                    runId: 'run-phase3-route-supervisor-unexpected',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'unexpected supervisor response' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (researcher as unknown as { stream: typeof researcher.stream }).stream = (async () => {
                researcherCalls += 1;
                return {
                    runId: 'run-phase3-route-researcher',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'researcher response' },
                        };
                        yield {
                            type: 'complete',
                            payload: { finishReason: 'stop' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof researcher.stream>>;
            }) as typeof researcher.stream;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = (async () => {
                chatResponderCalls += 1;
                return {
                    runId: 'run-phase3-route-chat-unexpected',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'unexpected chat response' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof chatResponder.stream>>;
            }) as typeof chatResponder.stream;

            await handleUserMessage(
                '请帮我查一下 MiniMax 最近的公开新闻并总结',
                'thread-phase3-task-web-research',
                'employee-phase3-task-web-research',
                () => undefined,
                {
                    forcedRouteMode: 'task',
                    requiredCompletionCapabilities: ['web_research'],
                    turnContractDomain: 'general',
                },
            );

            expect(researcherCalls).toBe(1);
            expect(supervisorCalls).toBe(0);
            expect(chatResponderCalls).toBe(0);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalSupervisorStream as typeof supervisor.stream;
            (researcher as unknown as { stream: typeof researcher.stream }).stream = originalResearcherStream as typeof researcher.stream;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = originalChatResponderStream as typeof chatResponder.stream;
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
        }
    });

    test('handleUserMessage disables tool approval by default for task web-research researcher route', async () => {
        const originalResearcherStream = researcher.stream.bind(researcher);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        let capturedRequireToolApproval: boolean | undefined;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '1';

            (researcher as unknown as { stream: typeof researcher.stream }).stream = (async (_message, streamOptions) => {
                const candidate = streamOptions as Record<string, unknown> | undefined;
                capturedRequireToolApproval = candidate?.requireToolApproval as boolean | undefined;
                return {
                    runId: 'run-phase3-web-research-no-approval',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'researcher response' },
                        };
                        yield {
                            type: 'complete',
                            payload: { finishReason: 'stop' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof researcher.stream>>;
            }) as typeof researcher.stream;

            await handleUserMessage(
                '请帮我查一下 MiniMax 最近的公开新闻并总结',
                'thread-phase3-web-research-no-approval',
                'employee-phase3-web-research-no-approval',
                () => undefined,
                {
                    forcedRouteMode: 'task',
                    requiredCompletionCapabilities: ['web_research'],
                    turnContractDomain: 'general',
                },
            );

            expect(capturedRequireToolApproval).toBe(false);
        } finally {
            (researcher as unknown as { stream: typeof researcher.stream }).stream = originalResearcherStream as typeof researcher.stream;
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
        }
    });

    test('market-data query uses tool-first policy and keeps workspace command for fallback attempts', () => {
        const originalPolicy = process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST;
        process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST = '1';
        try {
            expect(isMarketDataResearchQuery('今天 minimax 的港股股价是什么表现？这周涨势怎么样？')).toBe(true);
            const rawToolsets = {
                workspace: {
                    mastra_workspace_execute_command: { id: 'mastra_workspace_execute_command' },
                    search_web: { id: 'search_web' },
                    finance: { id: 'finance' },
                },
            } as unknown as Awaited<ReturnType<typeof buildToolsetsForMessageAttempt>>;
            const firstAttempt = buildToolsetsForMessageAttempt(
                rawToolsets,
                '今天 minimax 的港股股价是什么表现？这周涨势怎么样？',
                0,
            );
            expect(
                Object.prototype.hasOwnProperty.call(
                    (firstAttempt as Record<string, Record<string, unknown>>).workspace,
                    'mastra_workspace_execute_command',
                ),
            ).toBe(false);
            expect(
                Object.prototype.hasOwnProperty.call(
                    (firstAttempt as Record<string, Record<string, unknown>>).workspace,
                    'search_web',
                ),
            ).toBe(false);
            expect(
                Object.prototype.hasOwnProperty.call(
                    (firstAttempt as Record<string, Record<string, unknown>>).workspace,
                    'finance',
                ),
            ).toBe(true);
            const retryAttempt = buildToolsetsForMessageAttempt(
                rawToolsets,
                '今天 minimax 的港股股价是什么表现？这周涨势怎么样？',
                1,
            ) as Record<string, Record<string, unknown>>;
            expect(
                Object.prototype.hasOwnProperty.call(
                    retryAttempt.workspace,
                    'mastra_workspace_execute_command',
                ),
            ).toBe(true);
        } finally {
            if (typeof originalPolicy === 'string') {
                process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST = originalPolicy;
            } else {
                delete process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST;
            }
        }
    });

    test('market-data query falls back to generic research tools when no specialized market tool is available', () => {
        const originalPolicy = process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST;
        process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST = '1';
        try {
            const rawToolsets = {
                workspace: {
                    mastra_workspace_execute_command: { id: 'mastra_workspace_execute_command' },
                    search_web: { id: 'search_web', description: 'Search public web sources' },
                    crawl_url: { id: 'crawl_url', description: 'Crawl web pages by URL' },
                },
            } as unknown as Awaited<ReturnType<typeof buildToolsetsForMessageAttempt>>;
            const firstAttempt = buildToolsetsForMessageAttempt(
                rawToolsets,
                '今天 minimax 的港股股价是什么表现？这周涨势怎么样？',
                0,
            ) as Record<string, Record<string, unknown>>;
            expect(
                Object.prototype.hasOwnProperty.call(firstAttempt.workspace, 'mastra_workspace_execute_command'),
            ).toBe(false);
            expect(
                Object.prototype.hasOwnProperty.call(firstAttempt.workspace, 'search_web'),
            ).toBe(true);
            expect(
                Object.prototype.hasOwnProperty.call(firstAttempt.workspace, 'crawl_url'),
            ).toBe(true);
        } finally {
            if (typeof originalPolicy === 'string') {
                process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST = originalPolicy;
            } else {
                delete process.env.COWORKANY_MASTRA_MARKET_DATA_TOOL_FIRST;
            }
        }
    });

    test('tool-first policy works for non-market task turns when web_research capability is required', () => {
        const originalPolicy = process.env.COWORKANY_MASTRA_TOOL_FIRST;
        process.env.COWORKANY_MASTRA_TOOL_FIRST = '1';
        try {
            const rawToolsets = {
                workspace: {
                    mastra_workspace_execute_command: { id: 'mastra_workspace_execute_command' },
                    search_web: { id: 'search_web', description: 'Search public web sources' },
                    crawl_url: { id: 'crawl_url', description: 'Crawl web pages by URL' },
                },
            } as unknown as Awaited<ReturnType<typeof buildToolsetsForMessageAttempt>>;
            const firstAttempt = buildToolsetsForMessageAttempt(
                rawToolsets,
                '请帮我查一下今天的 AI 行业新闻并总结三点',
                0,
                {
                    requiredCompletionCapabilities: ['web_research'],
                    isTaskRoute: true,
                },
            ) as Record<string, Record<string, unknown>>;
            expect(
                Object.prototype.hasOwnProperty.call(firstAttempt.workspace, 'mastra_workspace_execute_command'),
            ).toBe(false);
            expect(
                Object.prototype.hasOwnProperty.call(firstAttempt.workspace, 'search_web'),
            ).toBe(true);
            expect(
                Object.prototype.hasOwnProperty.call(firstAttempt.workspace, 'crawl_url'),
            ).toBe(true);
        } finally {
            if (typeof originalPolicy === 'string') {
                process.env.COWORKANY_MASTRA_TOOL_FIRST = originalPolicy;
            } else {
                delete process.env.COWORKANY_MASTRA_TOOL_FIRST;
            }
        }
    });

    test('weather query detection and weather-tool availability checks work for routing decisions', () => {
        expect(isWeatherInformationQuery('今天天气怎么样')).toBe(true);
        expect(isWeatherInformationQuery('what is the weather today in shanghai')).toBe(true);
        expect(isWeatherInformationQuery('帮我改一下这个函数')).toBe(false);
        const toolsetsWithWeather = {
            personal: {
                check_weather: { id: 'check_weather', description: 'Get weather forecast by city' },
            },
            workspace: {
                mastra_workspace_list_files: { id: 'mastra_workspace_list_files' },
            },
        } as unknown as Awaited<ReturnType<typeof buildToolsetsForMessageAttempt>>;
        const toolsetsWithoutWeather = {
            workspace: {
                mastra_workspace_list_files: { id: 'mastra_workspace_list_files' },
                search_web: { id: 'search_web', description: 'Search web pages' },
            },
        } as unknown as Awaited<ReturnType<typeof buildToolsetsForMessageAttempt>>;
        expect(hasWeatherInformationTool(toolsetsWithWeather)).toBe(true);
        expect(hasWeatherInformationTool(toolsetsWithoutWeather)).toBe(false);
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
        let capturedMessage = '';

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (
                incomingMessage: string,
                options?: Record<string, unknown>,
            ) => {
                capturedMessage = incomingMessage;
                capturedOptions = options;
                return {
                    runId: 'run-phase3-context',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'context ok' },
                        };
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
                    skillPrompt: '[Enabled Skills]\n- stock-pro-research: use professional stock feeds first',
                },
            );

            expect(result.runId).toBe('run-phase3-context');
            expect(capturedMessage).toContain('[Enabled Skills]');
            expect(capturedMessage).toContain('[User Request]');
            expect(capturedMessage).toContain('context test');
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

    test('handleUserMessage defaults task-mode tool approvals to explicit resume path', async () => {
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
                    runId: 'run-phase3-task-default-approval',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'task defaults ok' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            await handleUserMessage(
                'task default approval',
                'thread-task-default-approval',
                'employee-task-default-approval',
                () => undefined,
                {
                    taskId: 'task-default-approval',
                    workspacePath: '/tmp/task-default-approval',
                },
            );

            expect(capturedOptions).toBeDefined();
            expect(capturedOptions?.requireToolApproval).toBe(true);
            expect(capturedOptions?.autoResumeSuspendedTools).toBe(false);
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

    test('handleUserMessage defaults force-post path to multi-step budget for tool + narrative completion', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        const previousForcePostMaxSteps = process.env.COWORKANY_MASTRA_FORCE_POST_MAX_STEPS;
        let capturedOptions: Record<string, unknown> | undefined;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
            delete process.env.COWORKANY_MASTRA_FORCE_POST_MAX_STEPS;
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async (
                _message: string,
                options?: Record<string, unknown>,
            ) => {
                capturedOptions = options;
                return {
                    runId: 'run-phase3-force-post-max-steps',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'force-post max steps default ok' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            await handleUserMessage(
                'today minimax hk stock trend',
                'thread-force-post-max-steps',
                'employee-force-post-max-steps',
                () => undefined,
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(capturedOptions).toBeDefined();
            expect(capturedOptions?.maxSteps).toBe(12);
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
            if (typeof previousForcePostMaxSteps === 'string') {
                process.env.COWORKANY_MASTRA_FORCE_POST_MAX_STEPS = previousForcePostMaxSteps;
            } else {
                delete process.env.COWORKANY_MASTRA_FORCE_POST_MAX_STEPS;
            }
        }
    });

    test('handleUserMessage uses tighter maxSteps budget for chat force-post turns by default', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalChatStream = chatResponder.stream.bind(chatResponder);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousChatForcePostMaxSteps = process.env.COWORKANY_MASTRA_CHAT_FORCE_POST_MAX_STEPS;
        let capturedOptions: Record<string, unknown> | undefined;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            delete process.env.COWORKANY_MASTRA_CHAT_FORCE_POST_MAX_STEPS;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = (async (
                _message: string,
                options?: Record<string, unknown>,
            ) => {
                capturedOptions = options;
                return {
                    runId: 'run-phase3-chat-force-post-max-steps',
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'chat force-post max steps default ok' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            await handleUserMessage(
                '你好，请简单问候我一下。',
                'thread-chat-force-post-max-steps',
                'employee-chat-force-post-max-steps',
                () => undefined,
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'chat',
                },
            );

            expect(capturedOptions).toBeDefined();
            expect(capturedOptions?.maxSteps).toBe(3);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (chatResponder as unknown as { stream: typeof chatResponder.stream }).stream = originalChatStream as typeof chatResponder.stream;
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
            if (typeof previousChatForcePostMaxSteps === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_FORCE_POST_MAX_STEPS = previousChatForcePostMaxSteps;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_FORCE_POST_MAX_STEPS;
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
                        yield {
                            type: 'text-delta',
                            payload: { text: 'provider options ok' },
                        };
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
                        yield {
                            type: 'text-delta',
                            payload: { text: 'retry ok' },
                        };
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

    test('handleUserMessage emits compact llm_timing metrics with proxy before/after snapshot', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousOpenAi = process.env.OPENAI_API_KEY;
        const previousProvider = process.env.COWORKANY_LLM_CONFIG_PROVIDER;
        const previousProxy = process.env.COWORKANY_PROXY_URL;
        const originalConsoleInfo = console.info;
        const metricLines: string[] = [];

        try {
            process.env.COWORKANY_MODEL = 'aiberm/gpt-5.3-codex';
            process.env.OPENAI_API_KEY = 'test-key';
            process.env.COWORKANY_LLM_CONFIG_PROVIDER = 'aiberm';
            process.env.COWORKANY_PROXY_URL = 'http://127.0.0.1:7890';
            console.info = (...args: unknown[]) => {
                metricLines.push(args.map((arg) => String(arg)).join(' '));
            };
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* simpleAssistantStream() {
                    yield {
                        type: 'text-delta',
                        payload: { text: '你好' },
                    };
                }
                return {
                    runId: 'run-phase3-metrics-log',
                    fullStream: simpleAssistantStream(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'metrics snapshot',
                'thread-metrics-snapshot',
                'employee-metrics-snapshot',
                () => undefined,
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-metrics-log');
            const metricLine = metricLines.find((line) => line.includes('[coworkany-metrics]'));
            expect(typeof metricLine).toBe('string');
            const serialized = String(metricLine).replace(/^[\s\S]*?\[coworkany-metrics\]\s*/, '');
            const payload = JSON.parse(serialized) as {
                event?: string;
                phase?: string;
                outcome?: string;
                timings?: { firstTokenMs?: number | null };
                proxy?: {
                    before?: { enabled?: boolean };
                    after?: { enabled?: boolean };
                };
            };
            expect(payload.event).toBe('llm_timing');
            expect(payload.phase).toBe('stream');
            expect(payload.outcome).toBe('success');
            expect(typeof payload.timings?.firstTokenMs).toBe('number');
            expect(payload.proxy?.before?.enabled).toBe(true);
            expect(payload.proxy?.after?.enabled).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            console.info = originalConsoleInfo;
            if (typeof previousModel === 'string') {
                process.env.COWORKANY_MODEL = previousModel;
            } else {
                delete process.env.COWORKANY_MODEL;
            }
            if (typeof previousOpenAi === 'string') {
                process.env.OPENAI_API_KEY = previousOpenAi;
            } else {
                delete process.env.OPENAI_API_KEY;
            }
            if (typeof previousProvider === 'string') {
                process.env.COWORKANY_LLM_CONFIG_PROVIDER = previousProvider;
            } else {
                delete process.env.COWORKANY_LLM_CONFIG_PROVIDER;
            }
            if (typeof previousProxy === 'string') {
                process.env.COWORKANY_PROXY_URL = previousProxy;
            } else {
                delete process.env.COWORKANY_PROXY_URL;
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

    test('chat-mode startup budget prevents long fallback hangs on first-token timeout', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousChatStartRetry = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT;
        const previousChatStartTimeout = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS;
        const previousChatStartupBudget = process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS;
        const previousChatGenerateFallbackTimeout = process.env.COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'true';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS = '3000';
            process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS = '3500';
            process.env.COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS = '20000';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                throw new Error('stream_start_timeout:3000');
            }) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                await new Promise(() => undefined);
                throw new Error('unreachable');
            }) as typeof supervisor.generate;

            const startedAt = Date.now();
            const result = await handleUserMessage(
                'startup budget fallback guard',
                'thread-startup-budget-fallback',
                'employee-startup-budget-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );
            const elapsedMs = Date.now() - startedAt;

            expect(result.runId.startsWith('start-failed-')).toBe(true);
            expect(elapsedMs).toBeLessThan(7_000);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && (
                    String(event.message ?? '').includes('generate_fallback_timeout:')
                    || String(event.message ?? '').includes('chat_startup_timeout_budget_exhausted')
                )
            ))).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousChatStartupBudget === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS = previousChatStartupBudget;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS;
            }
            if (typeof previousChatGenerateFallbackTimeout === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS = previousChatGenerateFallbackTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_GENERATE_FALLBACK_TIMEOUT_MS;
            }
        }
    });

    test('chat-mode honors externally provided absolute deadlines', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const events: Array<Record<string, unknown>> = [];
        let streamInvoked = false;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamInvoked = true;
                throw new Error('stream_should_not_start_when_budget_expired');
            }) as typeof supervisor.stream;

            const startedAt = Date.now();
            const result = await handleUserMessage(
                'external deadline budget check',
                'thread-external-deadline',
                'employee-external-deadline',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    chatTurnDeadlineAtMs: Date.now() + 5_000,
                    chatStartupDeadlineAtMs: Date.now() - 1_000,
                },
            );
            const elapsedMs = Date.now() - startedAt;

            expect(result.runId.startsWith('start-failed-')).toBe(true);
            expect(elapsedMs).toBeLessThan(2_000);
            expect(streamInvoked).toBe(false);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('chat_startup_timeout_budget_exhausted')
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
        }
    });

    test('task-routed direct turns bypass chat startup retry profile', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousChatStartRetry = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT;
        const previousChatStartRetryDelay = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS;
        const previousChatStartTimeout = process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS;
        const previousChatStartupBudget = process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS;
        const previousDefaultStartRetry = process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_COUNT = '5';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS = '200';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS = '50';
            process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS = '4000';
            process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT = '0';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                throw new Error('stream_start_timeout:50');
            }) as typeof supervisor.stream;

            const startedAt = Date.now();
            const result = await handleUserMessage(
                'task route startup profile check',
                'thread-task-route-startup-profile',
                'employee-task-route-startup-profile',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );
            const elapsedMs = Date.now() - startedAt;
            const rateLimitedEvents = events.filter((event) => event.type === 'rate_limited');

            expect(result.runId.startsWith('start-failed-')).toBe(true);
            expect(streamCalls).toBeGreaterThanOrEqual(1);
            expect(streamCalls).toBeLessThanOrEqual(2);
            expect(elapsedMs).toBeLessThan(2_500);
            expect(rateLimitedEvents.length).toBeLessThanOrEqual(2);
            expect(rateLimitedEvents.every((event) => {
                const maxAttempts = Number(event.maxAttempts ?? 0);
                return Number.isFinite(maxAttempts) && maxAttempts <= 3;
            })).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('stream_start_timeout:50')
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
            if (typeof previousChatStartRetryDelay === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS = previousChatStartRetryDelay;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_START_RETRY_DELAY_MS;
            }
            if (typeof previousChatStartTimeout === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS = previousChatStartTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_START_TIMEOUT_MS;
            }
            if (typeof previousChatStartupBudget === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS = previousChatStartupBudget;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS;
            }
            if (typeof previousDefaultStartRetry === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT = previousDefaultStartRetry;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_RETRY_COUNT;
            }
        }
    });

    test('task-mode does not exhaust startup budget after stream handshake', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        const previousTaskStartupBudget = process.env.COWORKANY_MASTRA_TASK_STARTUP_BUDGET_MS;
        const previousTaskStreamIdleTimeout = process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS;
        const previousForwardRetryCount = process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
        const previousForwardRetryDelay = process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_DELAY_MS;
        const previousTaskGenerateFallback = process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK;
        const previousStreamReturnTimeout = process.env.COWORKANY_MASTRA_STREAM_RETURN_TIMEOUT_MS;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
            process.env.COWORKANY_MASTRA_TASK_STARTUP_BUDGET_MS = '150';
            process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS = '200';
            process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = '5';
            process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_DELAY_MS = '50';
            process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_STREAM_RETURN_TIMEOUT_MS = '100';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                if (streamCalls < 3) {
                    return {
                        runId: `run-task-startup-budget-attempt-${streamCalls}`,
                        fullStream: (async function* delayedFirstTokenTimeout() {
                            await new Promise<void>((resolve) => {
                                setTimeout(resolve, 80);
                            });
                            throw new Error('stream_idle_timeout:60000');
                        })(),
                    } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
                }
                return {
                    runId: 'run-task-startup-budget-success',
                    fullStream: (async function* recoveredThirdAttempt() {
                        yield {
                            type: 'text-delta',
                            payload: {
                                text: '第三次尝试恢复成功。',
                            },
                        };
                        yield {
                            type: 'complete',
                            payload: {
                                finishReason: 'stop',
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'task startup budget should close on stream handshake',
                'thread-task-startup-budget-handshake',
                'employee-task-startup-budget-handshake',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId).toBe('run-task-startup-budget-success');
            expect(streamCalls).toBe(3);
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('chat_startup_timeout_budget_exhausted')
            ))).toBe(false);
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
            if (typeof previousTaskStartupBudget === 'string') {
                process.env.COWORKANY_MASTRA_TASK_STARTUP_BUDGET_MS = previousTaskStartupBudget;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_STARTUP_BUDGET_MS;
            }
            if (typeof previousTaskStreamIdleTimeout === 'string') {
                process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS = previousTaskStreamIdleTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS;
            }
            if (typeof previousForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = previousForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
            }
            if (typeof previousForwardRetryDelay === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_DELAY_MS = previousForwardRetryDelay;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_DELAY_MS;
            }
            if (typeof previousTaskGenerateFallback === 'string') {
                process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK = previousTaskGenerateFallback;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK;
            }
            if (typeof previousStreamReturnTimeout === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_RETURN_TIMEOUT_MS = previousStreamReturnTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_RETURN_TIMEOUT_MS;
            }
        }
    });

    test('task-route avoids generate fallback when retry startup throws no-narrative completion error', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousNoNarrativeRetry = process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;
        let generateCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT = '1';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                if (streamCalls === 1) {
                    return {
                        runId: 'run-phase3-task-no-narrative-empty-stream',
                        fullStream: (async function* emptyStream() {
                            // Intentionally emit no assistant chunks to trigger no-narrative retry.
                        })(),
                    } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
                }
                throw new Error('stream_exhausted_without_assistant_text');
            }) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                generateCalls += 1;
                return {
                    runId: 'run-phase3-task-no-narrative-fallback',
                    text: 'task-route fallback narrative',
                    finishReason: 'stop',
                };
            }) as typeof supervisor.generate;

            const result = await handleUserMessage(
                'task route no narrative start fallback',
                'thread-task-no-narrative-start-fallback',
                'employee-task-no-narrative-start-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId.startsWith('start-failed-')).toBe(true);
            expect(streamCalls).toBe(2);
            expect(generateCalls).toBe(0);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('stream_exhausted_without_assistant_text')
            ))).toBe(true);
            expect(events.some((event) => event.type === 'complete')).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousNoNarrativeRetry === 'string') {
                process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT = previousNoNarrativeRetry;
            } else {
                delete process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT;
            }
        }
    });

    test('task-route performs one bounded retry and avoids generate fallback when stream emits terminal no-narrative error before assistant text', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousNoNarrativeRetry = process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;
        let generateCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT = '0';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                return {
                    runId: 'run-phase3-task-terminal-no-narrative-error',
                    fullStream: (async function* noNarrativeTerminalErrorStream() {
                        yield {
                            type: 'tool-call',
                            payload: {
                                toolName: 'agent-researcher',
                                args: { prompt: 'research prompt' },
                            },
                        };
                        yield {
                            type: 'error',
                            payload: {
                                error: { message: 'stream_exhausted_without_assistant_text' },
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                generateCalls += 1;
                return {
                    runId: 'run-phase3-task-terminal-no-narrative-fallback',
                    text: 'fallback after terminal no-narrative error',
                    finishReason: 'stop',
                };
            }) as typeof supervisor.generate;

            const result = await handleUserMessage(
                'task route terminal no-narrative error fallback',
                'thread-task-terminal-no-narrative-error-fallback',
                'employee-task-terminal-no-narrative-error-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId).toBe('run-phase3-task-terminal-no-narrative-error');
            expect(streamCalls).toBe(2);
            expect(generateCalls).toBe(0);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('stream_exhausted_without_assistant_text')
            ))).toBe(true);
            expect(events.some((event) => event.type === 'complete')).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousNoNarrativeRetry === 'string') {
                process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT = previousNoNarrativeRetry;
            } else {
                delete process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT;
            }
        }
    });

    test('task-route performs one bounded retry when tooling progress emits no-narrative terminal error', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousNoNarrativeRetry = process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT = '5';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                return {
                    runId: 'run-phase3-task-no-retry-after-tooling',
                    fullStream: (async function* toolingThenNoNarrativeErrorStream() {
                        yield {
                            type: 'tool-call',
                            payload: {
                                toolName: 'agent-researcher',
                                args: { prompt: 'research prompt' },
                            },
                        };
                        yield {
                            type: 'error',
                            payload: {
                                error: { message: 'stream_exhausted_without_assistant_text' },
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'task route no retry after tooling progress',
                'thread-task-no-retry-after-tooling',
                'employee-task-no-retry-after-tooling',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId).toBe('run-phase3-task-no-retry-after-tooling');
            expect(streamCalls).toBe(2);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('stream_exhausted_without_assistant_text')
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
            if (typeof previousNoNarrativeRetry === 'string') {
                process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT = previousNoNarrativeRetry;
            } else {
                delete process.env.COWORKANY_MASTRA_NO_NARRATIVE_RETRY_COUNT;
            }
        }
    });

    test('chat-mode falls back to generate when stream completes without assistant narrative', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousForwardRetryCount = process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'true';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = '5';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                return {
                    runId: 'run-phase3-no-narrative-stream',
                    fullStream: (async function* emptyStream() {
                        // Intentionally emit no assistant chunks to simulate silent stream exhaustion.
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => ({
                runId: 'run-phase3-no-narrative-fallback',
                text: '这是自动回退生成的答复。',
                finishReason: 'stop',
            })) as typeof supervisor.generate;

            const result = await handleUserMessage(
                'silent stream fallback',
                'thread-no-narrative-fallback',
                'employee-no-narrative-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(streamCalls).toBe(2);
            expect(result.runId).toBe('run-phase3-no-narrative-fallback');
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => (
                event.type === 'text_delta'
                && String(event.content ?? '').includes('自动回退生成')
            ))).toBe(true);
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => event.type === 'error')).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = previousForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
            }
        }
    });

    test('chat-mode skips fallback when approval is requested before assistant narrative', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;
        let generateCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'true';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                return {
                    runId: 'run-phase3-approval-stream',
                    fullStream: (async function* approvalOnlyStream() {
                        yield {
                            type: 'tool-call-approval',
                            payload: {
                                toolCallId: 'call-approval-1',
                                toolName: 'mastra_workspace_execute_command',
                                args: { command: 'curl -s https://example.com' },
                                resumeSchema: '{}',
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                generateCalls += 1;
                return {
                    runId: 'run-phase3-approval-fallback',
                    text: 'unexpected fallback',
                    finishReason: 'stop',
                };
            }) as typeof supervisor.generate;

            const result = await handleUserMessage(
                'approval-only stream',
                'thread-approval-no-fallback',
                'employee-approval-no-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-approval-stream');
            expect(streamCalls).toBe(1);
            expect(generateCalls).toBe(0);
            expect(events.some((event) => event.type === 'approval_required')).toBe(true);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(false);
            expect(events.some((event) => event.type === 'complete' && event.finishReason === 'stream_exhausted')).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
        }
    });

    test('chat-mode falls back when wrapped auto-approved approval stream has no assistant narrative', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;
        let generateCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'true';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                return {
                    runId: 'run-phase3-wrapped-approval-stream',
                    fullStream: (async function* wrappedApprovalOnlyStream() {
                        yield {
                            type: 'agent-execution-event',
                            payload: {
                                type: 'data-tool-call-approval',
                                payload: {
                                    toolCallId: 'call-wrapped-approval-1',
                                    toolName: 'agent-researcher',
                                    args: { prompt: 'wrapped approval prompt' },
                                    resumeSchema: '{}',
                                },
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                generateCalls += 1;
                return {
                    runId: 'run-phase3-wrapped-approval-fallback',
                    text: 'unexpected fallback',
                    finishReason: 'stop',
                };
            }) as typeof supervisor.generate;

            const result = await handleUserMessage(
                'wrapped approval-only stream',
                'thread-wrapped-approval-no-fallback',
                'employee-wrapped-approval-no-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-wrapped-approval-fallback');
            expect(streamCalls).toBe(2);
            expect(generateCalls).toBe(1);
            expect(events.some((event) => event.type === 'approval_required')).toBe(true);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => event.type === 'complete' && event.finishReason === 'stop')).toBe(true);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
        }
    });

    test('chat-mode uses generate fallback when stream only suspends without approval and has no assistant narrative', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousForwardRetryCount = process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;
        let generateCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'true';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = '0';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                return {
                    runId: 'run-phase3-suspended-no-narrative-stream',
                    fullStream: (async function* suspendedOnlyStream() {
                        yield {
                            type: 'tool-call-suspended',
                            payload: {
                                toolCallId: 'call-suspended-1',
                                toolName: 'agent-researcher',
                                suspendPayload: { reason: 'waiting_context' },
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                generateCalls += 1;
                return {
                    runId: 'run-phase3-suspended-no-narrative-fallback',
                    text: '这是 suspended-only 场景下的自动回退结果。',
                    finishReason: 'fallback_generate',
                };
            }) as typeof supervisor.generate;

            const result = await handleUserMessage(
                'suspended only stream fallback',
                'thread-suspended-no-narrative-fallback',
                'employee-suspended-no-narrative-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-suspended-no-narrative-fallback');
            expect(streamCalls).toBe(1);
            expect(generateCalls).toBe(1);
            expect(events.some((event) => event.type === 'suspended')).toBe(true);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => (
                event.type === 'text_delta'
                && String(event.content ?? '').includes('suspended-only 场景下的自动回退结果')
            ))).toBe(true);
            expect(events.some((event) => event.type === 'complete' && event.finishReason === 'fallback_generate')).toBe(true);
            expect(events.some((event) => event.type === 'error')).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = previousForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
            }
        }
    });

    test('chat-mode does not emit provisional complete for no-narrative completion errors', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousChatForwardRetryCount = process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = '0';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => ({
                runId: 'run-phase3-no-narrative-complete',
                fullStream: (async function* noNarrativeCompleteStream() {
                    yield {
                        type: 'finish',
                        payload: {
                            finishReason: 'stream_exhausted',
                        },
                    };
                })(),
            })) as typeof supervisor.stream;

            await handleUserMessage(
                'no narrative complete suppression',
                'thread-no-narrative-complete',
                'employee-no-narrative-complete',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(events.some((event) => event.type === 'complete')).toBe(false);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('complete_without_assistant_text')
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
            if (typeof previousChatForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = previousChatForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
            }
        }
    });

    test('task-mode surfaces error when tooling starts after assistant text but stream has no terminal event', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                return {
                    runId: 'run-missing-terminal-after-tooling',
                    fullStream: (async function* missingTerminalAfterToolingStream() {
                        yield {
                            type: 'text-delta',
                            payload: {
                                text: '我来帮你查询 MiniMax 的港股股价情况和本周趋势。',
                            },
                        };
                        yield {
                            type: 'tool-call',
                            payload: {
                                toolName: 'agent-researcher',
                                args: {
                                    prompt: '查询 MiniMax 港股股价和本周趋势',
                                },
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                '今天 minimax 的港股股价怎么样？本周会有哪些趋势？',
                'thread-missing-terminal-after-tooling',
                'employee-missing-terminal-after-tooling',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId).toBe('run-missing-terminal-after-tooling');
            expect(streamCalls).toBe(2);
            expect(events.some((event) => event.type === 'complete')).toBe(false);
            expect(events.some((event) => event.type === 'tool_call')).toBe(true);
            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('missing_terminal_after_tooling_progress')
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
        }
    });

    test('task-mode retries when delegated tooling run loses snapshot after assistant preface', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                if (streamCalls === 1) {
                    return {
                        runId: 'run-snapshot-loss-attempt-1',
                        fullStream: (async function* firstAttemptWithSnapshotLoss() {
                            yield {
                                type: 'text-delta',
                                payload: {
                                    text: '我来帮你查询 MiniMax 的港股股价情况和本周趋势。',
                                },
                            };
                            yield {
                                type: 'tool-call',
                                payload: {
                                    toolName: 'agent-researcher',
                                    args: {
                                        prompt: '查询 MiniMax 港股股价和本周趋势',
                                    },
                                },
                            };
                            throw new Error('No snapshot found for this workflow run: agentic-loop run-snapshot-loss-attempt-1');
                        })(),
                    } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
                }
                return {
                    runId: 'run-snapshot-loss-attempt-2',
                    fullStream: (async function* secondAttemptRecovered() {
                        yield {
                            type: 'text-delta',
                            payload: {
                                text: '已恢复，以下是 MiniMax 港股本周走势摘要。',
                            },
                        };
                        yield {
                            type: 'complete',
                            payload: {
                                finishReason: 'stop',
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                '今天 minimax 的港股股价怎么样？本周会有哪些趋势？',
                'thread-snapshot-loss-retry',
                'employee-snapshot-loss-retry',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId).toBe('run-snapshot-loss-attempt-2');
            expect(streamCalls).toBe(2);
            expect(events.some((event) => (
                event.type === 'rate_limited'
                && String(event.message ?? '').includes('Tool execution interrupted after assistant preface')
            ))).toBe(true);
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('No snapshot found for this workflow run')
            ))).toBe(false);
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
        }
    });

    test('task-mode stream timeout after tooling uses one bounded retry and then recovers', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        const previousForwardRetryCount = process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];
        let streamCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
            process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = '5';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                streamCalls += 1;
                if (streamCalls === 1) {
                    return {
                        runId: 'run-tooling-timeout-attempt-1',
                        fullStream: (async function* firstAttemptTimesOutAfterTooling() {
                            yield {
                                type: 'text-delta',
                                payload: {
                                    text: '我来帮你查询 MiniMax 的港股股价情况和本周趋势。',
                                },
                            };
                            yield {
                                type: 'tool-call',
                                payload: {
                                    toolName: 'search_web',
                                    args: {
                                        query: 'MiniMax 港股 股价 今天',
                                    },
                                },
                            };
                            throw new Error('stream_idle_timeout:60000');
                        })(),
                    } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
                }
                return {
                    runId: 'run-tooling-timeout-attempt-2',
                    fullStream: (async function* secondAttemptRecovered() {
                        yield {
                            type: 'text-delta',
                            payload: {
                                text: '已恢复，以下是 MiniMax 港股本周走势摘要。',
                            },
                        };
                        yield {
                            type: 'complete',
                            payload: {
                                finishReason: 'stop',
                            },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                '今天 minimax 的港股股价怎么样？本周会有哪些趋势？',
                'thread-tooling-timeout-retry',
                'employee-tooling-timeout-retry',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId).toBe('run-tooling-timeout-attempt-2');
            expect(streamCalls).toBe(2);
            const retryEvents = events.filter((event) => (
                event.type === 'rate_limited'
                && String(event.message ?? '').includes('Tool execution interrupted after assistant preface')
            ));
            expect(retryEvents.length).toBe(1);
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('stream_idle_timeout')
            ))).toBe(false);
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
            if (typeof previousForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = previousForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
            }
        }
    });

    test('task-mode tooling timeout can force generate fallback after bounded retry budget', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        const previousForwardRetryCount = process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
        const previousTaskGenerateFallback = process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK;
        const previousStreamIdleTimeout = process.env.COWORKANY_MASTRA_STREAM_IDLE_TIMEOUT_MS;
        const previousTaskStreamIdleTimeout = process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS;
        const previousTaskStreamProgressTimeout = process.env.COWORKANY_MASTRA_TASK_STREAM_PROGRESS_TIMEOUT_MS;
        const events: Array<Record<string, unknown>> = [];
        let generateCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
            process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK = 'false';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => ({
                runId: 'run-tooling-timeout-fallback-stream',
                fullStream: (async function* toolingTimeoutStream() {
                    yield {
                        type: 'text-delta',
                        payload: { text: '我来帮你查询 MiniMax 的港股股价情况和本周趋势。' },
                    };
                    yield {
                        type: 'tool-call',
                        payload: {
                            toolName: 'search_web',
                            args: { query: 'MiniMax 港股 股价 今天' },
                        },
                    };
                    throw new Error('stream_idle_timeout:60000');
                })(),
            })) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                generateCalls += 1;
                return {
                    runId: 'run-tooling-timeout-fallback-generate',
                    text: '已基于检索结果给出 MiniMax 港股趋势摘要。',
                    finishReason: 'stop',
                };
            }) as typeof supervisor.generate;

            const result = await handleUserMessage(
                '今天 minimax 的港股股价怎么样？本周会有哪些趋势？',
                'thread-tooling-timeout-fallback',
                'employee-tooling-timeout-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                },
            );

            expect(result.runId).toBe('run-tooling-timeout-fallback-generate');
            expect(generateCalls).toBe(1);
            const assistantText = events
                .filter((event) => event.type === 'text_delta')
                .map((event) => String(event.content ?? ''))
                .join('');
            expect(assistantText).toContain('MiniMax 港股趋势摘要');
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('stream_idle_timeout')
            ))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
            if (typeof previousForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = previousForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
            }
            if (typeof previousTaskGenerateFallback === 'string') {
                process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK = previousTaskGenerateFallback;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK;
            }
        }
    });

    test('task-mode tooling-only stream timeout without assistant narrative can force generate fallback', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPreferResearcher = process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
        const previousForwardRetryCount = process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
        const previousTaskGenerateFallback = process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK;
        const previousStreamIdleTimeout = process.env.COWORKANY_MASTRA_STREAM_IDLE_TIMEOUT_MS;
        const events: Array<Record<string, unknown>> = [];
        let generateCalls = 0;

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = '0';
            process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = '0';
            process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK = 'false';
            process.env.COWORKANY_MASTRA_STREAM_IDLE_TIMEOUT_MS = '900';
            process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS = '900';
            process.env.COWORKANY_MASTRA_TASK_STREAM_PROGRESS_TIMEOUT_MS = '900';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => ({
                runId: 'run-task-no-narrative-timeout-stream',
                fullStream: (async function* toolingOnlyTimeoutStream() {
                    yield {
                        type: 'tool-call',
                        payload: {
                            toolName: 'search_web',
                            args: { query: 'MiniMax 港股 股价 今天' },
                        },
                    };
                    await new Promise<void>(() => {
                        // Keep stream pending so forwardStream timeout budget drives recovery.
                    });
                })(),
            })) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => {
                generateCalls += 1;
                return {
                    runId: 'run-task-no-narrative-timeout-fallback',
                    text: '已触发超时回退并返回简要结果。',
                    finishReason: 'stop',
                };
            }) as typeof supervisor.generate;

            const deadlineNow = Date.now();
            const result = await handleUserMessage(
                '今天 minimax 的港股股价怎么样？本周会有哪些趋势？',
                'thread-task-no-narrative-timeout-fallback',
                'employee-task-no-narrative-timeout-fallback',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                    forcedRouteMode: 'task',
                    chatTurnDeadlineAtMs: deadlineNow + 5_000,
                    chatStartupDeadlineAtMs: deadlineNow + 4_500,
                },
            );

            expect(result.runId).toBe('run-task-no-narrative-timeout-fallback');
            expect(generateCalls).toBe(1);
            const assistantText = events
                .filter((event) => event.type === 'text_delta')
                .map((event) => String(event.content ?? ''))
                .join('');
            expect(assistantText).toContain('超时回退');
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => (
                event.type === 'error'
                && String(event.message ?? '').includes('stream_idle_timeout')
            ))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousPreferResearcher === 'string') {
                process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER = previousPreferResearcher;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_PREFER_RESEARCHER;
            }
            if (typeof previousForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT = previousForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_FORWARD_RETRY_COUNT;
            }
            if (typeof previousTaskGenerateFallback === 'string') {
                process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK = previousTaskGenerateFallback;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_ENABLE_GENERATE_FALLBACK;
            }
            if (typeof previousStreamIdleTimeout === 'string') {
                process.env.COWORKANY_MASTRA_STREAM_IDLE_TIMEOUT_MS = previousStreamIdleTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_STREAM_IDLE_TIMEOUT_MS;
            }
            if (typeof previousTaskStreamIdleTimeout === 'string') {
                process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS = previousTaskStreamIdleTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_STREAM_IDLE_TIMEOUT_MS;
            }
            if (typeof previousTaskStreamProgressTimeout === 'string') {
                process.env.COWORKANY_MASTRA_TASK_STREAM_PROGRESS_TIMEOUT_MS = previousTaskStreamProgressTimeout;
            } else {
                delete process.env.COWORKANY_MASTRA_TASK_STREAM_PROGRESS_TIMEOUT_MS;
            }
        }
    });

    test('chat-mode fallback filters internal completion-check narrative', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalGenerate = supervisor.generate.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousFallback = process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK;
        const previousForwardRetryCount = process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_ENABLE_GENERATE_FALLBACK = 'true';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = '5';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => ({
                runId: 'run-phase3-filter-stream',
                fullStream: (async function* emptyStream() {
                    // no narrative
                })(),
            })) as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = (async () => ({
                runId: 'run-phase3-filter-fallback',
                text: '#### Completion Check Results\n\n**coworkany-loop-has-answer**\nScore: 0',
                finishReason: 'stop',
            })) as typeof supervisor.generate;

            await handleUserMessage(
                'filter internal completion check',
                'thread-filter-internal-check',
                'employee-filter-internal-check',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(events.some((event) => event.type === 'rate_limited')).toBe(true);
            expect(events.some((event) => event.type === 'complete')).toBe(true);
            expect(events.some((event) => (
                event.type === 'text_delta'
                && String(event.content ?? '').includes('Completion Check Results')
            ))).toBe(false);
        } finally {
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = originalStream as typeof supervisor.stream;
            (supervisor as unknown as { generate: typeof supervisor.generate }).generate = originalGenerate as typeof supervisor.generate;
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
            if (typeof previousForwardRetryCount === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT = previousForwardRetryCount;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_FORWARD_RETRY_COUNT;
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

    test('chat-mode converts store-disabled history error after assistant text to recovered completion', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* storeDisabledFailureAfterText() {
                    yield {
                        type: 'text-delta',
                        payload: { text: '当然可以，给你一版简洁日报。' },
                    };
                    throw new Error("Item with id 'msg_x' not found. Items are not persisted when `store` is set to false.");
                }
                return {
                    runId: 'run-phase3-store-disabled-recovered',
                    fullStream: storeDisabledFailureAfterText(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'store-disabled history recover',
                'thread-store-disabled-recovered',
                'employee-store-disabled-recovered',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-store-disabled-recovered');
            expect(events.some((event) => event.type === 'text_delta')).toBe(true);
            const completed = events.find((event) => event.type === 'complete') as Record<string, unknown> | undefined;
            expect(completed?.finishReason).toBe('assistant_text_store_disabled_history_recovered');
            expect(events.some((event) => event.type === 'error')).toBe(false);
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

    test('chat-mode exits stream loop immediately after terminal error event', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* terminalErrorThenNoise() {
                    yield { type: 'text-delta', payload: { text: '前置文本' } };
                    yield { type: 'error', payload: { error: { message: 'fatal_upstream_error' } } };
                    yield { type: 'text-delta', payload: { text: 'should-not-emit' } };
                }
                return {
                    runId: 'run-phase3-terminal-error-stop',
                    fullStream: terminalErrorThenNoise(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'terminal error stop',
                'thread-terminal-error-stop',
                'employee-terminal-error-stop',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-terminal-error-stop');
            const emittedText = events
                .filter((event) => event.type === 'text_delta')
                .map((event) => String(event.content ?? ''));
            expect(emittedText.join('')).toBe('前置文本');
            const errorEvent = events.find((event) => event.type === 'error') as Record<string, unknown> | undefined;
            expect(errorEvent?.message).toContain('fatal_upstream_error');
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

    test('chat-mode settled window refreshes on each streamed delta', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPostAssistantMax = process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = '80';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* slowTextStream() {
                    yield {
                        type: 'text-delta',
                        payload: { text: 'A' },
                    };
                    await new Promise((resolve) => setTimeout(resolve, 40));
                    yield {
                        type: 'text-delta',
                        payload: { text: 'B' },
                    };
                    await new Promise((resolve) => setTimeout(resolve, 40));
                    yield {
                        type: 'text-delta',
                        payload: { text: 'C' },
                    };
                    await new Promise((resolve) => setTimeout(resolve, 40));
                    yield {
                        type: 'text-delta',
                        payload: { text: 'D' },
                    };
                }
                return {
                    runId: 'run-phase3-refresh-window',
                    fullStream: slowTextStream(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'refresh settled window',
                'thread-refresh-window',
                'employee-refresh-window',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-refresh-window');
            const textDeltas = events
                .filter((event) => event.type === 'text_delta')
                .map((event) => String(event.content ?? ''));
            expect(textDeltas.join('')).toContain('ABCD');
            const completed = events.find((event) => event.type === 'complete') as Record<string, unknown> | undefined;
            expect(completed?.finishReason).not.toBe('assistant_text_settled_max_window');
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
            if (typeof previousPostAssistantMax === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = previousPostAssistantMax;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
            }
        }
    });

    test('chat-mode settles quickly when only thinking deltas arrive after assistant text', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPostAssistantIdle = process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_IDLE_COMPLETE_MS;
        const previousPostAssistantMax = process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_IDLE_COMPLETE_MS = '40';
            process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = '500';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* thinkingTailLoop() {
                    yield { type: 'text-delta', payload: { text: 'A' } };
                    await new Promise((resolve) => setTimeout(resolve, 15));
                    yield { type: 'reasoning-delta', payload: { textDelta: 'r1' } };
                    await new Promise((resolve) => setTimeout(resolve, 15));
                    yield { type: 'reasoning-delta', payload: { textDelta: 'r2' } };
                    await new Promise((resolve) => setTimeout(resolve, 15));
                    yield { type: 'reasoning-delta', payload: { textDelta: 'r3' } };
                    await new Promise((resolve) => setTimeout(resolve, 15));
                    yield { type: 'text-delta', payload: { text: 'SHOULD_NOT_APPEAR' } };
                }
                return {
                    runId: 'run-phase3-thinking-tail-settle',
                    fullStream: thinkingTailLoop(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'thinking tail settle',
                'thread-thinking-tail-settle',
                'employee-thinking-tail-settle',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-thinking-tail-settle');
            const assistantText = events
                .filter((event) => event.type === 'text_delta' && event.role === 'assistant')
                .map((event) => String(event.content ?? ''))
                .join('');
            expect(assistantText).toContain('A');
            expect(assistantText.includes('SHOULD_NOT_APPEAR')).toBe(false);
            const completed = events.find((event) => event.type === 'complete') as Record<string, unknown> | undefined;
            expect(completed?.finishReason).toBe('assistant_text_settled_idle_window');
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
            if (typeof previousPostAssistantIdle === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_IDLE_COMPLETE_MS = previousPostAssistantIdle;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_IDLE_COMPLETE_MS;
            }
            if (typeof previousPostAssistantMax === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = previousPostAssistantMax;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
            }
        }
    });

    test('chat-mode max duration does not truncate when stream keeps making progress', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousChatTurnBudget = process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS;
        const previousChatStreamMax = process.env.COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS;
        const previousPostAssistantMax = process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS = '120';
            process.env.COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS = '120';
            process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = '10000';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* steadySlowStream() {
                    yield { type: 'text-delta', payload: { text: 'A' } };
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    yield { type: 'text-delta', payload: { text: 'B' } };
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    yield { type: 'text-delta', payload: { text: 'C' } };
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    yield { type: 'text-delta', payload: { text: 'D' } };
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    yield { type: 'text-delta', payload: { text: 'E' } };
                }
                return {
                    runId: 'run-phase3-max-duration-refresh',
                    fullStream: steadySlowStream(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'max duration refresh',
                'thread-max-duration-refresh',
                'employee-max-duration-refresh',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-max-duration-refresh');
            const textDeltas = events
                .filter((event) => event.type === 'text_delta')
                .map((event) => String(event.content ?? ''));
            expect(textDeltas.join('')).toContain('ABCDE');
            const completed = events.find((event) => event.type === 'complete') as Record<string, unknown> | undefined;
            expect(completed?.finishReason).not.toBe('stream_max_duration_after_text');
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
            if (typeof previousChatTurnBudget === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS = previousChatTurnBudget;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS;
            }
            if (typeof previousChatStreamMax === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS = previousChatStreamMax;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_STREAM_MAX_DURATION_MS;
            }
            if (typeof previousPostAssistantMax === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = previousPostAssistantMax;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
            }
        }
    });

    test('chat-mode hard max window truncates prolonged progress loops', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;
        const previousPostAssistantMax = process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
        const previousPostAssistantHardMax = process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_HARD_MAX_MS;
        const events: Array<Record<string, unknown>> = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';
            process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = '10000';
            process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_HARD_MAX_MS = '120';
            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                async function* longLoopingStream() {
                    const chunks = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
                    for (const chunk of chunks) {
                        yield { type: 'text-delta', payload: { text: chunk } };
                        await new Promise((resolve) => setTimeout(resolve, 45));
                    }
                }
                return {
                    runId: 'run-phase3-hard-max-window',
                    fullStream: longLoopingStream(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            const result = await handleUserMessage(
                'hard max window',
                'thread-hard-max-window',
                'employee-hard-max-window',
                (event) => events.push(event as Record<string, unknown>),
                {
                    forcePostAssistantCompletion: true,
                },
            );

            expect(result.runId).toBe('run-phase3-hard-max-window');
            const textDeltas = events
                .filter((event) => event.type === 'text_delta')
                .map((event) => String(event.content ?? ''));
            expect(textDeltas.join('').length).toBeGreaterThan(0);
            const completed = events.find((event) => event.type === 'complete') as Record<string, unknown> | undefined;
            expect(completed?.finishReason).toBe('assistant_text_hard_max_window');
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
            if (typeof previousPostAssistantMax === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS = previousPostAssistantMax;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_MAX_MS;
            }
            if (typeof previousPostAssistantHardMax === 'string') {
                process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_HARD_MAX_MS = previousPostAssistantHardMax;
            } else {
                delete process.env.COWORKANY_MASTRA_CHAT_POST_ASSISTANT_HARD_MAX_MS;
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
                        yield {
                            type: 'text-delta',
                            payload: { text: 'approval ready' },
                        };
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
                        yield {
                            type: 'text-delta',
                            payload: { text: 'approval done' },
                        };
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

    test('handleApprovalResponse falls back to latest cached task run when requested run snapshot is missing', async () => {
        const originalStream = supervisor.stream.bind(supervisor);
        const originalApprove = supervisor.approveToolCall.bind(supervisor);
        const previousModel = process.env.COWORKANY_MODEL;
        const previousAnthropic = process.env.ANTHROPIC_API_KEY;

        const streamRunIds = ['run-context-older', 'run-context-latest'];
        let streamInvocation = 0;
        const approveAttempts: string[] = [];
        const emittedEvents: Record<string, unknown>[] = [];

        try {
            process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
            process.env.ANTHROPIC_API_KEY = 'test-key';

            (supervisor as unknown as { stream: typeof supervisor.stream }).stream = (async () => {
                const runId = streamRunIds[Math.min(streamInvocation, streamRunIds.length - 1)];
                streamInvocation += 1;
                return {
                    runId,
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: `seed:${runId}` },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.stream>>;
            }) as typeof supervisor.stream;

            (supervisor as unknown as { approveToolCall: typeof supervisor.approveToolCall }).approveToolCall = (async (
                options: Record<string, unknown>,
            ) => {
                const approvalRunId = String(options.runId ?? '');
                approveAttempts.push(approvalRunId);
                if (approvalRunId === 'missing-run-id') {
                    throw new Error('No snapshot found for this workflow run: agentic-loop missing-run-id');
                }
                if (approvalRunId !== 'run-context-latest') {
                    throw new Error(`unexpected approval run id: ${approvalRunId}`);
                }
                return {
                    runId: approvalRunId,
                    fullStream: (async function* () {
                        yield {
                            type: 'text-delta',
                            payload: { text: 'approval resumed from fallback' },
                        };
                    })(),
                } as unknown as Awaited<ReturnType<typeof supervisor.approveToolCall>>;
            }) as typeof supervisor.approveToolCall;

            await handleUserMessage(
                'seed older',
                'thread-fallback',
                'employee-fallback',
                () => undefined,
                {
                    taskId: 'task-fallback',
                    workspacePath: '/tmp/fallback',
                },
            );
            await handleUserMessage(
                'seed latest',
                'thread-fallback',
                'employee-fallback',
                () => undefined,
                {
                    taskId: 'task-fallback',
                    workspacePath: '/tmp/fallback',
                },
            );

            await handleApprovalResponse(
                'missing-run-id',
                'tool-call-fallback',
                true,
                (event) => emittedEvents.push(event as Record<string, unknown>),
                {
                    taskId: 'task-fallback',
                },
            );

            expect(approveAttempts).toEqual(['missing-run-id', 'run-context-latest']);
            expect(
                emittedEvents.some(
                    (event) => event.type === 'text_delta' && String(event.content ?? '').includes('approval resumed from fallback'),
                ),
            ).toBe(true);
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
