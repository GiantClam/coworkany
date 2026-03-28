import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    continuePreparedAgentFlow,
    executePreparedTaskFlow,
    type ExecutionRuntimeDeps,
} from '../src/execution/runtime';
import { TaskCancelledError } from '../src/execution/taskCancellationRegistry';
import { ExecutionResultReporter } from '../src/execution/resultReporter';
import { ExecutionSession } from '../src/execution/session';
import { SkillStore } from '../src/storage/skillStore';
import { WorkspaceStore } from '../src/storage/workspaceStore';
import { createAppManagementTools } from '../src/tools/appManagement';

const tempPaths: string[] = [];

afterEach(() => {
    while (tempPaths.length > 0) {
        const target = tempPaths.pop();
        if (target) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }
});

function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempPaths.push(dir);
    return dir;
}

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
        executeTool: async () => ({}),
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
        markWorkRequestExecutionStarted: () => undefined,
        markWorkRequestExecutionCompleted: () => undefined,
        refreezePreparedWorkRequestForResearch: async ({ prepared }) => prepared,
        emitContractReopened: () => undefined,
        emitPreparedWorkRequestRefrozen: () => ({ blocked: false }),
        emitPlanUpdated: () => undefined,
        activatePreparedWorkRequest: () => undefined,
        clearPreparedWorkRequest: () => undefined,
        markWorkRequestExecutionFailed: () => undefined,
        quickLearnFromError: async () => ({ learned: true }),
        ...overrides,
    };
}

function makeLocalPreparedWorkRequest(workflowId: string) {
    const intentByWorkflow: Record<string, 'inspect_folder' | 'organize_files' | 'deduplicate_files' | 'delete_files'> = {
        'inspect-downloads-images': 'inspect_folder',
        'organize-downloads-images': 'organize_files',
        'deduplicate-downloads-images': 'deduplicate_files',
        'delete-host-folder-files': 'delete_files',
    };
    const preferredToolsByWorkflow: Record<string, string[]> = {
        'inspect-downloads-images': ['list_dir'],
        'organize-downloads-images': ['list_dir', 'create_directory', 'batch_move_files'],
        'deduplicate-downloads-images': ['list_dir', 'compute_file_hash', 'create_directory', 'batch_move_files'],
        'delete-host-folder-files': ['list_dir', 'delete_path', 'batch_delete_paths'],
    };
    const requiredAccessByWorkflow: Record<string, string[]> = {
        'inspect-downloads-images': ['read'],
        'organize-downloads-images': ['read', 'write', 'move'],
        'deduplicate-downloads-images': ['read', 'write', 'move'],
        'delete-host-folder-files': ['read', 'delete'],
    };

    const prepared = makePreparedWorkRequest();
    prepared.frozenWorkRequest.sourceText = '整理 Downloads 文件夹下的图片文件';
    prepared.frozenWorkRequest.tasks[0].preferredTools = preferredToolsByWorkflow[workflowId] ?? [];
    prepared.frozenWorkRequest.tasks[0].preferredWorkflow = workflowId;
    prepared.frozenWorkRequest.tasks[0].resolvedTargets = [{
        kind: 'well_known_folder',
        folderId: 'downloads',
        sourcePhrase: 'Downloads',
        resolvedPath: '/Users/tester/Downloads',
        os: 'macos',
        confidence: 0.98,
    }];
    prepared.frozenWorkRequest.tasks[0].localPlanHint = {
        intent: intentByWorkflow[workflowId] ?? 'organize_files',
        targetFolder: prepared.frozenWorkRequest.tasks[0].resolvedTargets[0],
        fileKinds: ['images'],
        preferredTools: preferredToolsByWorkflow[workflowId] ?? [],
        preferredWorkflow: workflowId,
        requiredAccess: requiredAccessByWorkflow[workflowId] ?? ['read', 'write', 'move'],
        traversalScope: 'top_level',
        requiresHostAccessGrant: true,
    };
    prepared.executionQuery = '整理 Downloads 文件夹下的图片文件';
    return prepared;
}

function makeExplicitPathPreparedWorkRequest(input: {
    workflowId: string;
    intent: 'inspect_folder' | 'organize_files' | 'delete_files' | 'deduplicate_files';
    sourceText: string;
    targetPath: string;
    fileKinds: string[];
    traversalScope?: 'top_level' | 'recursive';
}) {
    const prepared = makePreparedWorkRequest();
    prepared.frozenWorkRequest.sourceText = input.sourceText;
    prepared.frozenWorkRequest.tasks[0].preferredTools = input.intent === 'inspect_folder'
        ? ['list_dir']
        : input.intent === 'delete_files'
            ? ['list_dir', 'delete_path', 'batch_delete_paths']
            : input.intent === 'deduplicate_files'
                ? ['list_dir', 'compute_file_hash', 'create_directory', 'batch_move_files']
                : ['list_dir', 'create_directory', 'batch_move_files'];
    prepared.frozenWorkRequest.tasks[0].preferredWorkflow = input.workflowId;
    prepared.frozenWorkRequest.tasks[0].resolvedTargets = [{
        kind: 'explicit_path',
        sourcePhrase: input.targetPath,
        resolvedPath: input.targetPath,
        os: 'macos',
        confidence: 0.99,
    }];
    prepared.frozenWorkRequest.tasks[0].localPlanHint = {
        intent: input.intent,
        targetFolder: prepared.frozenWorkRequest.tasks[0].resolvedTargets[0],
        fileKinds: input.fileKinds,
        preferredTools: prepared.frozenWorkRequest.tasks[0].preferredTools,
        preferredWorkflow: input.workflowId,
        requiredAccess: input.intent === 'inspect_folder'
            ? ['read']
            : input.intent === 'delete_files'
                ? ['read', 'delete']
                : ['read', 'write', 'move'],
        traversalScope: input.traversalScope ?? 'top_level',
        requiresHostAccessGrant: true,
    };
    prepared.executionQuery = input.sourceText;
    return prepared;
}

describe('execution runtime', () => {
    test('executePreparedTaskFlow reports cancelled tasks with CANCELLED error code', async () => {
        const failures: Array<{ error: string; errorCode: string }> = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-cancelled',
            userQuery: 'cancel me',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makePreparedWorkRequest(),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                throw new TaskCancelledError('task-cancelled', 'Task cancelled by user');
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => failures.push({
                    error: payload.error,
                    errorCode: payload.errorCode,
                }),
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(failures[0]?.errorCode).toBe('CANCELLED');
        expect(failures[0]?.error).toBe('Task cancelled by user');
    });

    test('continuePreparedAgentFlow stops cleanly when capability replay is blocked by readiness checks', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.capabilityPlan = {
            missingCapability: 'new_runtime_tool_needed',
            learningRequired: true,
            canProceedWithoutLearning: false,
            learningScope: 'runtime_tool',
            replayStrategy: 'resume_from_checkpoint',
            sideEffectRisk: 'write_external',
            userAssistRequired: false,
            userAssistReason: 'none',
            boundedLearningBudget: {
                complexityTier: 'moderate',
                maxRounds: 2,
                maxResearchTimeMs: 60000,
                maxValidationAttempts: 2,
            },
            reasons: ['Need generated capability.'],
        };

        let loopCalls = 0;
        const failures: Array<{ error: string; errorCode: string }> = [];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-capability-blocked',
            userMessage: 'publish now',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            acquireCapabilityForTask: async () => ({
                outcome: 'blocked',
                summary: 'Reconnect the live browser session before replay.',
                blockerType: 'external_auth',
            }),
            runAgentLoop: async () => {
                loopCalls += 1;
                return {
                    artifactsCreated: ['/tmp/out.html'],
                    toolsUsed: ['write_to_file'],
                };
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => failures.push({
                    error: payload.error,
                    errorCode: payload.errorCode || '',
                }),
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }) as any);

        expect(loopCalls).toBe(0);
        expect(result.success).toBe(false);
        expect(result.summary).toBe('Reconnect the live browser session before replay.');
        expect(failures).toHaveLength(0);
    });

    test('continuePreparedAgentFlow continues after capability acquisition succeeds', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.capabilityPlan = {
            missingCapability: 'new_runtime_tool_needed',
            learningRequired: true,
            canProceedWithoutLearning: false,
            learningScope: 'runtime_tool',
            replayStrategy: 'resume_from_checkpoint',
            sideEffectRisk: 'read_only',
            userAssistRequired: false,
            userAssistReason: 'none',
            boundedLearningBudget: {
                complexityTier: 'moderate',
                maxRounds: 2,
                maxResearchTimeMs: 60000,
                maxValidationAttempts: 2,
            },
            reasons: ['Missing runtime capability.'],
        };

        let acquisitionCalls = 0;
        let loopCalls = 0;

        const result = await continuePreparedAgentFlow({
            taskId: 'task-capability-success',
            userMessage: 'Do the task',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            acquireCapabilityForTask: async () => {
                acquisitionCalls += 1;
                return {
                    outcome: 'learned',
                    summary: 'Acquired capability.',
                };
            },
            runAgentLoop: async () => {
                loopCalls += 1;
                return {
                    artifactsCreated: ['/tmp/out.html'],
                    toolsUsed: ['write_to_file'],
                };
            },
        }));

        expect(acquisitionCalls).toBe(1);
        expect(loopCalls).toBe(1);
        expect(prepared.frozenWorkRequest.capabilityPlan.learningRequired).toBe(false);
        expect(result.success).toBe(true);
    });

    test('continuePreparedAgentFlow stops before the agent loop when capability acquisition requires review', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.capabilityPlan = {
            missingCapability: 'new_runtime_tool_needed',
            learningRequired: true,
            canProceedWithoutLearning: false,
            learningScope: 'runtime_tool',
            replayStrategy: 'resume_from_checkpoint',
            sideEffectRisk: 'write_external',
            userAssistRequired: false,
            userAssistReason: 'none',
            boundedLearningBudget: {
                complexityTier: 'complex',
                maxRounds: 4,
                maxResearchTimeMs: 180000,
                maxValidationAttempts: 3,
            },
            reasons: ['Missing external publish capability.'],
        };

        let loopCalls = 0;

        const result = await continuePreparedAgentFlow({
            taskId: 'task-capability-review',
            userMessage: 'Publish this',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            acquireCapabilityForTask: async () => ({
                outcome: 'review_required',
                summary: 'Generated external-write capability is ready for review before live use.',
            }),
            runAgentLoop: async () => {
                loopCalls += 1;
                return {
                    artifactsCreated: ['/tmp/out.html'],
                    toolsUsed: ['write_to_file'],
                };
            },
        }));

        expect(loopCalls).toBe(0);
        expect(result.success).toBe(false);
        expect(result.error).toContain('ready for review');
    });

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

    test('executePreparedTaskFlow bypasses autonomous execution for web-research objectives', async () => {
        let autonomousConfigured = false;
        let agentLoopCalled = false;
        let autonomousStartCalled = false;

        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '检索 openai 为什么关闭 sora，深度分析后回复我';
        prepared.frozenWorkRequest.sourceText = prepared.executionQuery;

        const result = await executePreparedTaskFlow({
            taskId: 'task-web-research-bypass-autonomous',
            userQuery: prepared.executionQuery,
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
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
            getAutonomousAgent: () => ({
                startTask: async () => {
                    autonomousStartCalled = true;
                    return {
                        createdAt: new Date().toISOString(),
                        summary: 'autonomous summary',
                        decomposedTasks: [{ status: 'completed' }],
                        verificationResult: { goalMet: true },
                    };
                },
            }),
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: ['search_web'] };
            },
            session: new ExecutionSession({
                taskId: 'task-web-research-bypass-autonomous',
                conversationReader: {
                    buildConversationText: () => 'https://example.com/evidence',
                    getLatestAssistantResponseText: () => '结论如下。https://example.com/evidence',
                },
            }),
        }));

        expect(autonomousConfigured).toBe(false);
        expect(autonomousStartCalled).toBe(false);
        expect(agentLoopCalled).toBe(true);
        expect(result.success).toBe(true);
    });

    test('executePreparedTaskFlow strips trailing follow-up suggestions from autonomous summaries', async () => {
        let emittedSummary = '';

        const result = await executePreparedTaskFlow({
            taskId: 'task-autonomous-summary-strip',
            userQuery: '整理一下这个主题',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makePreparedWorkRequest(),
            allowAutonomousFallback: true,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            shouldRunAutonomously: () => true,
            getAutonomousAgent: () => ({
                startTask: async () => ({
                    createdAt: new Date().toISOString(),
                    summary: '结论已完成。\n\n如果你愿意，我可以继续跟踪后续变化。',
                    decomposedTasks: [{ status: 'completed' }],
                    verificationResult: { goalMet: true },
                }),
            }),
            reporter: new ExecutionResultReporter({
                onFinished: ({ summary }) => {
                    emittedSummary = summary;
                },
                onFailed: () => undefined,
            }),
        }));

        expect(result.success).toBe(true);
        expect(result.summary).toBe('结论已完成。');
        expect(emittedSummary).toBe('结论已完成。');
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

    test('continuePreparedAgentFlow fails when explicit audit request lacks grounded inspection evidence', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        let markedFailed = false;
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '用 skill-vetter 审核所有已安装技能';
        prepared.frozenWorkRequest.sourceText = '用 skill-vetter 审核所有已安装技能';

        const result = await continuePreparedAgentFlow({
            taskId: 'task-skill-vetter-drift',
            userMessage: '同意',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['list_coworkany_skills'],
            }),
            assessExecutionProtocol: async () => ({
                asksForAdditionalUserAction: false,
                requestedEvidence: 'grounded',
                deliveredEvidence: 'metadata',
                confidence: 0.92,
            }),
            session: new ExecutionSession({
                taskId: 'task-skill-vetter-drift',
                conversationReader: {
                    buildConversationText: () => '仅基于元数据完成审核',
                    getLatestAssistantResponseText: () => '已完成审核',
                },
            }),
            markWorkRequestExecutionFailed: () => {
                markedFailed = true;
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('Execution protocol unmet');
        expect(markedFailed).toBe(true);
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
        expect(failures[0]?.suggestion).toContain('grounded inspection steps');
    });

    test('continuePreparedAgentFlow fails when final response asks for unplanned user approval', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();

        const result = await continuePreparedAgentFlow({
            taskId: 'task-unplanned-user-action',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['run_command'],
            }),
            assessExecutionProtocol: async () => ({
                asksForAdditionalUserAction: true,
                requestedEvidence: 'standard',
                deliveredEvidence: 'grounded',
                confidence: 0.95,
            }),
            session: new ExecutionSession({
                taskId: 'task-unplanned-user-action',
                conversationReader: {
                    buildConversationText: () => '当前仅做流程确认，请回复“执行”。',
                    getLatestAssistantResponseText: () => '请回复“执行”。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('requested additional user approval/execution');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
        expect(failures[0]?.suggestion).toContain('Only request user action');
    });

    test('continuePreparedAgentFlow fails when final response asks unplanned clarification questions', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();

        const result = await continuePreparedAgentFlow({
            taskId: 'task-unplanned-clarification',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-unplanned-clarification',
                conversationReader: {
                    buildConversationText: () =>
                        '你说的 MiniMax 是指国内 AI 公司“MiniMax（稀宇科技）”吗？小红书发布是要直接发正式内容，还是先给你看草稿再发？',
                    getLatestAssistantResponseText: () =>
                        '你说的 MiniMax 是指国内 AI 公司“MiniMax（稀宇科技）”吗？小红书发布是要直接发正式内容，还是先给你看草稿再发？',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('requested additional user approval/execution');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow falls back to contract tool hints when protocol assessment is unavailable', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '请审计并核查当前实现，给出证据';
        prepared.frozenWorkRequest.sourceText = '请审计并核查当前实现，给出证据';
        prepared.frozenWorkRequest.tasks[0].objective = '请审计并核查当前实现，给出证据';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['view_file', 'run_command'];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-fallback',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['list_coworkany_skills'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-fallback',
                conversationReader: {
                    buildConversationText: () => '只做了技能列表元数据检查',
                    getLatestAssistantResponseText: () => '已完成',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('Execution protocol unmet');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow accepts publish tasks when browser evidence exists and protocol assessment is unavailable', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '将分析结果发布到 X 上';
        prepared.frozenWorkRequest.sourceText = '将分析结果发布到 X 上';
        prepared.frozenWorkRequest.tasks[0].objective = '将分析结果发布到 X 上';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['browser_connect', 'browser_get_content', 'browser_click'];
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'req-browser-interaction',
            kind: 'tool_evidence',
            capability: 'browser_interaction',
            required: true,
            reason: 'Publish workflow must be executed through browser interaction.',
        }];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-fallback-publish',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['browser_connect', 'browser_navigate', 'browser_fill', 'browser_click'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-fallback-publish',
                conversationReader: {
                    buildConversationText: () => '已完成发布',
                    getLatestAssistantResponseText: () => '已完成发布',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(true);
        expect(failures.length).toBe(0);
    });

    test('continuePreparedAgentFlow accepts direct system shell actions when run_command evidence exists', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '早上3点关机';
        prepared.frozenWorkRequest.sourceText = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].objective = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['run_command'];
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'req-shell-execution',
            kind: 'tool_evidence',
            capability: 'shell_execution',
            required: true,
            reason: 'Direct system actions must be executed through a real shell command.',
        }];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-shell-evidence',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['run_command'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-shell-evidence',
                conversationReader: {
                    buildConversationText: () => '已通过 shell 配置关机任务。',
                    getLatestAssistantResponseText: () => '已通过 shell 配置关机任务。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(true);
        expect(failures.length).toBe(0);
    });

    test('continuePreparedAgentFlow routes direct system shell actions through deterministic run_command execution', async () => {
        const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        let agentLoopCalled = false;
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '早上3点关机';
        prepared.frozenWorkRequest.sourceText = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].objective = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['run_command'];
        prepared.frozenWorkRequest.environmentContext = {
            platform: 'macos',
            arch: 'aarch64',
            appDir: '/tmp/app',
            appDataDir: '/tmp/app-data',
            shell: '/bin/zsh',
            python: { available: true, path: 'python3', source: 'system' },
            skillhub: { available: false, path: undefined, source: 'unknown' },
            managedServices: [],
        };

        const result = await continuePreparedAgentFlow({
            taskId: 'task-deterministic-shell-action',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            executeTool: async (_taskId, name, args) => {
                toolCalls.push({ name, args });
                return {
                    status: 'opened_in_terminal',
                    exit_code: 0,
                };
            },
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return {
                    artifactsCreated: [],
                    toolsUsed: ['think'],
                };
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]).toMatchObject({
            name: 'run_command',
            args: {
                command: 'sudo shutdown -h 03:00',
            },
        });
        expect(result.success).toBe(true);
        expect(result.summary).toContain('03:00');
        expect(result.toolsUsed).toEqual(['run_command']);
    });

    test('continuePreparedAgentFlow accepts darwin platform aliases for deterministic shell execution', async () => {
        const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        let agentLoopCalled = false;
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '早上3点关机';
        prepared.frozenWorkRequest.sourceText = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].objective = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['run_command'];
        prepared.frozenWorkRequest.environmentContext = {
            platform: 'darwin',
            arch: 'aarch64',
            appDir: '/tmp/app',
            appDataDir: '/tmp/app-data',
            shell: '/bin/zsh',
            python: { available: true, path: 'python3', source: 'system' },
            skillhub: { available: false, path: undefined, source: 'unknown' },
            managedServices: [],
        };

        const result = await continuePreparedAgentFlow({
            taskId: 'task-deterministic-shell-action-darwin',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            executeTool: async (_taskId, name, args) => {
                toolCalls.push({ name, args });
                return {
                    status: 'opened_in_terminal',
                    exit_code: 0,
                };
            },
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return {
                    artifactsCreated: [],
                    toolsUsed: ['think'],
                };
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]).toMatchObject({
            name: 'run_command',
            args: {
                command: 'sudo shutdown -h 03:00',
            },
        });
        expect(result.success).toBe(true);
        expect(result.toolsUsed).toEqual(['run_command']);
    });

    test('continuePreparedAgentFlow fails publish tasks without browser evidence when protocol assessment is unavailable', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '将分析结果发送到 X 上';
        prepared.frozenWorkRequest.sourceText = '将分析结果发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].objective = '将分析结果发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['browser_connect', 'browser_navigate', 'browser_click'];
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'req-browser-interaction',
            kind: 'tool_evidence',
            capability: 'browser_interaction',
            required: true,
            reason: 'Publish workflow must be executed through browser interaction.',
        }];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-fallback-publish-missing-browser',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['write_to_file'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-fallback-publish-missing-browser',
                conversationReader: {
                    buildConversationText: () => '我已经整理好文案，可以直接发在 X 上。',
                    getLatestAssistantResponseText: () => '我已经整理好文案，可以直接发在 X 上。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('required tool-evidence capability was not satisfied');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow fails direct system shell actions without run_command evidence', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '早上3点关机';
        prepared.frozenWorkRequest.sourceText = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].objective = '早上3点关机';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['run_command'];
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'req-shell-execution',
            kind: 'tool_evidence',
            capability: 'shell_execution',
            required: true,
            reason: 'Direct system actions must be executed through a real shell command.',
        }];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-shell-evidence-missing',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['think'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-shell-evidence-missing',
                conversationReader: {
                    buildConversationText: () => '可以使用 shutdown 命令。',
                    getLatestAssistantResponseText: () => '可以使用 shutdown 命令。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('required tool-evidence capability was not satisfied');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow prioritizes required browser capability checks before source-link checks', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.sourceText = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].objective = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['browser_connect', 'browser_navigate', 'browser_click', 'search_web'];
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'req-browser-interaction',
            kind: 'tool_evidence',
            capability: 'browser_interaction',
            required: true,
            reason: 'Publish workflow must be executed through browser interaction.',
        }];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-priority-capability-before-links',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-priority-capability-before-links',
                conversationReader: {
                    buildConversationText: () => '已检索到信息，但尚未执行发布动作。',
                    getLatestAssistantResponseText: () => '已检索到信息，但尚未执行发布动作。',
                },
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('required tool-evidence capability was not satisfied');
        expect(result.error).not.toContain('web-research task finished without source links');
    });

    test('continuePreparedAgentFlow enforces required capability when planned user action is non-blocking', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.sourceText = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].objective = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'req-browser-interaction',
            kind: 'tool_evidence',
            capability: 'browser_interaction',
            required: true,
            reason: 'Publish workflow must be executed through browser interaction.',
        }];
        prepared.frozenWorkRequest.userActionsRequired = [{
            id: 'ua-external-auth',
            title: 'Prepare external auth',
            kind: 'external_auth',
            description: 'Please keep account login ready.',
            riskTier: 'high',
            executionPolicy: 'auto',
            blocking: false,
            questions: [],
            instructions: ['Keep auth ready.'],
        }];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-nonblocking-user-action',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-nonblocking-user-action',
                conversationReader: {
                    buildConversationText: () => '完成了检索。',
                    getLatestAssistantResponseText: () => '完成了检索。',
                },
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('required tool-evidence capability was not satisfied');
        expect(result.error).not.toContain('web-research task finished without source links');
    });

    test('continuePreparedAgentFlow retries execution-stage protocol violations without research refreeze', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.replanPolicy = {
            allowReturnToResearch: false,
            triggers: [],
        };
        prepared.executionPlan.steps = [
            { stepId: 'execution', kind: 'execution', title: 'Execute', description: 'Run task', status: 'running', dependencies: [] },
            { stepId: 'reduction', kind: 'reduction', title: 'Reduce', description: 'Reduce result', status: 'pending', dependencies: ['execution'] },
            { stepId: 'presentation', kind: 'presentation', title: 'Present', description: 'Present result', status: 'pending', dependencies: ['reduction'] },
        ];
        prepared.executionQuery = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.sourceText = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].objective = '检索行情并发送到 X 上';
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'req-browser-interaction',
            kind: 'tool_evidence',
            capability: 'browser_interaction',
            required: true,
            reason: 'Publish workflow must be executed through browser interaction.',
        }];

        let loopCount = 0;
        let refreezeCount = 0;
        let refrozenEventCount = 0;
        let preparedContractActive = false;
        const activeSnapshotsDuringLoop: boolean[] = [];
        const frozenRequestIdsDuringLoop: Array<string | undefined> = [];
        const reopenedPayloads: Array<{ trigger: string; nextStepId?: string }> = [];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-protocol-execution-retry-no-refreeze',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async (_taskId, _conversation, _options, _providerConfig, _tools, executionContext) => {
                activeSnapshotsDuringLoop.push(preparedContractActive);
                frozenRequestIdsDuringLoop.push(executionContext?.frozenWorkRequest?.id);
                loopCount += 1;
                if (loopCount === 1) {
                    return {
                        artifactsCreated: [],
                        toolsUsed: ['search_web'],
                    };
                }
                return {
                    artifactsCreated: [],
                    toolsUsed: ['browser_connect', 'browser_navigate', 'browser_fill', 'browser_click'],
                };
            },
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-protocol-execution-retry-no-refreeze',
                conversationReader: {
                    buildConversationText: () => (
                        loopCount <= 1
                            ? '完成了检索。'
                            : '已通过浏览器完成发布。来源：https://example.com/report'
                    ),
                    getLatestAssistantResponseText: () => (
                        loopCount <= 1
                            ? '完成了检索。'
                            : '已通过浏览器完成发布。来源：https://example.com/report'
                    ),
                },
            }),
            refreezePreparedWorkRequestForResearch: async ({ prepared: reopenedPrepared }) => {
                refreezeCount += 1;
                return reopenedPrepared;
            },
            emitPreparedWorkRequestRefrozen: () => {
                refrozenEventCount += 1;
                return { blocked: false };
            },
            emitContractReopened: (_taskId, payload) => {
                reopenedPayloads.push({
                    trigger: payload.trigger,
                    nextStepId: payload.nextStepId,
                });
            },
            activatePreparedWorkRequest: () => {
                preparedContractActive = true;
            },
            clearPreparedWorkRequest: () => {
                preparedContractActive = false;
            },
        }));

        expect(result.success).toBe(true);
        expect(loopCount).toBe(2);
        expect(refreezeCount).toBe(0);
        expect(refrozenEventCount).toBe(0);
        expect(reopenedPayloads).toHaveLength(1);
        expect(reopenedPayloads[0]?.trigger).toBe('contradictory_evidence');
        expect(reopenedPayloads[0]?.nextStepId).toBe('execution');
        expect(activeSnapshotsDuringLoop).toEqual([true, true]);
        expect(frozenRequestIdsDuringLoop).toEqual(['wr-1', 'wr-1']);
    });

    test('continuePreparedAgentFlow blocks user-action phrasing when protocol judge is unavailable', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();

        const result = await continuePreparedAgentFlow({
            taskId: 'task-user-action-fallback',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: [],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-user-action-fallback',
                conversationReader: {
                    buildConversationText: () => '如果你同意这个范围，我就继续执行。',
                    getLatestAssistantResponseText: () => '如果你同意这个范围，我就继续执行。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('requested additional user approval/execution');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow flags capability-refusal phrasing even when protocol judge is unavailable', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();

        const result = await continuePreparedAgentFlow({
            taskId: 'task-capability-refusal-fallback',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-capability-refusal-fallback',
                conversationReader: {
                    buildConversationText: () => '我无法直接替你在真实账号上发布内容。',
                    getLatestAssistantResponseText: () => '我无法直接替你在真实账号上发布内容。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('refused the core task objective');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow blocks optional follow-up prompts even when completion is already claimed', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();

        const result = await continuePreparedAgentFlow({
            taskId: 'task-user-action-optional-followup',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => ({
                asksForAdditionalUserAction: true,
                requestedEvidence: 'standard',
                deliveredEvidence: 'grounded',
                completionClaim: 'present',
                confidence: 0.9,
            }),
            session: new ExecutionSession({
                taskId: 'task-user-action-optional-followup',
                conversationReader: {
                    buildConversationText: () => '已完成本次分析。如果你愿意，我可以继续监控后续变化。',
                    getLatestAssistantResponseText: () => '已完成本次分析。如果你愿意，我可以继续监控后续变化。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('requested additional user approval/execution');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow appends source links for required web-research deliverables', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '检索 openai 为什么关闭 sora，深度分析后回复我';
        prepared.frozenWorkRequest.sourceText = prepared.executionQuery;
        prepared.frozenWorkRequest.researchQueries = [
            {
                id: 'rq-web-1',
                kind: 'domain_research',
                source: 'web',
                objective: 'Collect latest official and media evidence.',
                required: true,
                status: 'completed',
            },
        ];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-source-links-append',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-source-links-append',
                conversationReader: {
                    buildConversationText: () =>
                        'tool_result:\nhttps://www.cnn.com/2026/03/24/business/video/openai-sora-gold-live-032404pseg2-cnni-business-fast\nhttps://help.openai.com/en/articles/12461230-sora-app-and-sora-2-supported-countries',
                    getLatestAssistantResponseText: () => '结论：目前更准确的说法是 Sora app 形态调整，而非底层能力永久终止。',
                },
            }),
            reduceWorkResult: ({ canonicalResult, artifacts }) => ({
                canonicalResult,
                uiSummary: canonicalResult,
                ttsSummary: canonicalResult,
                artifacts: artifacts ?? [],
            }),
        }));

        expect(result.success).toBe(true);
        expect(result.summary).toContain('来源链接');
        expect(result.summary).toContain('https://www.cnn.com/2026/03/24/business/video/openai-sora-gold-live-032404pseg2-cnni-business-fast');
    });

    test('continuePreparedAgentFlow prefers canonical research evidence links over malformed conversation url fragments', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '生成一个 ppt，检索http://www.szlczn.cn/网站内容，生成介绍灵创智能公司和产品的 ppt';
        prepared.frozenWorkRequest.sourceText = prepared.executionQuery;
        prepared.frozenWorkRequest.tasks[0].objective = prepared.executionQuery;
        prepared.frozenWorkRequest.researchQueries = [
            {
                id: 'rq-web-url',
                kind: 'domain_research',
                source: 'web',
                objective: 'Read and extract the user-provided URL content before execution: http://www.szlczn.cn/',
                directUrls: ['http://www.szlczn.cn/'],
                required: false,
                status: 'completed',
            },
        ];
        prepared.frozenWorkRequest.researchEvidence = [
            {
                id: 're-url',
                kind: 'domain_research',
                source: 'web',
                summary: 'Fetched direct URL http://www.szlczn.cn/',
                confidence: 0.82,
                uri: 'http://www.szlczn.cn/',
                collectedAt: new Date().toISOString(),
            },
        ];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-source-links-canonical-url',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: ['/tmp/deck.pptx'],
                toolsUsed: ['write_to_file'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-source-links-canonical-url',
                conversationReader: {
                    buildConversationText: () =>
                        '用户请求：生成一个 ppt，检索http://www.szlczn.cn/网站内容，生成介绍灵创智能公司和产品的 ppt',
                    getLatestAssistantResponseText: () => '已生成介绍灵创智能公司和产品的 PPT 概要。',
                },
            }),
            reduceWorkResult: ({ canonicalResult, artifacts }) => ({
                canonicalResult,
                uiSummary: canonicalResult,
                ttsSummary: canonicalResult,
                artifacts: artifacts ?? [],
            }),
        }));

        expect(result.success).toBe(true);
        expect(result.summary).toContain('来源链接');
        expect(result.summary).toContain('http://www.szlczn.cn/');
        expect(result.summary).not.toContain('http://www.szlczn.cn/网站内容');
    });

    test('continuePreparedAgentFlow accepts xiaohongshu_post as browser publish evidence', async () => {
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '把这段内容发送到 xiaohongshu 上';
        prepared.frozenWorkRequest.sourceText = prepared.executionQuery;
        prepared.frozenWorkRequest.tasks[0].objective = prepared.executionQuery;
        prepared.frozenWorkRequest.publishIntent = {
            action: 'publish_social_post',
            platform: 'xiaohongshu',
            executionMode: 'direct_publish',
            requiresSideEffect: true,
        };
        prepared.frozenWorkRequest.tasks[0].executionRequirements = [{
            id: 'tool-evidence-browser',
            kind: 'tool_evidence',
            capability: 'browser_interaction',
            required: true,
            reason: 'Must publish via browser-backed tool evidence.',
        }];
        prepared.frozenWorkRequest.tasks[0].preferredTools = ['xiaohongshu_post'];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-xiaohongshu-evidence',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['xiaohongshu_post'],
            }),
            assessExecutionProtocol: async () => ({
                asksForAdditionalUserAction: false,
                objectiveRefusal: false,
                objectiveSatisfied: true,
                requestedEvidence: 'standard',
                deliveredEvidence: 'grounded',
                completionClaim: 'present',
                verificationEvidence: 'present',
                confidence: 0.94,
            }),
            session: new ExecutionSession({
                taskId: 'task-xiaohongshu-evidence',
                conversationReader: {
                    buildConversationText: () => '已完成小红书发布，并附上发布结果。',
                    getLatestAssistantResponseText: () => '已完成小红书发布，并附上发布结果。',
                },
            }),
        }));

        expect(result.success).toBe(true);
    });

    test('continuePreparedAgentFlow blocks scheduled stock-analysis output that asks for extra user confirmation', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.mode = 'scheduled_task';
        prepared.frozenWorkRequest.schedule = {
            executeAt: new Date().toISOString(),
        };
        prepared.executionQuery =
            '1 分钟之后，检索微信发布 clawbot 的消息，同时检索 openclaw 类的产品市场热度是否衰退，综合分析后，预测周一对腾讯股票的影响，给出买入建议和买入仓位';
        prepared.frozenWorkRequest.sourceText = prepared.executionQuery;

        const result = await continuePreparedAgentFlow({
            taskId: 'task-scheduled-stock-case',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => ({
                asksForAdditionalUserAction: true,
                requestedEvidence: 'standard',
                deliveredEvidence: 'grounded',
                completionClaim: 'present',
                confidence: 0.92,
            }),
            session: new ExecutionSession({
                taskId: 'task-scheduled-stock-case',
                conversationReader: {
                    buildConversationText: () =>
                        '已完成检索与情景分析。如果你同意，我可以继续做盘后追踪。',
                    getLatestAssistantResponseText: () =>
                        '已完成检索与情景分析。如果你同意，我可以继续做盘后追踪。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('requested additional user approval/execution');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow fails when final response refuses the core objective without blocker', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();

        const result = await continuePreparedAgentFlow({
            taskId: 'task-objective-refusal',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => ({
                asksForAdditionalUserAction: false,
                objectiveRefusal: true,
                requestedEvidence: 'standard',
                deliveredEvidence: 'grounded',
                completionClaim: 'absent',
                confidence: 0.91,
            }),
            session: new ExecutionSession({
                taskId: 'task-objective-refusal',
                conversationReader: {
                    buildConversationText: () => '我不能为你提供具体个股建议。',
                    getLatestAssistantResponseText: () => '我不能为你提供具体个股建议。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('refused the core task objective');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow fails when buy-price objective is not satisfied with explicit price evidence', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '根据上述信息，给我兖矿能源的买入价格';
        prepared.frozenWorkRequest.sourceText = prepared.executionQuery;
        prepared.frozenWorkRequest.tasks[0].objective = prepared.executionQuery;
        prepared.frozenWorkRequest.tasks[0].acceptanceCriteria = [
            '必须给出明确可执行的买入价格数值或价格区间，并标注货币单位。',
            '必须说明价格依据的时间锚点（例如交易日、时区、盘中或收盘时点）。',
        ];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-price-objective-unmet',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => ({
                asksForAdditionalUserAction: false,
                objectiveRefusal: false,
                objectiveSatisfied: false,
                objectiveGap: 'No explicit buy-price value and timestamp were provided.',
                requestedEvidence: 'standard',
                deliveredEvidence: 'grounded',
                completionClaim: 'present',
                confidence: 0.9,
            }),
            session: new ExecutionSession({
                taskId: 'task-price-objective-unmet',
                conversationReader: {
                    buildConversationText: () => '我不能给你“保证盈利”的精确买入价，但可以给你一个区间法。',
                    getLatestAssistantResponseText: () => '我不能给你“保证盈利”的精确买入价，但可以给你一个区间法。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('did not satisfy the frozen objective');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow deterministically blocks buy-price responses without price/time anchors', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '给我腾讯股票的买入价格';
        prepared.frozenWorkRequest.sourceText = prepared.executionQuery;
        prepared.frozenWorkRequest.tasks[0].objective = prepared.executionQuery;
        prepared.frozenWorkRequest.tasks[0].acceptanceCriteria = [
            '必须给出明确可执行的买入价格数值或价格区间，并标注货币单位。',
            '必须说明价格依据的时间锚点（例如交易日、时区、盘中或收盘时点）。',
        ];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-price-objective-deterministic',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['search_web'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-price-objective-deterministic',
                conversationReader: {
                    buildConversationText: () => '建议分批买入，但我不能给具体买入价。',
                    getLatestAssistantResponseText: () => '建议分批买入，但我不能给具体买入价。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.error).toContain('buy-price objective requires explicit price values');
        expect(failures[0]?.errorCode).toBe('EXECUTION_PROTOCOL_UNMET');
    });

    test('continuePreparedAgentFlow does not flag stale approval phrases from conversation history', async () => {
        const failures: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const prepared = makePreparedWorkRequest();

        const result = await continuePreparedAgentFlow({
            taskId: 'task-stale-approval-history',
            userMessage: '继续',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['write_to_file'],
            }),
            assessExecutionProtocol: async () => null,
            session: new ExecutionSession({
                taskId: 'task-stale-approval-history',
                conversationReader: {
                    buildConversationText: () => '历史消息: 如果你同意这个范围，我就继续执行。',
                    getLatestAssistantResponseText: () => '已完成执行并交付结果。',
                },
            }),
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failures.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(true);
        expect(failures).toHaveLength(0);
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

    test('continuePreparedAgentFlow backfills planned artifact evidence from disk when tool output omits file paths', async () => {
        const workspaceDir = makeTempDir('coworkany-runtime-artifact-evidence-');
        const artifactRelativePath = 'reports/generated.md';
        const artifactAbsolutePath = path.join(workspaceDir, artifactRelativePath);
        fs.mkdirSync(path.dirname(artifactAbsolutePath), { recursive: true });
        fs.writeFileSync(artifactAbsolutePath, '# generated report\n');

        let observedEvidenceFiles: string[] = [];
        const result = await continuePreparedAgentFlow({
            taskId: 'task-artifact-evidence-backfill',
            userMessage: 'continue',
            workspacePath: workspaceDir,
            preparedWorkRequest: makePreparedWorkRequest(),
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {
                requirements: [
                    {
                        kind: 'file',
                        payload: {
                            extension: '.md',
                            path: artifactRelativePath,
                        },
                    },
                ],
            },
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: ['run_command'],
            }),
            evaluateArtifactContract: (_contract, evidence) => {
                observedEvidenceFiles = [...evidence.files];
                const foundArtifact = evidence.files.some((filePath) =>
                    filePath.endsWith(path.normalize(artifactRelativePath))
                );
                return foundArtifact
                    ? { passed: true, failed: [] }
                    : {
                        passed: false,
                        failed: [{
                            description: 'expected markdown report',
                            reason: 'missing generated file',
                        }],
                    };
            },
        }));

        expect(result.success).toBe(true);
        expect(result.artifactsCreated).toContain(artifactAbsolutePath);
        expect(observedEvidenceFiles).toContain(artifactAbsolutePath);
    });

    test('continuePreparedAgentFlow materializes required markdown deliverables from assistant output', async () => {
        const workspaceDir = makeTempDir('coworkany-runtime-md-materialize-');
        const artifactRelativePath = 'artifacts/task-output.md';
        const artifactAbsolutePath = path.join(workspaceDir, artifactRelativePath);
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.deliverables = [{
            id: 'deliverable-md',
            title: 'Planned output artifact',
            type: 'report_file',
            description: 'Persist the result as markdown.',
            required: true,
            path: artifactRelativePath,
            format: 'md',
        }];

        let observedEvidenceFiles: string[] = [];
        const result = await continuePreparedAgentFlow({
            taskId: 'task-md-materialize',
            userMessage: 'continue',
            workspacePath: workspaceDir,
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {
                requirements: [
                    {
                        kind: 'file',
                        payload: {
                            extension: '.md',
                            path: artifactRelativePath,
                        },
                    },
                ],
            },
        }, makeDeps({
            runAgentLoop: async () => ({
                artifactsCreated: [],
                toolsUsed: [],
            }),
            session: new ExecutionSession({
                taskId: 'task-md-materialize',
                conversationReader: {
                    buildConversationText: () => 'conversation text',
                    getLatestAssistantResponseText: () => 'markdown body from assistant',
                },
            }),
            evaluateArtifactContract: (_contract, evidence) => {
                observedEvidenceFiles = [...evidence.files];
                const foundArtifact = evidence.files.some((filePath) =>
                    filePath.endsWith(path.normalize(artifactRelativePath))
                );
                return foundArtifact
                    ? { passed: true, failed: [] }
                    : {
                        passed: false,
                        failed: [{
                            description: 'expected markdown report',
                            reason: 'missing markdown artifact',
                        }],
                    };
            },
        }));

        expect(result.success).toBe(true);
        expect(fs.existsSync(artifactAbsolutePath)).toBe(true);
        expect(fs.readFileSync(artifactAbsolutePath, 'utf-8')).toContain('markdown body from assistant');
        expect(result.artifactsCreated).toContain(artifactAbsolutePath);
        expect(observedEvidenceFiles).toContain(artifactAbsolutePath);
    });

    test('continuePreparedAgentFlow auto-refreezes and retries once when artifact validation fails and replanning is allowed', async () => {
        const failurePayloads: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        const reopenedPayloads: Array<{
            summary: string;
            reason: string;
            trigger: string;
            nextStepId?: string;
        }> = [];
        const refrozenTaskIds: string[] = [];
        const emittedPlanSnapshots: Array<Array<{ kind: string; status: string }>> = [];
        let clearedPreparedWorkRequest = 0;
        let markedFailed = false;
        let executionStartedCount = 0;
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.replanPolicy = {
            allowReturnToResearch: true,
            triggers: ['execution_infeasible'],
        };
        prepared.executionPlan.steps = [
            { stepId: 'goal', kind: 'goal_framing', title: 'Goal framing', description: 'Frame goal', status: 'completed', dependencies: [] },
            { stepId: 'research', kind: 'research', title: 'Research', description: 'Research context', status: 'completed', dependencies: ['goal'] },
            { stepId: 'uncertainty', kind: 'uncertainty_resolution', title: 'Resolve uncertainty', description: 'Resolve blockers', status: 'completed', dependencies: ['research'] },
            { stepId: 'freeze', kind: 'contract_freeze', title: 'Freeze contract', description: 'Freeze contract', status: 'completed', dependencies: ['uncertainty'] },
            { stepId: 'execution', kind: 'execution', title: 'Execute', description: 'Run task', status: 'running', dependencies: ['freeze'] },
            { stepId: 'reduction', kind: 'reduction', title: 'Reduce', description: 'Reduce result', status: 'pending', dependencies: ['execution'] },
            { stepId: 'presentation', kind: 'presentation', title: 'Present', description: 'Present result', status: 'pending', dependencies: ['reduction'] },
        ];
        let agentLoopCount = 0;
        let evaluationCount = 0;

        const result = await continuePreparedAgentFlow({
            taskId: 'task-reopen',
            userMessage: 'retry the export',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            session: new ExecutionSession({
                taskId: 'task-reopen',
                conversationReader: {
                    buildConversationText: () => 'conversation text',
                    getLatestAssistantResponseText: () => 'final assistant text after refreeze',
                },
                initialArtifacts: ['/tmp/report.md'],
            }),
            runAgentLoop: async () => {
                agentLoopCount += 1;
                return {
                    artifactsCreated: agentLoopCount === 1 ? ['/tmp/report.md'] : ['/tmp/report.pptx'],
                    toolsUsed: ['write_to_file'],
                };
            },
            evaluateArtifactContract: () => {
                evaluationCount += 1;
                if (evaluationCount === 1) {
                    return {
                        passed: false,
                        failed: [{ description: 'expected pptx output', reason: 'generated markdown only' }],
                    };
                }
                return {
                    passed: true,
                    failed: [],
                };
            },
            detectDegradedOutputs: () => ({
                hasDegradedOutput: false,
                degradedArtifacts: [],
            }),
            refreezePreparedWorkRequestForResearch: async ({ prepared: reopenedPrepared, reason }) => {
                reopenedPrepared.frozenWorkRequest.knownRisks = Array.from(
                    new Set([...(reopenedPrepared.frozenWorkRequest.knownRisks ?? []), reason])
                );
                reopenedPrepared.executionPlan.steps = [
                    { stepId: 'goal', kind: 'goal_framing', title: 'Goal framing', description: 'Frame goal', status: 'completed', dependencies: [] },
                    { stepId: 'research', kind: 'research', title: 'Research', description: 'Research context', status: 'completed', dependencies: ['goal'] },
                    { stepId: 'uncertainty', kind: 'uncertainty_resolution', title: 'Resolve uncertainty', description: 'Resolve blockers', status: 'completed', dependencies: ['research'] },
                    { stepId: 'freeze', kind: 'contract_freeze', title: 'Freeze contract', description: 'Freeze contract', status: 'completed', dependencies: ['uncertainty'] },
                    { stepId: 'execution', kind: 'execution', title: 'Execute', description: 'Run task', status: 'pending', dependencies: ['freeze'] },
                    { stepId: 'reduction', kind: 'reduction', title: 'Reduce', description: 'Reduce result', status: 'pending', dependencies: ['execution'] },
                    { stepId: 'presentation', kind: 'presentation', title: 'Present', description: 'Present result', status: 'pending', dependencies: ['reduction'] },
                ];
                return reopenedPrepared;
            },
            emitContractReopened: (_taskId, payload) => {
                reopenedPayloads.push(payload);
            },
            emitPreparedWorkRequestRefrozen: ({ taskId }) => {
                refrozenTaskIds.push(taskId);
                return { blocked: false };
            },
            emitPlanUpdated: (_taskId, preparedWorkRequest) => {
                emittedPlanSnapshots.push(
                    preparedWorkRequest.executionPlan.steps.map((step) => ({
                        kind: step.kind,
                        status: step.status,
                    }))
                );
            },
            clearPreparedWorkRequest: () => {
                clearedPreparedWorkRequest += 1;
            },
            markWorkRequestExecutionStarted: () => {
                executionStartedCount += 1;
            },
            markWorkRequestExecutionFailed: () => {
                markedFailed = true;
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failurePayloads.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(true);
        expect(result.summary).toBe('reduced summary');
        expect(result.artifactsCreated).toEqual(['/tmp/report.md', '/tmp/report.pptx']);
        expect(agentLoopCount).toBe(2);
        expect(evaluationCount).toBe(2);
        expect(reopenedPayloads).toHaveLength(1);
        expect(reopenedPayloads[0]?.trigger).toBe('execution_infeasible');
        expect(reopenedPayloads[0]?.nextStepId).toBe('research');
        expect(refrozenTaskIds).toEqual(['task-reopen']);
        expect(failurePayloads).toHaveLength(0);
        expect(markedFailed).toBe(false);
        expect(executionStartedCount).toBe(1);
        expect(clearedPreparedWorkRequest).toBe(2);
        expect(prepared.frozenWorkRequest.knownRisks).toContain(
            'Artifact contract unmet: expected pptx output (generated markdown only)'
        );
        expect(emittedPlanSnapshots.at(-1)).toEqual([
            { kind: 'goal_framing', status: 'completed' },
            { kind: 'research', status: 'completed' },
            { kind: 'uncertainty_resolution', status: 'completed' },
            { kind: 'contract_freeze', status: 'completed' },
            { kind: 'execution', status: 'completed' },
            { kind: 'reduction', status: 'completed' },
            { kind: 'presentation', status: 'running' },
        ]);
    });

    test('continuePreparedAgentFlow stops after refreeze when the reopened contract needs clarification', async () => {
        const reopenedPayloads: Array<{ summary: string; reason: string; trigger: string; nextStepId?: string }> = [];
        const refrozenTaskIds: string[] = [];
        let agentLoopCount = 0;
        let executionStartedCount = 0;
        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.replanPolicy = {
            allowReturnToResearch: true,
            triggers: ['execution_infeasible'],
        };
        prepared.executionPlan.steps = [
            { stepId: 'goal', kind: 'goal_framing', title: 'Goal framing', description: 'Frame goal', status: 'completed', dependencies: [] },
            { stepId: 'research', kind: 'research', title: 'Research', description: 'Research context', status: 'completed', dependencies: ['goal'] },
            { stepId: 'uncertainty', kind: 'uncertainty_resolution', title: 'Resolve uncertainty', description: 'Resolve blockers', status: 'completed', dependencies: ['research'] },
            { stepId: 'freeze', kind: 'contract_freeze', title: 'Freeze contract', description: 'Freeze contract', status: 'completed', dependencies: ['uncertainty'] },
            { stepId: 'execution', kind: 'execution', title: 'Execute', description: 'Run task', status: 'running', dependencies: ['freeze'] },
            { stepId: 'reduction', kind: 'reduction', title: 'Reduce', description: 'Reduce result', status: 'pending', dependencies: ['execution'] },
            { stepId: 'presentation', kind: 'presentation', title: 'Present', description: 'Present result', status: 'pending', dependencies: ['reduction'] },
        ];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-reopen-blocked',
            userMessage: 'retry the export',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCount += 1;
                return {
                    artifactsCreated: ['/tmp/report.md'],
                    toolsUsed: ['write_to_file'],
                };
            },
            evaluateArtifactContract: () => ({
                passed: false,
                failed: [{ description: 'expected pptx output', reason: 'generated markdown only' }],
            }),
            detectDegradedOutputs: () => ({
                hasDegradedOutput: false,
                degradedArtifacts: [],
            }),
            refreezePreparedWorkRequestForResearch: async ({ prepared: reopenedPrepared }) => reopenedPrepared,
            emitContractReopened: (_taskId, payload) => {
                reopenedPayloads.push(payload);
            },
            emitPreparedWorkRequestRefrozen: ({ taskId }) => {
                refrozenTaskIds.push(taskId);
                return {
                    blocked: true,
                    summary: 'Need clarification after refreeze.',
                };
            },
            markWorkRequestExecutionStarted: () => {
                executionStartedCount += 1;
            },
        }));

        expect(result.success).toBe(false);
        expect(result.summary).toBe('Need clarification after refreeze.');
        expect(result.error).toContain('Artifact contract unmet');
        expect(agentLoopCount).toBe(1);
        expect(executionStartedCount).toBe(0);
        expect(reopenedPayloads).toHaveLength(1);
        expect(refrozenTaskIds).toEqual(['task-reopen-blocked']);
    });

    test('executePreparedTaskFlow reopens deterministic local workflow failures caused by permission blocks', async () => {
        const reopenedPayloads: Array<{ summary: string; reason: string; trigger: string; nextStepId?: string }> = [];
        const refrozenCalls: Array<{ taskId: string; reason: string; trigger: string }> = [];
        const failurePayloads: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        let markedFailed = false;

        const prepared = makeLocalPreparedWorkRequest('organize-downloads-images');
        prepared.frozenWorkRequest.replanPolicy = {
            allowReturnToResearch: true,
            triggers: ['permission_block', 'missing_resource', 'execution_infeasible'],
        };

        const result = await executePreparedTaskFlow({
            taskId: 'task-local-permission',
            userQuery: '整理 Downloads 文件夹下的图片文件',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            executeTool: async (_taskId, toolName) => {
                if (toolName === 'list_dir') {
                    return [
                        { name: 'a.png', path: 'a.png', isDir: false },
                    ];
                }
                if (toolName === 'create_directory') {
                    return { error: 'permission denied' };
                }
                return {};
            },
            emitContractReopened: (_taskId, payload) => {
                reopenedPayloads.push(payload);
            },
            refreezePreparedWorkRequestForResearch: async ({ prepared: reopenedPrepared }) => reopenedPrepared,
            emitPreparedWorkRequestRefrozen: ({ taskId, reason, trigger }) => {
                refrozenCalls.push({ taskId, reason, trigger });
                return {
                    blocked: true,
                    summary: 'Grant the required host-folder access, then continue.',
                };
            },
            markWorkRequestExecutionFailed: () => {
                markedFailed = true;
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failurePayloads.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.summary).toBe('Grant the required host-folder access, then continue.');
        expect(result.error).toContain('permission denied');
        expect(reopenedPayloads).toHaveLength(1);
        expect(reopenedPayloads[0]?.trigger).toBe('permission_block');
        expect(refrozenCalls).toEqual([{
            taskId: 'task-local-permission',
            reason: 'Failed to create destination folder for PNG: permission denied',
            trigger: 'permission_block',
        }]);
        expect(markedFailed).toBe(false);
        expect(failurePayloads).toHaveLength(0);
    });

    test('executePreparedTaskFlow reopens deterministic local workflow failures caused by missing resources', async () => {
        const reopenedPayloads: Array<{ summary: string; reason: string; trigger: string; nextStepId?: string }> = [];
        const refrozenCalls: Array<{ taskId: string; reason: string; trigger: string }> = [];
        const failurePayloads: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        let markedFailed = false;

        const prepared = makeLocalPreparedWorkRequest('inspect-downloads-images');
        prepared.frozenWorkRequest.replanPolicy = {
            allowReturnToResearch: true,
            triggers: ['permission_block', 'missing_resource', 'execution_infeasible'],
        };

        const result = await executePreparedTaskFlow({
            taskId: 'task-local-missing',
            userQuery: '检查 Downloads 文件夹下的图片文件',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            executeTool: async (_taskId, toolName) => {
                if (toolName === 'list_dir') {
                    return { error: 'no such file or directory' };
                }
                return {};
            },
            emitContractReopened: (_taskId, payload) => {
                reopenedPayloads.push(payload);
            },
            refreezePreparedWorkRequestForResearch: async ({ prepared: reopenedPrepared }) => reopenedPrepared,
            emitPreparedWorkRequestRefrozen: ({ taskId, reason, trigger }) => {
                refrozenCalls.push({ taskId, reason, trigger });
                return {
                    blocked: true,
                    summary: 'Resolve the missing folder or file, then continue.',
                };
            },
            markWorkRequestExecutionFailed: () => {
                markedFailed = true;
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failurePayloads.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.summary).toBe('Resolve the missing folder or file, then continue.');
        expect(result.error).toContain('no such file or directory');
        expect(reopenedPayloads).toHaveLength(1);
        expect(reopenedPayloads[0]?.trigger).toBe('missing_resource');
        expect(refrozenCalls).toEqual([{
            taskId: 'task-local-missing',
            reason: 'Failed to inspect the target folder: no such file or directory',
            trigger: 'missing_resource',
        }]);
        expect(markedFailed).toBe(false);
        expect(failurePayloads).toHaveLength(0);
    });

    test('continuePreparedAgentFlow reopens agent execution failures caused by permission blocks', async () => {
        const reopenedPayloads: Array<{ summary: string; reason: string; trigger: string; nextStepId?: string }> = [];
        const refrozenCalls: Array<{ taskId: string; reason: string; trigger: string }> = [];
        const failurePayloads: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        let markedFailed = false;

        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.replanPolicy = {
            allowReturnToResearch: true,
            triggers: ['permission_block', 'missing_resource', 'execution_infeasible'],
        };

        const result = await continuePreparedAgentFlow({
            taskId: 'task-agent-permission',
            userMessage: 'continue the task',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => {
                throw new Error('permission denied while writing artifact');
            },
            emitContractReopened: (_taskId, payload) => {
                reopenedPayloads.push(payload);
            },
            refreezePreparedWorkRequestForResearch: async ({ prepared: reopenedPrepared }) => reopenedPrepared,
            emitPreparedWorkRequestRefrozen: ({ taskId, reason, trigger }) => {
                refrozenCalls.push({ taskId, reason, trigger });
                return {
                    blocked: true,
                    summary: 'Grant write access, then continue.',
                };
            },
            markWorkRequestExecutionFailed: () => {
                markedFailed = true;
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failurePayloads.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.summary).toBe('Grant write access, then continue.');
        expect(result.error).toBe('permission denied while writing artifact');
        expect(reopenedPayloads).toHaveLength(1);
        expect(reopenedPayloads[0]?.trigger).toBe('permission_block');
        expect(refrozenCalls).toEqual([{
            taskId: 'task-agent-permission',
            reason: 'permission denied while writing artifact',
            trigger: 'permission_block',
        }]);
        expect(markedFailed).toBe(false);
        expect(failurePayloads).toHaveLength(0);
    });

    test('continuePreparedAgentFlow reopens agent execution failures caused by missing resources', async () => {
        const reopenedPayloads: Array<{ summary: string; reason: string; trigger: string; nextStepId?: string }> = [];
        const refrozenCalls: Array<{ taskId: string; reason: string; trigger: string }> = [];
        const failurePayloads: Array<{ error: string; errorCode: string; recoverable: boolean; suggestion?: string }> = [];
        let markedFailed = false;

        const prepared = makePreparedWorkRequest();
        prepared.frozenWorkRequest.replanPolicy = {
            allowReturnToResearch: true,
            triggers: ['permission_block', 'missing_resource', 'execution_infeasible'],
        };

        const result = await continuePreparedAgentFlow({
            taskId: 'task-agent-missing',
            userMessage: 'continue the task',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            runAgentLoop: async () => {
                throw new Error('no such file or directory: /tmp/workspace/input.csv');
            },
            emitContractReopened: (_taskId, payload) => {
                reopenedPayloads.push(payload);
            },
            refreezePreparedWorkRequestForResearch: async ({ prepared: reopenedPrepared }) => reopenedPrepared,
            emitPreparedWorkRequestRefrozen: ({ taskId, reason, trigger }) => {
                refrozenCalls.push({ taskId, reason, trigger });
                return {
                    blocked: true,
                    summary: 'Restore the missing input, then continue.',
                };
            },
            markWorkRequestExecutionFailed: () => {
                markedFailed = true;
            },
            reporter: new ExecutionResultReporter({
                onFinished: () => undefined,
                onFailed: (payload) => {
                    failurePayloads.push(payload);
                },
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
        }));

        expect(result.success).toBe(false);
        expect(result.summary).toBe('Restore the missing input, then continue.');
        expect(result.error).toBe('no such file or directory: /tmp/workspace/input.csv');
        expect(reopenedPayloads).toHaveLength(1);
        expect(reopenedPayloads[0]?.trigger).toBe('missing_resource');
        expect(refrozenCalls).toEqual([{
            taskId: 'task-agent-missing',
            reason: 'no such file or directory: /tmp/workspace/input.csv',
            trigger: 'missing_resource',
        }]);
        expect(markedFailed).toBe(false);
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

    test('continuePreparedAgentFlow auto-injects coworkany self-management skill and tools for self-config questions', async () => {
        const workspaceRoot = makeTempDir('coworkany-runtime-workspace-');
        const appDataRoot = makeTempDir('coworkany-runtime-appdata-');
        const skillStore = new SkillStore(workspaceRoot);
        const workspaceStore = new WorkspaceStore(appDataRoot);
        const appManagementTools = createAppManagementTools({
            workspaceRoot,
            getResolvedAppDataRoot: () => appDataRoot,
            skillStore,
            workspaceStore,
        });

        let capturedSkillIds: string[] = [];
        let capturedSystemPrompt: string | { skills: string } | undefined;
        let capturedToolNames: string[] = [];

        const result = await continuePreparedAgentFlow({
            taskId: 'task-self-config',
            userMessage: 'coworkany 中的 serper key 是什么',
            workspacePath: workspaceRoot,
            preparedWorkRequest: makePreparedWorkRequest(),
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
        }, makeDeps({
            getTriggeredSkillIds: (userMessage) =>
                skillStore.findByTrigger(userMessage).map((skill) => skill.manifest.name),
            buildSkillSystemPrompt: (skillIds) => {
                capturedSkillIds = [...(skillIds ?? [])];
                return { skills: `skills:${(skillIds ?? []).join(',')}` };
            },
            getToolsForTask: () => appManagementTools,
            runAgentLoop: async (_taskId, _conversation, options, _providerConfig, tools) => {
                capturedSystemPrompt = options.systemPrompt;
                capturedToolNames = tools.map((tool) => tool.name);
                return {
                    artifactsCreated: [],
                    toolsUsed: ['get_coworkany_config'],
                };
            },
        }));

        const promptText = typeof capturedSystemPrompt === 'string'
            ? capturedSystemPrompt
            : capturedSystemPrompt?.skills;

        expect(result.success).toBe(true);
        expect(capturedSkillIds).toContain('coworkany-self-management');
        expect(capturedSkillIds).toContain('task-orchestrator');
        expect(promptText).toContain('coworkany-self-management');
        expect(capturedToolNames).toContain('get_coworkany_config');
        expect(capturedToolNames).toContain('update_coworkany_config');
        expect(capturedToolNames).toContain('list_coworkany_skills');
    });

    test('executePreparedTaskFlow uses marketplace install fast path for skillhub install requests', async () => {
        let agentLoopCalled = false;
        const toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
        const summaries: string[] = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '从 skillhub 中安装 skill-vetter';
        prepared.frozenWorkRequest.sourceText = '从 skillhub 中安装 skill-vetter';

        const result = await executePreparedTaskFlow({
            taskId: 'task-marketplace-fastpath',
            userQuery: '从 skillhub 中安装 skill-vetter',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push({ toolName, args });
                return {
                    success: true,
                    message: '已从 skillhub 安装并启用技能 `skill-vetter`。',
                };
            },
            reporter: new ExecutionResultReporter({
                onFinished: ({ summary }) => {
                    summaries.push(summary);
                },
                onFailed: () => undefined,
                onStatus: () => undefined,
                onArtifactTelemetry: () => undefined,
            }),
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
        }));

        expect(result.success).toBe(true);
        expect(agentLoopCalled).toBe(false);
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]?.toolName).toBe('install_coworkany_skill_from_marketplace');
        expect(toolCalls[0]?.args).toMatchObject({
            source: 'skill-vetter',
            marketplace: 'skillhub',
        });
        expect(summaries[0]).toContain('skill-vetter');
    });

    test('executePreparedTaskFlow uses marketplace install fast path for GitHub install requests', async () => {
        let agentLoopCalled = false;
        const toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '从 github 安装 openai/repo-skill';
        prepared.frozenWorkRequest.sourceText = '从 github 安装 openai/repo-skill';

        const result = await executePreparedTaskFlow({
            taskId: 'task-marketplace-github-fastpath',
            userQuery: '从 github 安装 openai/repo-skill',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push({ toolName, args });
                return {
                    success: true,
                    message: '已从 github 安装并启用技能 `Repo Skill`。',
                };
            },
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
        }));

        expect(result.success).toBe(true);
        expect(agentLoopCalled).toBe(false);
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]?.toolName).toBe('install_coworkany_skill_from_marketplace');
        expect(toolCalls[0]?.args).toMatchObject({
            source: 'openai/repo-skill',
            marketplace: 'github',
        });
    });

    test('executePreparedTaskFlow uses marketplace install fast path for ClawHub install requests', async () => {
        let agentLoopCalled = false;
        const toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '从 clawhub 安装 claw-vetter';
        prepared.frozenWorkRequest.sourceText = '从 clawhub 安装 claw-vetter';

        const result = await executePreparedTaskFlow({
            taskId: 'task-marketplace-clawhub-fastpath',
            userQuery: '从 clawhub 安装 claw-vetter',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push({ toolName, args });
                return {
                    success: true,
                    message: '已从 clawhub 安装并启用技能 `Claw Vetter`。',
                };
            },
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
        }));

        expect(result.success).toBe(true);
        expect(agentLoopCalled).toBe(false);
        expect(toolCalls).toHaveLength(1);
        expect(toolCalls[0]?.toolName).toBe('install_coworkany_skill_from_marketplace');
        expect(toolCalls[0]?.args).toMatchObject({
            source: 'claw-vetter',
            marketplace: 'clawhub',
        });
    });

    test('executePreparedTaskFlow skips marketplace fast path when install tool is disabled', async () => {
        let agentLoopCalled = false;
        const toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
        const prepared = makePreparedWorkRequest();
        prepared.executionQuery = '从 skillhub 中安装 skill-vetter';
        prepared.frozenWorkRequest.sourceText = '从 skillhub 中安装 skill-vetter';

        const result = await executePreparedTaskFlow({
            taskId: 'task-marketplace-fastpath-disabled',
            userQuery: '从 skillhub 中安装 skill-vetter',
            workspacePath: '/tmp/workspace',
            config: {
                disabledTools: ['install_coworkany_skill_from_marketplace'],
            },
            preparedWorkRequest: prepared,
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push({ toolName, args });
                return {};
            },
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return {
                    artifactsCreated: [],
                    toolsUsed: ['run_command'],
                };
            },
        }));

        expect(result.success).toBe(true);
        expect(agentLoopCalled).toBe(true);
        expect(toolCalls).toHaveLength(0);
    });

    test('executePreparedTaskFlow uses deterministic local workflow for downloads image inspection', async () => {
        let agentLoopCalled = false;
        const summaries: string[] = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-6',
            userQuery: '查看 Downloads 里的图片',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makeLocalPreparedWorkRequest('inspect-downloads-images'),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            executeTool: async (_taskId, toolName) => {
                if (toolName === 'list_dir') {
                    return [
                        { name: 'a.png', isDir: false },
                        { name: 'notes.txt', isDir: false },
                        { name: 'b.jpg', isDir: false },
                    ];
                }
                return {};
            },
            reporter: new ExecutionResultReporter({
                onFinished: ({ summary }) => {
                    summaries.push(summary);
                },
                onFailed: () => undefined,
            }),
        }));

        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(result.summary).toContain('Found 2 top-level image files');
        expect(summaries[0]).toContain('a.png');
    });

    test('executePreparedTaskFlow bypasses deterministic local workflow when user requires explicit command-first execution', async () => {
        let agentLoopCalled = false;
        let listDirCalled = false;
        const prepared = makeLocalPreparedWorkRequest('inspect-downloads-images');
        prepared.frozenWorkRequest.sourceText = 'Execute this exact command first: python3 "/tmp/remove.py" "/Users/tester/Downloads"';
        prepared.executionQuery = 'Execute this exact command first: python3 "/tmp/remove.py" "/Users/tester/Downloads"';

        const result = await executePreparedTaskFlow({
            taskId: 'task-command-first-bypass',
            userQuery: prepared.executionQuery,
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: prepared,
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            executeTool: async (_taskId, toolName) => {
                if (toolName === 'list_dir') {
                    listDirCalled = true;
                }
                return {};
            },
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return {
                    artifactsCreated: [],
                    toolsUsed: ['run_command'],
                };
            },
        }));

        expect(result.success).toBe(true);
        expect(agentLoopCalled).toBe(true);
        expect(listDirCalled).toBe(false);
    });

    test('executePreparedTaskFlow uses deterministic local workflow for downloads image organization', async () => {
        let agentLoopCalled = false;
        const toolCalls: string[] = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-7',
            userQuery: '整理 Downloads 文件夹下的图片文件',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makeLocalPreparedWorkRequest('organize-downloads-images'),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push(toolName);
                if (toolName === 'list_dir' && args.path === '/Users/tester/Downloads') {
                    return [
                        { name: 'a.png', isDir: false },
                        { name: 'b.jpg', isDir: false },
                    ];
                }
                if (toolName === 'list_dir') {
                    return [
                        { name: 'PNG', isDir: true },
                        { name: 'JPG', isDir: true },
                    ];
                }
                if (toolName === 'create_directory') {
                    return { success: true };
                }
                if (toolName === 'batch_move_files') {
                    return {
                        success: true,
                        results: [
                            { success: true },
                            { success: true },
                        ],
                    };
                }
                return {};
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(toolCalls).toEqual([
            'list_dir',
            'create_directory',
            'create_directory',
            'batch_move_files',
            'list_dir',
        ]);
        expect(result.summary).toContain('Organized 2 image files');
        expect(result.summary).toContain('Created folders: PNG, JPG');
    });

    test('executePreparedTaskFlow uses deterministic local workflow for downloads image deduplication', async () => {
        let agentLoopCalled = false;
        const toolCalls: string[] = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-8',
            userQuery: '给 Downloads 文件夹下的图片去重',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makeLocalPreparedWorkRequest('deduplicate-downloads-images'),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push(toolName);
                if (toolName === 'list_dir' && args.path === '/Users/tester/Downloads') {
                    return [
                        { name: 'a.png', isDir: false },
                        { name: 'copy-a.png', isDir: false },
                        { name: 'b.jpg', isDir: false },
                    ];
                }
                if (toolName === 'compute_file_hash' && args.path === '/Users/tester/Downloads/a.png') {
                    return { success: true, hash: 'hash-a' };
                }
                if (toolName === 'compute_file_hash' && args.path === '/Users/tester/Downloads/copy-a.png') {
                    return { success: true, hash: 'hash-a' };
                }
                if (toolName === 'compute_file_hash' && args.path === '/Users/tester/Downloads/b.jpg') {
                    return { success: true, hash: 'hash-b' };
                }
                if (toolName === 'create_directory') {
                    return { success: true };
                }
                if (toolName === 'batch_move_files') {
                    return {
                        success: true,
                        results: [{ success: true }],
                    };
                }
                if (toolName === 'list_dir' && args.path === '/Users/tester/Downloads/Duplicates') {
                    return [{ name: 'hash-a', isDir: true }];
                }
                return {};
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(toolCalls).toEqual([
            'list_dir',
            'compute_file_hash',
            'compute_file_hash',
            'compute_file_hash',
            'create_directory',
            'batch_move_files',
            'list_dir',
        ]);
        expect(result.summary).toContain('Quarantined 1 duplicate image files');
        expect(result.summary).toContain('/Users/tester/Downloads/Duplicates');
    });

    test('executePreparedTaskFlow uses deterministic local workflow for host-folder image deletion', async () => {
        let agentLoopCalled = false;
        const toolCalls: string[] = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-9',
            userQuery: '删除 Downloads 文件夹下的图片文件',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makeLocalPreparedWorkRequest('delete-host-folder-files'),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push(toolName);
                if (toolName === 'list_dir' && args.path === '/Users/tester/Downloads') {
                    if (toolCalls.filter((name) => name === 'list_dir').length === 1) {
                        return [
                            { name: 'a.png', isDir: false },
                            { name: 'notes.txt', isDir: false },
                            { name: 'b.jpg', isDir: false },
                        ];
                    }

                    return [
                        { name: 'notes.txt', isDir: false },
                    ];
                }
                if (toolName === 'batch_delete_paths') {
                    return {
                        success: true,
                        results: [
                            { success: true, path: '/Users/tester/Downloads/a.png' },
                            { success: true, path: '/Users/tester/Downloads/b.jpg' },
                        ],
                    };
                }
                return {};
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(toolCalls).toEqual([
            'list_dir',
            'batch_delete_paths',
            'list_dir',
        ]);
        expect(result.summary).toContain('Deleted 2 top-level image files');
        expect(result.summary).toContain('/Users/tester/Downloads');
    });

    test('executePreparedTaskFlow uses deterministic local workflow for generic explicit-path image organization', async () => {
        let agentLoopCalled = false;
        const toolCalls: string[] = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-10',
            userQuery: '整理 /Users/tester/Pictures/Inbox 里的图片文件',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makeExplicitPathPreparedWorkRequest({
                workflowId: 'organize-host-folder-files',
                intent: 'organize_files',
                sourceText: '整理 /Users/tester/Pictures/Inbox 里的图片文件',
                targetPath: '/Users/tester/Pictures/Inbox',
                fileKinds: ['images'],
            }),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push(toolName);
                if (toolName === 'list_dir' && args.path === '/Users/tester/Pictures/Inbox') {
                    if (toolCalls.filter((name) => name === 'list_dir').length === 1) {
                        return [
                            { name: 'screen1.png', isDir: false },
                            { name: 'screen2.jpg', isDir: false },
                        ];
                    }

                    return [
                        { name: 'PNG', isDir: true },
                        { name: 'JPG', isDir: true },
                    ];
                }
                if (toolName === 'create_directory') {
                    return { success: true };
                }
                if (toolName === 'batch_move_files') {
                    return {
                        success: true,
                        results: [
                            { success: true },
                            { success: true },
                        ],
                    };
                }
                return {};
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(toolCalls).toEqual([
            'list_dir',
            'create_directory',
            'create_directory',
            'batch_move_files',
            'list_dir',
        ]);
        expect(result.summary).toContain('Organized 2 image files');
        expect(result.summary).toContain('/Users/tester/Pictures/Inbox');
    });

    test('executePreparedTaskFlow uses deterministic local workflow for generic explicit-path document organization', async () => {
        let agentLoopCalled = false;
        const toolCalls: string[] = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-11',
            userQuery: '整理 /Users/tester/Documents/Inbox 里的 PDF 文档',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makeExplicitPathPreparedWorkRequest({
                workflowId: 'organize-host-folder-files',
                intent: 'organize_files',
                sourceText: '整理 /Users/tester/Documents/Inbox 里的 PDF 文档',
                targetPath: '/Users/tester/Documents/Inbox',
                fileKinds: ['documents'],
            }),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            executeTool: async (_taskId, toolName, args) => {
                toolCalls.push(toolName);
                if (toolName === 'list_dir' && args.path === '/Users/tester/Documents/Inbox') {
                    if (toolCalls.filter((name) => name === 'list_dir').length === 1) {
                        return [
                            { name: 'a.pdf', isDir: false },
                            { name: 'b.docx', isDir: false },
                        ];
                    }

                    return [
                        { name: 'PDF', isDir: true },
                        { name: 'DOCX', isDir: true },
                    ];
                }
                if (toolName === 'create_directory') {
                    return { success: true };
                }
                if (toolName === 'batch_move_files') {
                    return {
                        success: true,
                        results: [
                            { success: true },
                            { success: true },
                        ],
                    };
                }
                return {};
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(toolCalls).toEqual([
            'list_dir',
            'create_directory',
            'create_directory',
            'batch_move_files',
            'list_dir',
        ]);
        expect(result.summary).toContain('Organized 2 document files');
        expect(result.summary).toContain('/Users/tester/Documents/Inbox/Documents');
    });

    test('executePreparedTaskFlow uses recursive traversal for explicit-path document organization', async () => {
        let agentLoopCalled = false;
        const listDirArgs: any[] = [];

        const result = await executePreparedTaskFlow({
            taskId: 'task-12',
            userQuery: '递归整理 /Users/tester/Documents/Inbox 里的 PDF 文档和所有子文件夹',
            workspacePath: '/tmp/workspace',
            preparedWorkRequest: makeExplicitPathPreparedWorkRequest({
                workflowId: 'organize-host-folder-files',
                intent: 'organize_files',
                sourceText: '递归整理 /Users/tester/Documents/Inbox 里的 PDF 文档和所有子文件夹',
                targetPath: '/Users/tester/Documents/Inbox',
                fileKinds: ['documents'],
                traversalScope: 'recursive',
            }),
            allowAutonomousFallback: false,
            workRequestExecutionPrompt: 'Frozen Work Request',
            conversation: [],
            artifactContract: {},
            startedAt: Date.now(),
        }, makeDeps({
            runAgentLoop: async () => {
                agentLoopCalled = true;
                return { artifactsCreated: [], toolsUsed: [] };
            },
            executeTool: async (_taskId, toolName, args) => {
                if (toolName === 'list_dir') {
                    listDirArgs.push(args);
                    if (listDirArgs.length === 1) {
                        return [
                            { name: 'nested', path: 'nested', isDir: true },
                            { name: 'a.pdf', path: 'nested/a.pdf', isDir: false },
                            { name: 'b.docx', path: 'nested/deeper/b.docx', isDir: false },
                        ];
                    }

                    return [
                        { name: 'PDF', isDir: true },
                        { name: 'DOCX', isDir: true },
                    ];
                }
                if (toolName === 'create_directory') {
                    return { success: true };
                }
                if (toolName === 'batch_move_files') {
                    return {
                        success: true,
                        results: [
                            { success: true },
                            { success: true },
                        ],
                    };
                }
                return {};
            },
        }));

        expect(agentLoopCalled).toBe(false);
        expect(result.success).toBe(true);
        expect(listDirArgs[0]).toMatchObject({
            path: '/Users/tester/Documents/Inbox',
            recursive: true,
            max_depth: 16,
        });
        expect(result.summary).toContain('Organized 2 document files');
    });
});
