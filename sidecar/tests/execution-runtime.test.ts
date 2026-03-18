import { describe, expect, test } from 'bun:test';
import {
    continuePreparedAgentFlow,
    executePreparedTaskFlow,
    type ExecutionRuntimeDeps,
} from '../src/execution/runtime';
import { ExecutionResultReporter } from '../src/execution/resultReporter';
import { ExecutionSession } from '../src/execution/session';

function makePreparedWorkRequest() {
    return {
        frozenWorkRequest: {
            id: 'wr-1',
            schemaVersion: 1,
            mode: 'immediate_task',
            sourceText: 'build feature',
            workspacePath: '/tmp/workspace',
            tasks: [{
                id: 'task-1',
                title: 'Build feature',
                objective: 'Build feature',
                constraints: [],
                acceptanceCriteria: [],
                dependencies: [],
                preferredSkills: ['task-orchestrator'],
                preferredTools: [],
            }],
            clarification: {
                required: false,
                questions: [],
                missingFields: [],
                canDefault: true,
                assumptions: [],
            },
            presentation: {
                uiFormat: 'chat_message',
                ttsEnabled: false,
                ttsMode: 'summary',
                ttsMaxChars: 500,
                language: 'en',
            },
            createdAt: new Date().toISOString(),
            frozenAt: new Date().toISOString(),
        },
        executionPlan: {
            workRequestId: 'wr-1',
            runMode: 'single',
            steps: [],
        },
        executionQuery: 'Build feature',
        preferredSkillIds: ['task-orchestrator'],
        workRequestExecutionPrompt: 'Frozen Work Request',
    } as any;
}

function makeDeps(overrides: Partial<ExecutionRuntimeDeps> = {}): ExecutionRuntimeDeps {
    return {
        shouldRunAutonomously: () => false,
        prepareAutonomousProvider: () => undefined,
        getAutonomousAgent: () => ({
            startTask: async () => ({
                createdAt: new Date().toISOString(),
                summary: 'autonomous summary',
                decomposedTasks: [{ status: 'completed' }],
                verificationResult: { goalMet: true },
            }),
        }),
        tryDeterministicResearchArtifactFallback: async () => null,
        tryPptGeneratorSkillFastPath: async () => null,
        getTriggeredSkillIds: () => [],
        mergeSkillIds: (...groups) => groups.flat().filter(Boolean) as string[],
        buildSkillSystemPrompt: () => ({ skills: 'skill prompt' }),
        mergeSystemPrompt: (base, extra) => {
            const baseText = typeof base === 'string' ? base : base?.skills;
            return [baseText, extra].filter(Boolean).join('\n\n');
        },
        ensureToolpacksRegistered: async () => undefined,
        getToolsForTask: () => [],
        buildProviderConfig: () => ({}),
        runAgentLoop: async () => ({
            artifactsCreated: ['/tmp/out.html'],
            toolsUsed: ['write_to_file'],
        }),
        session: new ExecutionSession({
            taskId: 'task-test',
            conversationReader: {
                buildConversationText: () => 'conversation text',
                getLatestAssistantResponseText: () => 'final assistant text',
            },
        }),
        reporter: new ExecutionResultReporter({
            onFinished: () => undefined,
            onFailed: () => undefined,
            onStatus: () => undefined,
            onArtifactTelemetry: () => undefined,
        }),
        evaluateArtifactContract: () => ({
            passed: true,
            failed: [],
        }),
        detectDegradedOutputs: () => ({
            hasDegradedOutput: false,
            degradedArtifacts: [],
        }),
        buildArtifactTelemetry: () => ({}),
        reduceWorkResult: ({ canonicalResult, artifacts }) => ({
            canonicalResult,
            uiSummary: 'reduced summary',
            ttsSummary: 'reduced summary',
            artifacts: artifacts ?? [],
        }),
        markWorkRequestExecutionCompleted: () => undefined,
        markWorkRequestExecutionFailed: () => undefined,
        quickLearnFromError: async () => ({ learned: true }),
        ...overrides,
    };
}

describe('execution runtime', () => {
    test('executePreparedTaskFlow chooses autonomous execution when allowed and no explicit skills are selected', async () => {
        let autonomousConfigured = false;
        let agentLoopCalled = false;
        let emittedSummary = '';

        const result = await executePreparedTaskFlow({
            taskId: 'task-1',
            userQuery: 'research and plan this feature',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makePreparedWorkRequest(),
            allowAutonomousFallback: true,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            shouldRunAutonomously: () => true,
            prepareAutonomousProvider: () => {
                autonomousConfigured = true;
            },
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            reporter: new ExecutionResultReporter({
                onFinished: ({ summary }) => {
                    emittedSummary = summary;
                },
                onFailed: () => undefined,
            }),
        }));

        expect(autonomousConfigured).toBe(true);
        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(emittedSummary).toBe('autonomous summary');
    });

    test('continuePreparedAgentFlow runs agent execution and emits finished status after successful reduction', async () => {
        const statuses: string[] = [];
        const summaries: string[] = [];
        let ensuredToolpacks = false;

        const result = await continuePreparedAgentFlow({
            taskId: 'task-2',
            userMessage: 'continue with the implementation',
            workspacePath: '/tmp/workspace',
            config: { enabledToolpacks: ['github-server'] },
            preparedWorkRequest: makePreparedWorkRequest(),
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            explicitSkillIds: ['typescript-lsp'],
        }, makeDeps({
            ensureToolpacksRegistered: async () => {
                ensuredToolpacks = true;
            },
            reporter: new ExecutionResultReporter({
                onFinished: ({ summary }) => {
                    summaries.push(summary);
                },
                onFailed: () => undefined,
                onStatus: ({ status }) => {
                    statuses.push(status);
                },
            }),
        }));

        expect(ensuredToolpacks).toBe(true);
        expect(statuses).toContain('finished');
        expect(summaries).toContain('reduced summary');
        expect(result.success).toBe(true);
        expect(result.artifactsCreated).toEqual(['/tmp/out.html']);
    });

    test('executePreparedTaskFlow falls back to agent loop when autonomous execution makes no progress', async () => {
        let agentLoopCalled = false;

        const result = await executePreparedTaskFlow({
            taskId: 'task-3',
            userQuery: 'research this repo and implement the missing piece',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makePreparedWorkRequest(),
            allowAutonomousFallback: true,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            session: new ExecutionSession({
                taskId: 'task-3',
                conversationReader: {
                    buildConversationText: () => 'conversation text',
                    getLatestAssistantResponseText: () => 'final assistant text',
                },
            }),
            shouldRunAutonomously: () => true,
            getAutonomousAgent: () => ({
                startTask: async () => ({
                    createdAt: new Date().toISOString(),
                    summary: 'no progress',
                    decomposedTasks: [{ status: 'failed' }],
                    verificationResult: { goalMet: false },
                }),
            }),
            tryDeterministicResearchArtifactFallback: async () => null,
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return {
                    artifactsCreated: ['/tmp/fallback.html'],
                    toolsUsed: ['write_to_file'],
                };
            },
            reduceWorkResult: ({ canonicalResult, artifacts }) => ({
                canonicalResult,
                uiSummary: 'fallback reduction',
                ttsSummary: 'fallback reduction',
                artifacts: artifacts ?? [],
            }),
        }));

        expect(agentLoopCalled).toBe(true);
        expect(result.success).toBe(true);
        expect(result.summary).toBe('fallback reduction');
        expect(result.artifactsCreated).toEqual(['/tmp/fallback.html']);
    });

    test('continuePreparedAgentFlow accepts user-confirmed degraded artifacts without failing the task', async () => {
        const finishedSummaries: string[] = [];
        const failurePayloads: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-4',
            userMessage: 'CONFIRM_DEGRADE_TO_MD',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makePreparedWorkRequest(),
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            session: new ExecutionSession({
                taskId: 'task-4',
                conversationReader: {
                    buildConversationText: () => 'conversation text',
                    getLatestAssistantResponseText: () => 'final assistant text',
                },
                initialArtifacts: ['/tmp/report.md'],
            }),
            runAgentLoop: async () => ({
                artifactsCreated: ['/tmp/report.md'],
                toolsUsed: ['write_to_file'],
            }),
            evaluateArtifactContract: () => ({
                passed: false,
                failed: [{ description: 'expected pptx output', reason: 'generated markdown only' }],
            }),
            detectDegradedOutputs: () => ({
                hasDegradedOutput: true,
                degradedArtifacts: ['/tmp/report.md'],
            }),
            reporter: new ExecutionResultReporter({
                onFinished: ({ summary }) => {
                    finishedSummaries.push(summary);
                },
                onFailed: (payload) => {
                    failurePayloads.push(payload);
                },
            }),
        }));

        expect(result.success).toBe(true);
        expect(result.summary).toContain('user-approved degraded output');
        expect(result.artifactsCreated).toEqual(['/tmp/report.md']);
        expect(finishedSummaries[0]).toContain('/tmp/report.md');
        expect(failurePayloads).toHaveLength(0);
    });

    test('continuePreparedAgentFlow merges user directives into system prompt', async () => {
        let capturedSystemPrompt: string | { skills: string } | undefined;

        await continuePreparedAgentFlow({
            taskId: 'task-5',
            userMessage: 'implement this without any',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makePreparedWorkRequest(),
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            getDirectivePromptAdditions: () => '## User Directives\n- [No Any] Do not use any.',
            runAgentLoop: async (_taskId, _conversation, options) => {
                capturedSystemPrompt = options.systemPrompt;
                return {
                    artifactsCreated: [],
                    toolsUsed: [],
                };
            },
        }));

        const promptText = typeof capturedSystemPrompt === 'string'
            ? capturedSystemPrompt
            : capturedSystemPrompt?.skills;
        expect(promptText).toContain('## User Directives');
        expect(promptText).toContain('Do not use any.');
    });
});
