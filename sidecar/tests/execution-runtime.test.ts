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
        markWorkRequestExecutionCompleted: () => undefined,
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
