import * as path from 'path';
import { type PreparedWorkRequestContext } from '../orchestration/workRequestRuntime';
import { type ToolDefinition } from '../tools/standard';
import { type ExecutionResultReporter } from './resultReporter';
import { type ExecutionSession } from './session';
import type { LocalTaskPlanHint } from '../orchestration/localTaskIntent';

export type ExecutionTaskConfig = {
    modelId?: string;
    maxTokens?: number;
    maxHistoryMessages?: number;
    enabledClaudeSkills?: string[];
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    workspacePath?: string;
};

export type ExecutionStreamOptions = {
    modelId?: string;
    maxTokens?: number;
    systemPrompt?: string | { skills: string };
    tools?: ToolDefinition[];
};

export type ExecutionRuntimeResult = {
    success: boolean;
    summary: string;
    error?: string;
    artifactsCreated: string[];
};

type AgentLoopResult = {
    artifactsCreated: string[];
    toolsUsed: string[];
};

type AutonomousTaskResult = {
    createdAt: string;
    summary?: string;
    decomposedTasks: Array<{ status: string }>;
    verificationResult?: { goalMet: boolean };
};

type ArtifactEvaluationResult = {
    passed: boolean;
    failed: Array<{ description: string; reason: string }>;
};

type DegradedOutputResult = {
    hasDegradedOutput: boolean;
    degradedArtifacts: string[];
};

export type ExecutionRuntimeDeps = {
    shouldRunAutonomously: (query: string) => boolean;
    prepareAutonomousProvider: (config?: ExecutionTaskConfig) => void;
    getAutonomousAgent: (taskId: string) => {
        startTask: (
            query: string,
            options: {
                autoSaveMemory: boolean;
                notifyOnComplete: boolean;
                runInBackground: boolean;
            }
        ) => Promise<AutonomousTaskResult>;
    };
    tryDeterministicResearchArtifactFallback: (
        taskId: string,
        query: string
    ) => Promise<string | null>;
    tryPptGeneratorSkillFastPath: (
        taskId: string,
        userQuery: string,
        workspacePath: string,
        enabledSkillIds?: string[]
    ) => Promise<{ summary: string; artifactsCreated: string[] } | null>;
    getTriggeredSkillIds: (userMessage: string) => string[];
    mergeSkillIds: (...skillGroups: Array<string[] | undefined>) => string[];
    buildSkillSystemPrompt: (
        skillIds: string[] | undefined
    ) => string | { skills: string } | undefined;
    getDirectivePromptAdditions?: (query: string) => string | undefined;
    mergeSystemPrompt: (
        basePrompt: string | { skills: string } | undefined,
        extraPrompt: string | undefined
    ) => string | { skills: string } | undefined;
    ensureToolpacksRegistered: (toolpackIds?: string[]) => Promise<void>;
    getToolsForTask: (taskId: string) => ToolDefinition[];
    executeTool: (
        taskId: string,
        toolName: string,
        args: Record<string, unknown>,
        context: { workspacePath: string }
    ) => Promise<any>;
    buildProviderConfig: (options: ExecutionStreamOptions) => unknown;
    runAgentLoop: (
        taskId: string,
        conversation: any,
        options: ExecutionStreamOptions,
        providerConfig: any,
        tools: ToolDefinition[]
    ) => Promise<AgentLoopResult>;
    session: ExecutionSession;
    reporter: ExecutionResultReporter;
    evaluateArtifactContract: (
        artifactContract: any,
        evidence: { files: string[]; toolsUsed: string[]; outputText: string }
    ) => ArtifactEvaluationResult;
    detectDegradedOutputs: (
        artifactContract: any,
        artifacts: string[]
    ) => DegradedOutputResult;
    buildArtifactTelemetry: (
        artifactContract: any,
        evidence: { files: string[]; toolsUsed: string[]; outputText: string },
        evaluation: any
    ) => unknown;
    reduceWorkResult: (input: {
        canonicalResult: string;
        request: PreparedWorkRequestContext['frozenWorkRequest'];
        artifacts?: string[];
    }) => { canonicalResult: string; uiSummary: string; ttsSummary: string; artifacts: string[] };
    markWorkRequestExecutionCompleted: (
        prepared: PreparedWorkRequestContext,
        summary: string
    ) => void;
    markWorkRequestExecutionFailed: (
        prepared: PreparedWorkRequestContext,
        error: string
    ) => void;
    quickLearnFromError?: (
        error: string,
        query: string,
        severity: number
    ) => Promise<{ learned: boolean }>;
};

export async function executePreparedTaskFlow(input: {
    taskId: string;
    userQuery: string;
    workspacePath: string;
    config?: ExecutionTaskConfig;
    preparedWorkRequest: PreparedWorkRequestContext;
    allowAutonomousFallback: boolean;
    workRequestExecutionPrompt?: string;
    extraSystemPrompt?: string;
    conversation: unknown;
    artifactContract: unknown;
    startedAt: number;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult> {
    const explicitlyEnabledSkillIds =
        input.config?.enabledClaudeSkills ??
        input.config?.enabledSkills ??
        [];
    const hasExplicitSkillSelection =
        Array.isArray(explicitlyEnabledSkillIds) && explicitlyEnabledSkillIds.length > 0;

    if (
        !hasExplicitSkillSelection &&
        input.allowAutonomousFallback &&
        deps.shouldRunAutonomously(input.preparedWorkRequest.executionQuery)
    ) {
        const autonomousResult = await executeAutonomousFlow(input, deps);
        if (autonomousResult) {
            return autonomousResult;
        }
    }

    return runPreparedAgentExecution({
        taskId: input.taskId,
        userMessage: input.userQuery,
        workspacePath: input.workspacePath,
        config: input.config,
        preparedWorkRequest: input.preparedWorkRequest,
        workRequestExecutionPrompt: input.workRequestExecutionPrompt,
        extraSystemPrompt: input.extraSystemPrompt,
        conversation: input.conversation,
        artifactContract: input.artifactContract,
        startedAt: input.startedAt,
        explicitSkillIds: explicitlyEnabledSkillIds,
        allowPptFastPath: true,
        allowUserConfirmedDegrade: false,
        emitFinishedStatus: false,
        artifactFailureErrorCode: 'ARTIFACT_CONTRACT_UNMET',
        artifactFailureSuggestionPrefix:
            'Detected degraded output ({artifacts}). Please confirm downgrade by sending: "CONFIRM_DEGRADE_TO_MD" or retry PPTX generation.',
        missingArtifactSuggestionPrefix: 'Expected file types not found. Generated files: {artifacts}',
        modelErrorCode: 'MODEL_STREAM_ERROR',
        learnOnArtifactFailure: true,
    }, deps);
}

export async function continuePreparedAgentFlow(input: {
    taskId: string;
    userMessage: string;
    workspacePath: string;
    config?: ExecutionTaskConfig;
    preparedWorkRequest: PreparedWorkRequestContext;
    workRequestExecutionPrompt?: string;
    conversation: unknown;
    artifactContract: unknown;
    explicitSkillIds?: string[];
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult> {
    return runPreparedAgentExecution({
        taskId: input.taskId,
        userMessage: input.userMessage,
        workspacePath: input.workspacePath,
        config: input.config,
        preparedWorkRequest: input.preparedWorkRequest,
        workRequestExecutionPrompt: input.workRequestExecutionPrompt,
        conversation: input.conversation,
        artifactContract: input.artifactContract,
        startedAt: Date.now(),
        explicitSkillIds: input.explicitSkillIds,
        allowPptFastPath: false,
        allowUserConfirmedDegrade: true,
        emitFinishedStatus: true,
        artifactFailureErrorCode: 'ARTIFACT_CONTRACT_UNMET',
        artifactFailureSuggestionPrefix:
            'Detected degraded output ({artifacts}). Ask user for explicit confirmation token CONFIRM_DEGRADE_TO_MD.',
        missingArtifactSuggestionPrefix: 'Expected file types not found. Generated files: {artifacts}',
        modelErrorCode: 'MODEL_STREAM_ERROR',
        learnOnArtifactFailure: false,
    }, deps);
}

async function executeAutonomousFlow(input: {
    taskId: string;
    userQuery: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    config?: ExecutionTaskConfig;
    startedAt: number;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult | null> {
    deps.prepareAutonomousProvider(input.config);
    const agent = deps.getAutonomousAgent(input.taskId);

    try {
        const task = await agent.startTask(input.preparedWorkRequest.executionQuery, {
            autoSaveMemory: true,
            notifyOnComplete: true,
            runInBackground: false,
        });

        const completedAutonomousSubtasks = task.decomposedTasks.filter(
            (subtask) => subtask.status === 'completed'
        ).length;
        const autonomousGoalMet = task.verificationResult?.goalMet ?? false;

        if (!autonomousGoalMet && completedAutonomousSubtasks === 0) {
            const deterministicFallbackSummary = await deps.tryDeterministicResearchArtifactFallback(
                input.taskId,
                input.preparedWorkRequest.executionQuery
            );
            if (deterministicFallbackSummary) {
                deps.markWorkRequestExecutionCompleted(
                    input.preparedWorkRequest,
                    deterministicFallbackSummary
                );
                deps.reporter.finished({
                    summary: deterministicFallbackSummary,
                    duration: Date.now() - new Date(task.createdAt).getTime(),
                });
                return {
                    success: true,
                    summary: deterministicFallbackSummary,
                    artifactsCreated: [],
                };
            }
            return null;
        } else {
            const summary = task.summary || 'Autonomous task completed';
            deps.markWorkRequestExecutionCompleted(input.preparedWorkRequest, summary);
            deps.reporter.finished({
                summary,
                duration: Date.now() - new Date(task.createdAt).getTime(),
            });
            return {
                success: true,
                summary,
                artifactsCreated: [],
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        deps.markWorkRequestExecutionFailed(input.preparedWorkRequest, errorMessage);
        deps.reporter.failed({
            error: errorMessage,
            errorCode: 'AUTONOMOUS_TASK_ERROR',
            recoverable: false,
        });
        return {
            success: false,
            summary: '',
            error: errorMessage,
            artifactsCreated: [],
        };
    }
}

async function runPreparedAgentExecution(input: {
    taskId: string;
    userMessage: string;
    workspacePath: string;
    config?: ExecutionTaskConfig;
    preparedWorkRequest: PreparedWorkRequestContext;
    workRequestExecutionPrompt?: string;
    extraSystemPrompt?: string;
    conversation: unknown;
    artifactContract: unknown;
    startedAt: number;
    explicitSkillIds?: string[];
    allowPptFastPath: boolean;
    allowUserConfirmedDegrade: boolean;
    emitFinishedStatus: boolean;
    artifactFailureErrorCode: string;
    artifactFailureSuggestionPrefix: string;
    missingArtifactSuggestionPrefix: string;
    modelErrorCode: string;
    learnOnArtifactFailure: boolean;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult> {
    const {
        taskId,
        userMessage,
        workspacePath,
        config,
        preparedWorkRequest,
        workRequestExecutionPrompt,
        extraSystemPrompt,
        conversation,
        artifactContract,
        startedAt,
        explicitSkillIds,
    } = input;
    const { frozenWorkRequest, executionQuery, preferredSkillIds } = preparedWorkRequest;
    const triggeredSkillIds = deps.getTriggeredSkillIds(userMessage);
    const enabledSkillIds = deps.mergeSkillIds(explicitSkillIds, triggeredSkillIds, preferredSkillIds);

    const deterministicLocalWorkflowResult = await tryExecuteDeterministicLocalWorkflow({
        taskId,
        workspacePath,
        preparedWorkRequest,
        startedAt,
        emitFinishedStatus: input.emitFinishedStatus,
    }, deps);
    if (deterministicLocalWorkflowResult) {
        return deterministicLocalWorkflowResult;
    }

    if (input.allowPptFastPath) {
        const pptGeneratorFastPathResult = await deps.tryPptGeneratorSkillFastPath(
            taskId,
            executionQuery,
            workspacePath,
            enabledSkillIds
        );
        if (pptGeneratorFastPathResult) {
            deps.session.replaceKnownArtifacts(pptGeneratorFastPathResult.artifactsCreated);
            deps.markWorkRequestExecutionCompleted(preparedWorkRequest, pptGeneratorFastPathResult.summary);
            deps.reporter.finished({
                summary: pptGeneratorFastPathResult.summary,
                artifactsCreated: pptGeneratorFastPathResult.artifactsCreated,
                duration: Date.now() - startedAt,
            });
            return {
                success: true,
                summary: pptGeneratorFastPathResult.summary,
                artifactsCreated: pptGeneratorFastPathResult.artifactsCreated,
            };
        }
    }

    const systemPromptWithDirectives = deps.mergeSystemPrompt(
        deps.buildSkillSystemPrompt(enabledSkillIds),
        deps.getDirectivePromptAdditions?.(userMessage)
    );
    const systemPrompt = deps.mergeSystemPrompt(
        systemPromptWithDirectives,
        [workRequestExecutionPrompt, extraSystemPrompt].filter(Boolean).join('\n\n') || undefined
    );

    try {
        const options: ExecutionStreamOptions = {
            modelId: config?.modelId,
            maxTokens: config?.maxTokens,
            systemPrompt,
        };

        await deps.ensureToolpacksRegistered(config?.enabledToolpacks);

        const tools = deps.getToolsForTask(taskId);
        options.tools = tools;

        const providerConfig = deps.buildProviderConfig(options);
        const loopResult = await deps.runAgentLoop(taskId, conversation, options, providerConfig, tools);
        const mergedArtifacts = deps.session.mergeKnownArtifacts(loopResult.artifactsCreated);
        const contractEvidence = {
            files: mergedArtifacts,
            toolsUsed: loopResult.toolsUsed,
            outputText: deps.session.buildConversationText(),
        };
        const artifactEvaluation = deps.evaluateArtifactContract(artifactContract, contractEvidence);
        const degradedOutput = deps.detectDegradedOutputs(artifactContract, mergedArtifacts);
        deps.reporter.appendArtifactTelemetry(
            deps.buildArtifactTelemetry(artifactContract, contractEvidence, artifactEvaluation)
        );

        if (!artifactEvaluation.passed) {
            const unmetMessage = `Artifact contract unmet: ${artifactEvaluation.failed
                .map((item) => `${item.description} (${item.reason})`)
                .join('; ')}`;
            deps.markWorkRequestExecutionFailed(preparedWorkRequest, unmetMessage);

            if (input.allowUserConfirmedDegrade && /CONFIRM_DEGRADE_TO_MD/i.test(userMessage) && degradedOutput.hasDegradedOutput) {
                const summary = `Task completed with user-approved degraded output: ${degradedOutput.degradedArtifacts.join(', ')}`;
                if (input.emitFinishedStatus) {
                    deps.reporter.status('finished');
                }
                deps.reporter.finished({
                    summary,
                    artifactsCreated: mergedArtifacts,
                    duration: 0,
                });
                return {
                    success: true,
                    summary,
                    artifactsCreated: mergedArtifacts,
                };
            }

            deps.reporter.failed({
                error: unmetMessage,
                errorCode: input.artifactFailureErrorCode,
                recoverable: true,
                suggestion: degradedOutput.hasDegradedOutput
                    ? input.artifactFailureSuggestionPrefix.replace(
                        '{artifacts}',
                        degradedOutput.degradedArtifacts.join(', ')
                    )
                    : input.missingArtifactSuggestionPrefix.replace(
                        '{artifacts}',
                        mergedArtifacts.join(', ') || 'none'
                    ),
            });

            if (input.learnOnArtifactFailure && deps.quickLearnFromError) {
                try {
                    await deps.quickLearnFromError(`${unmetMessage}. Query: ${userMessage}`, userMessage, 1);
                } catch {
                    // Best effort only.
                }
            }

            return {
                success: false,
                summary: '',
                error: unmetMessage,
                artifactsCreated: mergedArtifacts,
            };
        }

        const finalAssistantText = deps.session.getLatestAssistantResponseText() || 'Task completed';
        const reducedPresentation = deps.reduceWorkResult({
            canonicalResult: finalAssistantText,
            request: frozenWorkRequest,
            artifacts: mergedArtifacts,
        });
        const finalSummary = reducedPresentation.uiSummary || reducedPresentation.canonicalResult || 'Task completed';
        deps.markWorkRequestExecutionCompleted(preparedWorkRequest, finalSummary);
        if (input.emitFinishedStatus) {
            deps.reporter.status('finished');
        }
        deps.reporter.finished({
            summary: finalSummary,
            artifactsCreated: mergedArtifacts,
            duration: input.emitFinishedStatus ? 0 : Date.now() - startedAt,
        });
        return {
            success: true,
            summary: finalSummary,
            artifactsCreated: mergedArtifacts,
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        deps.markWorkRequestExecutionFailed(preparedWorkRequest, errorMessage);
        deps.reporter.failed({
            error: errorMessage,
            errorCode: input.modelErrorCode,
            recoverable: false,
            suggestion:
                errorMessage === 'missing_api_key'
                    ? 'Set API key in environment or .coworkany/settings.json'
                    : errorMessage === 'missing_base_url'
                        ? 'Set base URL in environment or .coworkany/settings.json'
                        : undefined,
        });
        return {
            success: false,
            summary: '',
            error: errorMessage,
            artifactsCreated: [],
        };
    }
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md']);

type SupportedFileKind = 'images' | 'videos' | 'documents';

type DirectoryEntry = {
    name: string;
    path?: string;
    isDir: boolean;
    size?: number;
};

type FileHashResult = {
    success?: boolean;
    hash?: string;
    error?: string;
};

type MatchedFile = {
    name: string;
    relativePath: string;
    extension: string;
};

function normalizeExtension(fileName: string): string {
    const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
    return match?.[1] || 'other';
}

function isImageFile(fileName: string): boolean {
    return IMAGE_EXTENSIONS.has(normalizeExtension(fileName));
}

function isVideoFile(fileName: string): boolean {
    return VIDEO_EXTENSIONS.has(normalizeExtension(fileName));
}

function isDocumentFile(fileName: string): boolean {
    return DOCUMENT_EXTENSIONS.has(normalizeExtension(fileName));
}

function getSupportedFileKind(fileKinds: string[]): SupportedFileKind | null {
    if (fileKinds.includes('images')) {
        return 'images';
    }
    if (fileKinds.includes('videos')) {
        return 'videos';
    }
    if (fileKinds.includes('documents')) {
        return 'documents';
    }
    return null;
}

function isMatchingFileKind(fileKind: SupportedFileKind, fileName: string): boolean {
    switch (fileKind) {
        case 'images':
            return isImageFile(fileName);
        case 'videos':
            return isVideoFile(fileName);
        case 'documents':
            return isDocumentFile(fileName);
    }
}

function getKindRootFolderName(fileKind: SupportedFileKind): string {
    switch (fileKind) {
        case 'images':
            return 'Images';
        case 'videos':
            return 'Videos';
        case 'documents':
            return 'Documents';
    }
}

function getKindLabelPlural(fileKind: SupportedFileKind): string {
    switch (fileKind) {
        case 'images':
            return 'image files';
        case 'videos':
            return 'video files';
        case 'documents':
            return 'document files';
    }
}

function summarizeNames(names: string[], limit = 5): string {
    if (names.length <= limit) {
        return names.join(', ');
    }
    return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

function getPrimaryLocalTaskHint(preparedWorkRequest: PreparedWorkRequestContext): LocalTaskPlanHint | undefined {
    return preparedWorkRequest.frozenWorkRequest.tasks[0]?.localPlanHint;
}

function getEntryRelativePath(entry: DirectoryEntry): string {
    return entry.path || entry.name;
}

function listTopLevelFilesByKind(
    listing: DirectoryEntry[],
    fileKind: SupportedFileKind
): MatchedFile[] {
    return listing
        .filter((entry) => !entry.isDir && isMatchingFileKind(fileKind, entry.name))
        .map((entry) => ({
            name: entry.name,
            relativePath: getEntryRelativePath(entry),
            extension: normalizeExtension(entry.name).toUpperCase(),
        }));
}

function buildListDirArgs(targetPath: string, traversalScope: LocalTaskPlanHint['traversalScope']): Record<string, unknown> {
    return traversalScope === 'recursive'
        ? { path: targetPath, recursive: true, max_depth: 16 }
        : { path: targetPath };
}

async function tryExecuteDeterministicLocalWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps): Promise<ExecutionRuntimeResult | null> {
    const localHint = getPrimaryLocalTaskHint(input.preparedWorkRequest);
    const targetPath = localHint?.targetFolder?.resolvedPath;
    const fileKind = localHint ? getSupportedFileKind(localHint.fileKinds) : null;

    if (!localHint || !targetPath || !fileKind) {
        return null;
    }

    switch (localHint.intent) {
        case 'inspect_folder':
            return executeInspectFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        case 'organize_files':
            return executeOrganizeFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        case 'deduplicate_files':
            return executeDeduplicateFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        case 'delete_files':
            return executeDeleteFilesWorkflow(input, deps, targetPath, fileKind, localHint.traversalScope);
        default:
            return null;
    }
}

async function executeInspectFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, 'Failed to inspect the target folder.');
    }

    const matchingFiles = (listing as DirectoryEntry[])
        .filter((entry) => !entry.isDir && isMatchingFileKind(fileKind, entry.name))
        .map((entry) => entry.name);
    const kindLabel = getKindLabelPlural(fileKind);
    const scopeLabel = traversalScope === 'recursive' ? 'recursive' : 'top-level';

    const summary = matchingFiles.length === 0
        ? `No ${scopeLabel} ${kindLabel} were found in ${targetPath}.`
        : `Found ${matchingFiles.length} ${scopeLabel} ${kindLabel} in ${targetPath}: ${summarizeNames(matchingFiles)}.`;

    return completeDeterministicWorkflow(input, deps, summary);
}

async function executeOrganizeFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, 'Failed to inspect the target folder.');
    }

    const matchingFiles = listTopLevelFilesByKind(listing as DirectoryEntry[], fileKind);
    const kindLabel = getKindLabelPlural(fileKind);

    if (matchingFiles.length === 0) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `No ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} were found in ${targetPath}, so nothing was reorganized.`
        );
    }

    const categoryRoot = path.join(targetPath, getKindRootFolderName(fileKind));
    const categories = Array.from(new Set(matchingFiles.map((file) => file.extension)));
    for (const category of categories) {
        const result = await deps.executeTool(
            input.taskId,
            'create_directory',
            { path: path.join(categoryRoot, category) },
            { workspacePath: input.workspacePath }
        );

        if (result?.error) {
            return failDeterministicWorkflow(
                input,
                deps,
                `Failed to create destination folder for ${category}: ${result.error}`
            );
        }
    }

    const moves = matchingFiles.map((file) => ({
        source_path: path.join(targetPath, file.relativePath),
        destination_path: path.join(categoryRoot, file.extension, file.relativePath),
    }));
    const moveResult = await deps.executeTool(
        input.taskId,
        'batch_move_files',
        { moves },
        { workspacePath: input.workspacePath }
    );

    if (moveResult?.error || moveResult?.success === false) {
        const failedMoves = Array.isArray(moveResult?.results)
            ? moveResult.results.filter((result: any) => result.success === false)
            : [];
        const errorMessage = failedMoves.length > 0
            ? failedMoves.map((result: any) => result.error).join('; ')
            : moveResult?.error || 'Unknown move failure';
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to organize image files: ${errorMessage}`
        );
    }

    const verifyResult = await deps.executeTool(
        input.taskId,
        'list_dir',
        { path: categoryRoot },
        { workspacePath: input.workspacePath }
    );
    const createdFolders = Array.isArray(verifyResult)
        ? (verifyResult as DirectoryEntry[]).filter((entry) => entry.isDir).map((entry) => entry.name)
        : categories;

    return completeDeterministicWorkflow(
        input,
        deps,
        `Organized ${matchingFiles.length} ${kindLabel} from ${targetPath} into ${categoryRoot}. Created folders: ${createdFolders.join(', ')}.`
    );
}

async function executeDeduplicateFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, 'Failed to inspect the target folder.');
    }

    const matchingFiles = listTopLevelFilesByKind(listing as DirectoryEntry[], fileKind);
    const kindLabel = getKindLabelPlural(fileKind);
    if (matchingFiles.length < 2) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `Found fewer than two ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} in ${targetPath}, so there were no duplicates to quarantine.`
        );
    }

    const hashGroups = new Map<string, MatchedFile[]>();
    for (const file of matchingFiles) {
        const hashResult = await deps.executeTool(
            input.taskId,
            'compute_file_hash',
            { path: path.join(targetPath, file.relativePath) },
            { workspacePath: input.workspacePath }
        ) as FileHashResult;

        if (!hashResult?.hash) {
            return failDeterministicWorkflow(
                input,
                deps,
                `Failed to hash ${file.relativePath}: ${hashResult?.error || 'unknown hash error'}`
            );
        }

        const group = hashGroups.get(hashResult.hash) ?? [];
        group.push(file);
        hashGroups.set(hashResult.hash, group);
    }

    const duplicateGroups = Array.from(hashGroups.entries()).filter(([, files]) => files.length > 1);
    if (duplicateGroups.length === 0) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `No duplicate top-level ${kindLabel} were found in ${targetPath}.`
        );
    }

    const quarantineRoot = path.join(targetPath, 'Duplicates');
    const quarantineResult = await deps.executeTool(
        input.taskId,
        'create_directory',
        { path: quarantineRoot },
        { workspacePath: input.workspacePath }
    );

    if (quarantineResult?.error) {
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to create duplicate quarantine folder: ${quarantineResult.error}`
        );
    }

    const moves = duplicateGroups.flatMap(([hash, files]) => {
        const quarantineFolder = path.join(quarantineRoot, hash.slice(0, 12));
        return files.slice(1).map((file) => ({
            source_path: path.join(targetPath, file.relativePath),
            destination_path: path.join(quarantineFolder, file.relativePath),
        }));
    });

    const moveResult = await deps.executeTool(
        input.taskId,
        'batch_move_files',
        { moves },
        { workspacePath: input.workspacePath }
    );

    if (moveResult?.error || moveResult?.success === false) {
        const failedMoves = Array.isArray(moveResult?.results)
            ? moveResult.results.filter((result: any) => result.success === false)
            : [];
        const errorMessage = failedMoves.length > 0
            ? failedMoves.map((result: any) => result.error).join('; ')
            : moveResult?.error || 'Unknown move failure';
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to quarantine duplicate ${kindLabel}: ${errorMessage}`
        );
    }

    const verifyResult = await deps.executeTool(
        input.taskId,
        'list_dir',
        { path: quarantineRoot },
        { workspacePath: input.workspacePath }
    );
    const quarantineFolders = Array.isArray(verifyResult)
        ? (verifyResult as DirectoryEntry[]).filter((entry) => entry.isDir).map((entry) => entry.name)
        : duplicateGroups.map(([hash]) => hash.slice(0, 12));

    return completeDeterministicWorkflow(
        input,
        deps,
        `Quarantined ${moves.length} duplicate ${kindLabel} across ${duplicateGroups.length} duplicate groups from ${targetPath} into ${quarantineRoot}. Created folders: ${quarantineFolders.join(', ')}.`
    );
}

async function executeDeleteFilesWorkflow(input: {
    taskId: string;
    workspacePath: string;
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, targetPath: string, fileKind: SupportedFileKind, traversalScope: LocalTaskPlanHint['traversalScope']): Promise<ExecutionRuntimeResult> {
    const listing = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );

    if (!Array.isArray(listing)) {
        return failDeterministicWorkflow(input, deps, 'Failed to inspect the target folder.');
    }

    const matchingFiles = listTopLevelFilesByKind(listing as DirectoryEntry[], fileKind);
    const kindLabel = getKindLabelPlural(fileKind);
    if (matchingFiles.length === 0) {
        return completeDeterministicWorkflow(
            input,
            deps,
            `No ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} were found in ${targetPath}, so nothing was deleted.`
        );
    }

    const deleteResult = await deps.executeTool(
        input.taskId,
        'batch_delete_paths',
        {
            deletes: matchingFiles.map((file) => ({
                path: path.join(targetPath, file.relativePath),
            })),
        },
        { workspacePath: input.workspacePath }
    );

    if (deleteResult?.error || deleteResult?.success === false) {
        const failedDeletes = Array.isArray(deleteResult?.results)
            ? deleteResult.results.filter((result: any) => result.success === false)
            : [];
        const errorMessage = failedDeletes.length > 0
            ? failedDeletes.map((result: any) => result.error).join('; ')
            : deleteResult?.error || 'Unknown delete failure';
        return failDeterministicWorkflow(
            input,
            deps,
            `Failed to delete ${kindLabel}: ${errorMessage}`
        );
    }

    const verifyResult = await deps.executeTool(
        input.taskId,
        'list_dir',
        buildListDirArgs(targetPath, traversalScope),
        { workspacePath: input.workspacePath }
    );
    const remainingImageFiles = Array.isArray(verifyResult)
        ? (verifyResult as DirectoryEntry[])
            .filter((entry) => !entry.isDir && isMatchingFileKind(fileKind, entry.name))
            .map((entry) => entry.name)
        : [];

    const deletedNames = matchingFiles.map((file) => file.name);
    return completeDeterministicWorkflow(
        input,
        deps,
        remainingImageFiles.length === 0
            ? `Deleted ${deletedNames.length} ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} from ${targetPath}: ${summarizeNames(deletedNames)}.`
            : `Deleted ${deletedNames.length} ${traversalScope === 'recursive' ? 'recursive' : 'top-level'} ${kindLabel} from ${targetPath}, but ${remainingImageFiles.length} ${kindLabel} remain: ${summarizeNames(remainingImageFiles)}.`
    );
}

function completeDeterministicWorkflow(input: {
    preparedWorkRequest: PreparedWorkRequestContext;
    startedAt: number;
    emitFinishedStatus: boolean;
}, deps: ExecutionRuntimeDeps, summary: string): ExecutionRuntimeResult {
    deps.markWorkRequestExecutionCompleted(input.preparedWorkRequest, summary);
    if (input.emitFinishedStatus) {
        deps.reporter.status('finished');
    }
    deps.reporter.finished({
        summary,
        duration: input.emitFinishedStatus ? 0 : Date.now() - input.startedAt,
    });
    return {
        success: true,
        summary,
        artifactsCreated: [],
    };
}

function failDeterministicWorkflow(input: {
    preparedWorkRequest: PreparedWorkRequestContext;
}, deps: ExecutionRuntimeDeps, errorMessage: string): ExecutionRuntimeResult {
    deps.markWorkRequestExecutionFailed(input.preparedWorkRequest, errorMessage);
    deps.reporter.failed({
        error: errorMessage,
        errorCode: 'LOCAL_WORKFLOW_ERROR',
        recoverable: false,
    });
    return {
        success: false,
        summary: '',
        error: errorMessage,
        artifactsCreated: [],
    };
}
