import { type PreparedWorkRequestContext } from '../orchestration/workRequestRuntime';
import { type ToolDefinition } from '../tools/standard';
import { type ExecutionResultReporter } from './resultReporter';
import { type ExecutionSession } from './session';

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
