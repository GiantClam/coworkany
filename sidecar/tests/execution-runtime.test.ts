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
