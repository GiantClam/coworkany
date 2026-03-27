import type { ConfirmationPolicy, IpcCommand, IpcResponse } from '../protocol';
import type { ArtifactContract } from '../agent/artifactContract';
import type {
    CheckpointContract,
    DefaultingPolicy,
    DeliverableContract,
    FrozenWorkRequest,
    HitlPolicy,
    IntentRouting,
    MemoryIsolationPolicy,
    MissingInfoItem,
    ResumeStrategy,
    RuntimeIsolationPolicy,
    SessionIsolationPolicy,
    TenantIsolationPolicy,
    UserActionRequest,
} from '../orchestration/workRequestSchema';
import {
    snapshotFrozenWorkRequest,
    type FrozenWorkRequestSnapshot,
    type SupersededContractTombstone,
} from '../orchestration/workRequestSnapshot';
import { assertWorkspaceOverrideAllowed } from '../execution/taskIsolationPolicyStore';
import { parseInlineAttachmentContent } from '../llm/attachmentContent';
import {
    buildBlockingUserActionMessage,
    buildPlanUpdatedPayload,
    planScheduledExecutionStages,
    buildResearchUpdatedPayload,
    buildWorkRequestPlanSummary,
    getBlockingCheckpoint,
    getBlockingUserAction,
} from '../orchestration/workRequestRuntime';

function respond(commandId: string, type: string, payload: Record<string, unknown>): IpcResponse {
    return {
        commandId,
        timestamp: new Date().toISOString(),
        type,
        payload,
    } as IpcResponse;
}

function validateWorkspaceOverride(taskId: string, payloadConfig: unknown): string | null {
    if (!payloadConfig || typeof payloadConfig !== 'object') {
        return null;
    }

    const candidateWorkspacePath = (payloadConfig as { workspacePath?: unknown }).workspacePath;
    if (typeof candidateWorkspacePath !== 'string' || candidateWorkspacePath.trim().length === 0) {
        return null;
    }

    return assertWorkspaceOverrideAllowed(taskId, candidateWorkspacePath);
}

const MAX_SUPERSEDED_CONTRACT_TOMBSTONES = 20;

function snapshotsMatch(
    left?: FrozenWorkRequestSnapshot,
    right?: FrozenWorkRequestSnapshot,
): boolean {
    if (!left || !right) {
        return false;
    }
    return JSON.stringify(left) === JSON.stringify(right);
}

function coerceSupersededContractTombstones(value: unknown): SupersededContractTombstone[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') {
            return [];
        }
        const candidate = entry as Partial<SupersededContractTombstone>;
        if (
            candidate.reason !== 'contract_refreeze'
            || typeof candidate.supersededAt !== 'string'
            || !candidate.snapshot
            || typeof candidate.snapshot !== 'object'
        ) {
            return [];
        }

        return [{
            reason: 'contract_refreeze' as const,
            supersededAt: candidate.supersededAt,
            snapshot: candidate.snapshot as FrozenWorkRequestSnapshot,
        }];
    });
}

function appendSupersededContractTombstone(
    config: Record<string, unknown>,
    previousSnapshot: FrozenWorkRequestSnapshot | undefined,
    nextSnapshot: FrozenWorkRequestSnapshot,
): Record<string, unknown> {
    const existing = coerceSupersededContractTombstones(config.supersededContractTombstones);
    if (!previousSnapshot || snapshotsMatch(previousSnapshot, nextSnapshot)) {
        return existing.length > 0
            ? {
                ...config,
                supersededContractTombstones: existing.slice(-MAX_SUPERSEDED_CONTRACT_TOMBSTONES),
            }
            : config;
    }

    return {
        ...config,
        supersededContractTombstones: [
            ...existing,
            {
                reason: 'contract_refreeze',
                supersededAt: new Date().toISOString(),
                snapshot: previousSnapshot,
            },
        ].slice(-MAX_SUPERSEDED_CONTRACT_TOMBSTONES),
    };
}

export type RuntimeCommandDeps = {
    emit: (message: Record<string, unknown>) => void;
    onBootstrapRuntimeContext: (runtimeContext: unknown) => void;
    restorePersistedTasks: () => void;
    getRuntimeSnapshot: () => {
        generatedAt: string;
        activeTaskId?: string;
        tasks: Array<{
            taskId: string;
            title: string;
            workspacePath: string;
            createdAt: string;
            status: 'running' | 'idle' | 'finished' | 'failed' | 'interrupted' | 'suspended';
            suspended?: boolean;
            suspensionReason?: string;
        }>;
        count: number;
    };
    runDoctorPreflight: (input?: {
        startupProfile?: string;
        readinessReportPath?: string;
        controlPlaneThresholdProfile?: string;
        incidentLogPaths?: string[];
        outputDir?: string;
    }) => {
        report: unknown;
        markdown: string;
        reportPath?: string;
        markdownPath?: string;
    };
    executeFreshTask: (args: any) => Promise<unknown>;
    ensureTaskRuntimePersistence: (input: {
        taskId: string;
        title: string;
        workspacePath: string;
    }) => void;
    cancelTaskExecution: (taskId: string, reason?: string) => Promise<{ success: boolean }>;
    cancelScheduledTasksForSourceTask: (input: {
        sourceTaskId: string;
        userMessage: string;
    }) => Promise<{
        success: boolean;
        cancelledCount: number;
        cancelledTitles: string[];
    }>;
    createTaskFailedEvent: (taskId: string, payload: {
        error: string;
        errorCode?: string;
        recoverable: boolean;
        suggestion?: string;
    }) => Record<string, unknown>;
    createChatMessageEvent: (taskId: string, payload: {
        role: 'assistant' | 'system' | 'user';
        content: string;
    }) => Record<string, unknown>;
    createTaskClarificationRequiredEvent: (taskId: string, payload: {
        reason?: string;
        questions: string[];
        missingFields?: string[];
        clarificationType?: 'missing_info' | 'route_disambiguation' | 'task_draft_confirmation';
        routeChoices?: Array<{
            id: 'chat' | 'immediate_task';
            label: string;
            value: string;
        }>;
        intentRouting?: IntentRouting;
    }) => Record<string, unknown>;
    createTaskContractReopenedEvent: (taskId: string, payload: {
        summary: string;
        reason: string;
        trigger: 'new_scope_signal' | 'missing_resource' | 'permission_block' | 'contradictory_evidence' | 'execution_infeasible';
        reasons?: string[];
        diff?: {
            changedFields: Array<'mode' | 'objective' | 'deliverables' | 'execution_targets' | 'workflow'>;
            modeChanged?: { before: string; after: string };
            objectiveChanged?: { before: string; after: string };
            deliverablesChanged?: { before: string[]; after: string[] };
            targetsChanged?: { before: string[]; after: string[] };
            workflowsChanged?: { before: string[]; after: string[] };
        };
        nextStepId?: string;
    }) => Record<string, unknown>;
    createTaskPlanReadyEvent: (taskId: string, payload: {
        summary: string;
        mode?: 'chat' | 'immediate_task' | 'scheduled_task' | 'scheduled_multi_task';
        intentRouting?: IntentRouting;
        taskDraftRequired?: boolean;
        tasks?: Array<{
            id: string;
            title: string;
            objective: string;
            dependencies: string[];
        }>;
        deliverables: DeliverableContract[];
        checkpoints: Array<{
            id: string;
            title: string;
            kind: 'review' | 'manual_action' | 'pre_delivery';
            reason: string;
            userMessage: string;
            riskTier: 'low' | 'medium' | 'high';
            executionPolicy: 'auto' | 'review_required' | 'hard_block';
            requiresUserConfirmation: boolean;
            blocking: boolean;
        }>;
        userActionsRequired: Array<{
            id: string;
            title: string;
            kind: 'clarify_input' | 'confirm_plan' | 'manual_step' | 'external_auth';
            description: string;
            riskTier: 'low' | 'medium' | 'high';
            executionPolicy: 'auto' | 'review_required' | 'hard_block';
            blocking: boolean;
            questions: string[];
            instructions: string[];
            fulfillsCheckpointId?: string;
        }>;
        hitlPolicy?: HitlPolicy;
        runtimeIsolationPolicy?: RuntimeIsolationPolicy;
        sessionIsolationPolicy?: SessionIsolationPolicy;
        memoryIsolationPolicy?: MemoryIsolationPolicy;
        tenantIsolationPolicy?: TenantIsolationPolicy;
        missingInfo: Array<{
            field: string;
            reason: string;
            blocking: boolean;
            question?: string;
            defaultValue?: string;
        }>;
        defaultingPolicy?: {
            outputLanguage: string;
            uiFormat: 'chat_message' | 'table' | 'report' | 'artifact';
            artifactDirectory: string;
            checkpointStrategy: 'none' | 'review_before_completion' | 'manual_action';
        };
        resumeStrategy?: {
            mode: 'continue_from_saved_context';
            preserveDeliverables: boolean;
            preserveCompletedSteps: boolean;
            preserveArtifacts: boolean;
        };
    }) => Record<string, unknown>;
    createTaskResearchUpdatedEvent: (taskId: string, payload: {
        summary: string;
        sourcesChecked: string[];
        completedQueries: number;
        pendingQueries: number;
        blockingUnknowns: string[];
        selectedStrategyTitle?: string;
    }) => Record<string, unknown>;
    createPlanUpdatedEvent: (taskId: string, payload: {
        summary: string;
        steps: Array<{
            id: string;
            description: string;
            status: 'pending' | 'in_progress' | 'complete' | 'completed' | 'skipped' | 'failed' | 'blocked';
        }>;
        taskProgress?: Array<{
            taskId: string;
            title: string;
            status: 'pending' | 'in_progress' | 'complete' | 'completed' | 'skipped' | 'failed' | 'blocked';
            dependencies: string[];
        }>;
        currentStepId?: string;
    }) => Record<string, unknown>;
    createTaskCheckpointReachedEvent: (taskId: string, payload: {
        checkpointId: string;
        title: string;
        kind: 'review' | 'manual_action' | 'pre_delivery';
        reason: string;
        userMessage: string;
        riskTier: 'low' | 'medium' | 'high';
        executionPolicy: 'auto' | 'review_required' | 'hard_block';
        requiresUserConfirmation: boolean;
        blocking: boolean;
    }) => Record<string, unknown>;
    createTaskUserActionRequiredEvent: (taskId: string, payload: {
        actionId: string;
        title: string;
        kind: 'clarify_input' | 'confirm_plan' | 'manual_step' | 'external_auth';
        description: string;
        riskTier: 'low' | 'medium' | 'high';
        executionPolicy: 'auto' | 'review_required' | 'hard_block';
        blocking: boolean;
        questions: string[];
        instructions: string[];
        fulfillsCheckpointId?: string;
        authUrl?: string;
        authDomain?: string;
        canAutoResume?: boolean;
    }) => Record<string, unknown>;
    createTaskStatusEvent: (taskId: string, payload: {
        status: 'running' | 'failed' | 'idle' | 'finished';
    }) => Record<string, unknown>;
    createTaskResumedEvent: (taskId: string, payload: {
        resumeReason?: string;
        suspendDurationMs: number;
    }) => Record<string, unknown>;
    createTaskFinishedEvent: (taskId: string, payload: {
        summary: string;
        duration: number;
        artifactsCreated?: string[];
        filesModified?: string[];
    }) => Record<string, unknown>;
    taskSessionStore: {
        clearConversation: (taskId: string) => void;
        ensureHistoryLimit: (taskId: string) => void;
        setHistoryLimit: (taskId: string, limit: number) => void;
        setConfig: (taskId: string, config: any) => void;
        getConfig: (taskId: string) => any;
        getConversation: (taskId: string) => Array<{ role?: string; content?: unknown }>;
        getArtifactContract: (taskId: string) => unknown;
        setArtifactContract: (taskId: string, contract: any) => any;
    };
    taskEventBus: {
        emitRaw: (taskId: string, type: string, payload: unknown) => void;
        emitChatMessage: (taskId: string, payload: { role: 'assistant' | 'system' | 'user'; content: string }) => void;
        emitStatus: (taskId: string, payload: { status: 'running' | 'failed' | 'idle' | 'finished' }) => void;
        reset: (taskId: string) => void;
        emitStarted: (taskId: string, payload: { title: string; description?: string; context: { workspacePath?: string; userQuery: string } }) => void;
        emitFinished: (taskId: string, payload: { summary: string; duration: number }) => void;
    };
    suspendResumeManager: {
        isSuspended: (taskId: string) => boolean;
        getSuspendedTask?: (taskId: string) => { context?: Record<string, unknown> } | undefined;
        resume: (taskId: string, reason: string) => Promise<{ success: boolean; context?: Record<string, unknown> }>;
    };
    openAuthPageForSuspendedTask?: (input: {
        taskId: string;
        url: string;
    }) => Promise<{ success: boolean; error?: string }>;
    enqueueResumeMessage: (taskId: string, content: string, config?: Record<string, unknown>) => void;
    getTaskConfig: (taskId: string) => any;
    applyFrozenWorkRequestSessionPolicy?: (taskId: string, frozenWorkRequest: FrozenWorkRequest, baseConfig?: any) => any;
    getActivePreparedWorkRequest?: (taskId: string) => {
        frozenWorkRequest: FrozenWorkRequest;
    } | undefined;
    workspaceRoot: string;
    workRequestStore: any;
    prepareWorkRequestContext: (input: any) => Promise<any>;
    buildArtifactContract: (query: string, deliverables?: DeliverableContract[]) => ArtifactContract;
    buildClarificationMessage: (frozenWorkRequest: any) => string;
    pushConversationMessage: (taskId: string, message: { role: 'user' | 'assistant'; content: string | Array<Record<string, unknown>> }) => any;
    shouldUsePlanningFiles: (frozenWorkRequest: any) => boolean;
    appendPlanningProgressEntry: (workspacePath: string, entry: string) => void;
    scheduleTaskInternal: (input: any) => any;
    buildScheduledConfirmationMessage: (record: any) => string;
    toScheduledTaskConfig: (config: unknown) => unknown;
    markWorkRequestExecutionStarted: (preparedWorkRequest: any) => void;
    continuePreparedAgentFlow: (input: any, deps: any) => Promise<unknown>;
    getExecutionRuntimeDeps: (taskId: string) => unknown;
    runPostEditHooks: (workspacePath: string, filePath: string, content: string | undefined) => unknown[];
    formatHookResults: (results: any) => string;
    loadLlmConfig: (workspaceRoot: string) => any;
    resolveProviderConfig: (llmConfig: any, options: any) => any;
    autonomousLlmAdapter: {
        setProviderConfig: (config: any) => void;
    };
    getAutonomousAgent: (taskId: string) => {
        startTask: (query: string, options: {
            autoSaveMemory: boolean;
            notifyOnComplete: boolean;
            runInBackground: boolean;
            sessionTaskId?: string;
            workspacePath?: string;
        }) => Promise<any>;
        getTask: (taskId: string) => any;
        pauseTask: (taskId: string) => boolean;
        resumeTask: (taskId: string, userInput?: Record<string, string>) => Promise<void>;
        cancelTask: (taskId: string) => boolean;
        getAllTasks: () => any[];
    };
    stopVoicePlayback: (reason?: string) => Promise<boolean>;
    getVoicePlaybackState: () => unknown;
    getVoiceProviderStatus: (providerMode?: 'auto' | 'system' | 'custom') => unknown;
    transcribeWithCustomAsr: (input: {
        audioBase64: string;
        mimeType?: string;
        language?: string;
        providerMode?: 'auto' | 'system' | 'custom';
    }) => Promise<{
        success: boolean;
        text?: string;
        providerId?: string;
        providerName?: string;
        error?: string;
    }>;
};

function extractMessageText(content: unknown): string {
    if (typeof content === 'string') {
        return content.trim();
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .map((block: any) => {
            if (typeof block?.text === 'string') {
                return block.text;
            }
            if (block?.type === 'text' && typeof block?.content === 'string') {
                return block.content;
            }
            return '';
        })
        .join(' ')
        .trim();
}

function isResumeControlMessage(text: string): boolean {
    return text.startsWith('[System Notification]') ||
        text.startsWith('[RESUMED]') ||
        text.startsWith('[SUSPENDED]') ||
        text.startsWith('[RESUME_REQUESTED]');
}

function getLatestMeaningfulUserMessage(
    conversation: Array<{ role?: string; content?: unknown }>
): string {
    for (let index = conversation.length - 1; index >= 0; index -= 1) {
        const message = conversation[index];
        if (message?.role !== 'user') {
            continue;
        }

        const text = extractMessageText(message.content);
        if (!text || isResumeControlMessage(text)) {
            continue;
        }

        return text;
    }

    return '';
}

function getLatestMeaningfulAssistantMessage(
    conversation: Array<{ role?: string; content?: unknown }>
): string {
    for (let index = conversation.length - 1; index >= 0; index -= 1) {
        const message = conversation[index];
        if (message?.role !== 'assistant') {
            continue;
        }

        const text = extractMessageText(message.content);
        if (!text) {
            continue;
        }

        return text;
    }

    return '';
}

function shouldAugmentFollowUpPrompt(input: {
    promptText: string;
    previousUserMessage: string;
    latestAssistantMessage: string;
}): boolean {
    const trimmed = input.promptText.trim();
    if (!trimmed || trimmed.length >= 8) {
        return false;
    }

    if (!input.previousUserMessage || !input.latestAssistantMessage) {
        return false;
    }

    if (/^(hi|hello|hey|你好|您好|在吗|thanks|thank you|谢谢|收到|ok|好的)[.!?？。!]*$/i.test(trimmed)) {
        return false;
    }

    const looksLikeCompactIdentifier = /^[A-Za-z0-9][A-Za-z0-9._\-\/]{0,31}$/.test(trimmed);
    const assistantAskedForMoreInput =
        /(请|provide|specify|exact|继续|补充|发我|给我|代码|code|ticker|symbol|which|what|股票|港股)/i
            .test(input.latestAssistantMessage);

    return looksLikeCompactIdentifier || assistantAskedForMoreInput;
}

function detectFollowUpLanguage(text: string): 'zh' | 'en' {
    return /[\u4e00-\u9fff]/.test(text) ? 'zh' : 'en';
}

const UUID_V4_TOKEN_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GENERIC_OPAQUE_TOKEN_REGEX = /^[a-z0-9][a-z0-9._:-]{11,}$/i;
const CONTROL_REPLY_WITH_TOKEN_REGEX = /^(确认|确认发布|同意|批准|继续执行|开始执行|按这个方案继续|按该方案继续|就按这个方案|可以执行了|继续处理|继续吧|继续|接着|往下|好的|ok|okay|yes|go ahead|proceed|approve|approved?|looks good(?:,?\s*continue)?|ship it|continue|go on|carry on|keep going)\s*[（(]([^()（）]+)[）)]\s*([.!?？。!]*)$/i;

function isOpaqueControlToken(value: string): boolean {
    const token = value.trim();
    if (!token || /\s/.test(token)) {
        return false;
    }
    if (UUID_V4_TOKEN_REGEX.test(token)) {
        return true;
    }
    if (!GENERIC_OPAQUE_TOKEN_REGEX.test(token)) {
        return false;
    }
    return /\d/.test(token) || token.includes('-') || token.includes('_');
}

function normalizeFollowUpControlText(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) {
        return '';
    }

    const match = trimmed.match(CONTROL_REPLY_WITH_TOKEN_REGEX);
    if (!match) {
        return trimmed;
    }

    const [, command, token, punctuation = ''] = match;
    if (!isOpaqueControlToken(token)) {
        return trimmed;
    }

    return `${command}${punctuation}`.trim();
}

function isPlanApprovalReply(text: string): boolean {
    return /^(?:确认|确认发布|同意|批准|继续执行|开始执行|按这个方案继续|按该方案继续|就按这个方案|可以执行了|go ahead|proceed|approve|approved?|looks good(?:,?\s*continue)?|ship it|yes|ok|okay|好的)[.!?？。!]*$/i
        .test(text.trim());
}

function isCompactApprovalSelectionReply(text: string): boolean {
    return /^(?:(?:选项?\s*)?[1-9]|[1-9][.)、]|[A-Ca-c][.)]?|选[一二三])[.!?？。!]*$/
        .test(text.trim());
}

function isGenericContinueReply(text: string): boolean {
    return /^(?:继续|继续处理|继续执行|接着|往下|继续吧|continue|go on|carry on|keep going)[.!?？。!]*$/i
        .test(text.trim());
}

function isScheduledCancellationRequest(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    const chineseExplicitCancel = /(?:取消|停止|终止|结束|关闭|关掉|停掉).*(?:提醒|定时|任务|闹钟|计划|上述|这个|该)/u;
    if (chineseExplicitCancel.test(trimmed)) {
        return true;
    }

    const chineseShortCancel = /^(?:取消|停止|终止|结束)(?:上述|这个|该)?任务$/u;
    if (chineseShortCancel.test(trimmed)) {
        return true;
    }

    if (/\b(cancel|stop|abort|terminate)\b/i.test(trimmed) && /\b(reminder|scheduled?|task)\b/i.test(trimmed)) {
        return true;
    }

    return false;
}

function isTaskHistoryClearRequest(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    const chineseClearHistory = /(?:清空|清除|删除|重置).*(?:任务|会话|对话)?(?:历史|记录|上下文)/u;
    if (chineseClearHistory.test(trimmed)) {
        return true;
    }

    const chineseCompactClearHistory = /^(?:清空|清除|删除|重置)(?:当前|这个|该)?(?:任务)?(?:历史|记录|上下文)$/u;
    if (chineseCompactClearHistory.test(trimmed)) {
        return true;
    }

    const englishClearHistory = /\b(clear|reset|wipe|delete)\b/i.test(trimmed)
        && /\b(task|chat|conversation|history|context)\b/i.test(trimmed);
    if (englishClearHistory) {
        return true;
    }

    return false;
}

function isResumeInterruptedTaskRequest(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    const chineseResumeInterrupted =
        /(?:恢复|继续|接着).*(?:中断|暂停|上次|之前|刚才).*(?:任务|执行|工作)|(?:恢复|继续)(?:中断|暂停)(?:任务|执行)?/u;
    if (chineseResumeInterrupted.test(trimmed)) {
        return true;
    }

    const englishResumeInterrupted =
        /\b(resume|continue)\b/i.test(trimmed)
        && /\b(interrupted|paused|previous|last)\b/i.test(trimmed)
        && /\b(task|execution|work)\b/i.test(trimmed);
    if (englishResumeInterrupted) {
        return true;
    }

    return false;
}

function extractAutonomousStartIntent(text: string): { query: string } | null {
    const trimmed = text.trim();
    if (!trimmed) {
        return null;
    }

    const chineseMatch = trimmed.match(/^(?:请|帮我)?(?:开始|启动|进入)?(?:自主|自治)(?:模式)?(?:执行|完成)?[：:，,\s-]*(.*)$/u);
    if (chineseMatch) {
        const query = (chineseMatch[1] || '').trim();
        return { query: query.length > 0 ? query : trimmed };
    }

    const englishMatch = trimmed.match(/^(?:please\s+)?(?:start|run|enter|use)\s+autonomous(?:\s+mode)?(?:\s+to)?[,:;\s-]*(.*)$/i);
    if (englishMatch) {
        const query = (englishMatch[1] || '').trim();
        return { query: query.length > 0 ? query : trimmed };
    }

    return null;
}

function assistantPromptedForPlanApproval(text: string): boolean {
    return /(confirm whether coworkany should proceed|reply with approval to continue|requires explicit approval|confirm the execution plan|final authorization|authorization token|confirm publish|please reply.*(?:confirm|approve|go ahead)|确认是否.*(?:继续|执行|发布)|请直接回复.*(?:确认|批准|授权)|回复.*(?:确认|批准|approval|授权)|显式批准|最终授权|授权口令|确认发布|要我(?:现在(?:就)?|这就|就)?按.*(?:设置|执行|开始).*(?:吗|\?|？)|要不要我(?:现在(?:就)?|这就|就)?.*(?:设置|执行|开始))/i
        .test(text);
}

function buildApprovalFollowUpSourceText(input: {
    promptText: string;
    baseObjective: string;
}): string {
    const language = detectFollowUpLanguage(`${input.baseObjective}\n${input.promptText}`);
    const objective = input.baseObjective
        .trim()
        .replace(/^(?:原始任务|original task)\s*[:：]\s*/i, '');

    if (language === 'zh') {
        return [
            `原始任务：${objective}`,
            '用户确认：继续执行',
        ].join('\n');
    }

    return [
        `Original task: ${objective}`,
        'User approval: proceed with execution.',
    ].join('\n');
}

function buildCorrectionFollowUpSourceText(input: {
    promptText: string;
    previousContextText: string;
}): string {
    const previousContextText = input.previousContextText.trim();
    const promptText = input.promptText.trim();
    if (!previousContextText || !promptText) {
        return input.promptText;
    }

    const language = detectFollowUpLanguage(`${previousContextText}\n${promptText}`);
    if (language === 'zh') {
        return [
            `原始任务：${previousContextText}`,
            `用户更正：${promptText}`,
        ].join('\n');
    }

    return [
        `Original task: ${previousContextText}`,
        `User correction: ${promptText}`,
    ].join('\n');
}

const ROUTE_CHAT_TOKEN = '__route_chat__';
const ROUTE_TASK_TOKEN = '__route_task__';
const TASK_DRAFT_CONFIRM_TOKEN = '__task_draft_confirm__';
const TASK_DRAFT_CHAT_TOKEN = '__task_draft_chat__';
const TASK_DRAFT_EDIT_CREATE_PREFIX = '__task_draft_edit_create__:';
const AUTH_OPEN_PAGE_PREFIX = '__auth_open_page__:';

function extractAuthOpenPageUrl(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed || !trimmed.startsWith(AUTH_OPEN_PAGE_PREFIX)) {
        return null;
    }
    const candidate = trimmed.slice(AUTH_OPEN_PAGE_PREFIX.length).trim();
    if (!candidate) {
        return null;
    }
    try {
        const url = new URL(candidate);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return url.toString();
    } catch {
        return null;
    }
}

function buildFollowUpSourceText(input: {
    promptText: string;
    conversation: Array<{ role?: string; content?: unknown }>;
    previousSnapshot?: FrozenWorkRequestSnapshot;
}): string {
    const normalizedPromptText = normalizeFollowUpControlText(input.promptText);
    const previousUserMessage = getLatestMeaningfulUserMessage(input.conversation);
    const latestAssistantMessage = getLatestMeaningfulAssistantMessage(input.conversation);
    const previousPrimaryObjective = input.previousSnapshot?.primaryObjective?.trim();
    const previousContextText =
        input.previousSnapshot?.sourceText?.trim() ||
        previousUserMessage;
    if (previousContextText && normalizedPromptText.trim() === ROUTE_CHAT_TOKEN) {
        return [
            `Original task: ${previousContextText}`,
            'User route: chat',
        ].join('\n');
    }
    if (previousContextText && normalizedPromptText.trim() === ROUTE_TASK_TOKEN) {
        return [
            `Original task: ${previousContextText}`,
            'User route: task',
        ].join('\n');
    }
    if (previousContextText && normalizedPromptText.trim() === TASK_DRAFT_CHAT_TOKEN) {
        return [
            `Original task: ${previousContextText}`,
            'User route: chat',
        ].join('\n');
    }
    const preferFullSourceTextForApproval =
        input.previousSnapshot?.mode === 'scheduled_task'
        || input.previousSnapshot?.mode === 'scheduled_multi_task';
    const approvalBaseObjective = preferFullSourceTextForApproval
        ? (previousContextText || previousPrimaryObjective || previousUserMessage)
        : (previousPrimaryObjective || previousContextText || previousUserMessage);
    const promptedForApproval = assistantPromptedForPlanApproval(latestAssistantMessage);
    const hasCarryForwardDeliverable = (input.previousSnapshot?.deliverables ?? [])
        .some((deliverable) => deliverable.type !== 'chat_reply');
    const shouldCarryForwardScheduledApproval =
        preferFullSourceTextForApproval && isPlanApprovalReply(normalizedPromptText);
    const isApprovalReply =
        isPlanApprovalReply(normalizedPromptText) ||
        (promptedForApproval && isCompactApprovalSelectionReply(normalizedPromptText));
    if (
        approvalBaseObjective &&
        isApprovalReply &&
        (promptedForApproval || hasCarryForwardDeliverable || shouldCarryForwardScheduledApproval)
    ) {
        return buildApprovalFollowUpSourceText({
            promptText: normalizedPromptText,
            baseObjective: approvalBaseObjective,
        });
    }

    if (
        approvalBaseObjective &&
        isGenericContinueReply(normalizedPromptText) &&
        !hasCorrectionCue(normalizedPromptText)
    ) {
        return buildApprovalFollowUpSourceText({
            promptText: normalizedPromptText,
            baseObjective: approvalBaseObjective,
        });
    }

    if (
        approvalBaseObjective &&
        normalizedPromptText.trim() === TASK_DRAFT_CONFIRM_TOKEN
    ) {
        return buildApprovalFollowUpSourceText({
            promptText: normalizedPromptText,
            baseObjective: approvalBaseObjective,
        });
    }

    if (
        normalizedPromptText.trim().startsWith(TASK_DRAFT_EDIT_CREATE_PREFIX)
    ) {
        const editedObjective = normalizedPromptText
            .trim()
            .slice(TASK_DRAFT_EDIT_CREATE_PREFIX.length)
            .trim();
        const objectiveForApproval = editedObjective || approvalBaseObjective || previousContextText;
        if (objectiveForApproval) {
            return buildApprovalFollowUpSourceText({
                promptText: normalizedPromptText,
                baseObjective: objectiveForApproval,
            });
        }
    }

    if (hasCorrectionCue(normalizedPromptText) && previousContextText) {
        return buildCorrectionFollowUpSourceText({
            promptText: normalizedPromptText,
            previousContextText,
        });
    }

    if (!shouldAugmentFollowUpPrompt({
        promptText: normalizedPromptText,
        previousUserMessage,
        latestAssistantMessage,
    })) {
        return normalizedPromptText;
    }

    return [
        `原始任务：${previousUserMessage}`,
        `需要补充：${latestAssistantMessage}`,
        `用户补充：${normalizedPromptText.trim()}`,
    ].join('\n');
}

function buildExecutionQueryFromFrozenWorkRequest(request: {
    tasks?: Array<{
        objective?: string;
        constraints?: string[];
        acceptanceCriteria?: string[];
    }>;
}): string {
    return (request.tasks ?? [])
        .map((task) => {
            const parts = [task.objective ?? ''];
            if (Array.isArray(task.constraints) && task.constraints.length > 0) {
                parts.push(`约束：${task.constraints.join('；')}`);
            }
            if (Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0) {
                parts.push(`验收标准：${task.acceptanceCriteria.join('；')}`);
            }
            return parts.filter(Boolean).join('\n');
        })
        .filter(Boolean)
        .join('\n\n');
}

function buildTaskPlanReadyPayload(frozenWorkRequest: {
    mode?: 'chat' | 'immediate_task' | 'scheduled_task' | 'scheduled_multi_task';
    intentRouting?: IntentRouting;
    taskDraftRequired?: boolean;
    tasks?: Array<{ id: string; title: string; objective: string; dependencies?: string[] }>;
    sourceText?: string;
    deliverables?: DeliverableContract[];
    checkpoints?: CheckpointContract[];
    userActionsRequired?: UserActionRequest[];
    hitlPolicy?: HitlPolicy;
    runtimeIsolationPolicy?: RuntimeIsolationPolicy;
    sessionIsolationPolicy?: SessionIsolationPolicy;
    memoryIsolationPolicy?: MemoryIsolationPolicy;
    tenantIsolationPolicy?: TenantIsolationPolicy;
    missingInfo?: MissingInfoItem[];
    defaultingPolicy?: DefaultingPolicy;
    resumeStrategy?: ResumeStrategy;
}): {
    summary: string;
    mode?: 'chat' | 'immediate_task' | 'scheduled_task' | 'scheduled_multi_task';
    intentRouting?: IntentRouting;
    taskDraftRequired?: boolean;
    tasks?: Array<{
        id: string;
        title: string;
        objective: string;
        dependencies: string[];
    }>;
    deliverables: DeliverableContract[];
    checkpoints: CheckpointContract[];
    userActionsRequired: UserActionRequest[];
    hitlPolicy?: HitlPolicy;
    runtimeIsolationPolicy?: RuntimeIsolationPolicy;
    sessionIsolationPolicy?: SessionIsolationPolicy;
    memoryIsolationPolicy?: MemoryIsolationPolicy;
    tenantIsolationPolicy?: TenantIsolationPolicy;
    missingInfo: MissingInfoItem[];
    defaultingPolicy?: DefaultingPolicy;
    resumeStrategy?: ResumeStrategy;
} {
    return {
        summary: buildWorkRequestPlanSummary(frozenWorkRequest),
        mode: frozenWorkRequest.mode,
        intentRouting: frozenWorkRequest.intentRouting,
        taskDraftRequired: frozenWorkRequest.taskDraftRequired,
        tasks: (frozenWorkRequest.tasks ?? [])
            .map((task) => ({
                id: task.id,
                title: task.title,
                objective: task.objective,
                dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
            })),
        deliverables: frozenWorkRequest.deliverables ?? [],
        checkpoints: frozenWorkRequest.checkpoints ?? [],
        userActionsRequired: frozenWorkRequest.userActionsRequired ?? [],
        hitlPolicy: frozenWorkRequest.hitlPolicy,
        runtimeIsolationPolicy: frozenWorkRequest.runtimeIsolationPolicy,
        sessionIsolationPolicy: frozenWorkRequest.sessionIsolationPolicy,
        memoryIsolationPolicy: frozenWorkRequest.memoryIsolationPolicy,
        tenantIsolationPolicy: frozenWorkRequest.tenantIsolationPolicy,
        missingInfo: frozenWorkRequest.missingInfo ?? [],
        defaultingPolicy: frozenWorkRequest.defaultingPolicy,
        resumeStrategy: frozenWorkRequest.resumeStrategy,
    };
}

function buildTaskResearchUpdatedPayload(frozenWorkRequest: {
    researchQueries?: FrozenWorkRequest['researchQueries'];
    uncertaintyRegistry?: FrozenWorkRequest['uncertaintyRegistry'];
    frozenResearchSummary?: FrozenWorkRequest['frozenResearchSummary'];
}): {
    summary: string;
    sourcesChecked: string[];
    completedQueries: number;
    pendingQueries: number;
    blockingUnknowns: string[];
    selectedStrategyTitle?: string;
} {
    return buildResearchUpdatedPayload(frozenWorkRequest);
}

function emitBlockingCollaborationEvents(
    taskId: string,
    frozenWorkRequest: FrozenWorkRequest,
    deps: Pick<
        RuntimeCommandDeps,
        | 'emit'
        | 'createChatMessageEvent'
        | 'createTaskCheckpointReachedEvent'
        | 'createTaskUserActionRequiredEvent'
        | 'createTaskStatusEvent'
    >
): { blocked: boolean; blockingUserAction?: UserActionRequest } {
    const isBlockingPolicy = (
        policy: UserActionRequest['executionPolicy'] | undefined,
        fallbackBlocking: boolean
    ): boolean => {
        if (policy === 'review_required' || policy === 'hard_block') {
            return true;
        }
        if (policy === 'auto') {
            return false;
        }
        return fallbackBlocking;
    };

    const blockingCheckpoint = getBlockingCheckpoint(frozenWorkRequest);
    if (blockingCheckpoint) {
        deps.emit(deps.createTaskCheckpointReachedEvent(taskId, {
            checkpointId: blockingCheckpoint.id,
            title: blockingCheckpoint.title,
            kind: blockingCheckpoint.kind,
            reason: blockingCheckpoint.reason,
            userMessage: blockingCheckpoint.userMessage,
            riskTier: blockingCheckpoint.riskTier,
            executionPolicy: blockingCheckpoint.executionPolicy,
            requiresUserConfirmation: blockingCheckpoint.requiresUserConfirmation,
            blocking: blockingCheckpoint.blocking,
        }));
    }

    const preferredActionKind = frozenWorkRequest.clarification.required ? 'clarify_input' : undefined;
    const blockingUserActionsFromPlan = (frozenWorkRequest.userActionsRequired ?? [])
        .filter((action) => action.kind !== 'confirm_plan')
        .filter((action) => isBlockingPolicy(action.executionPolicy, action.blocking));
    const blockingUserActionFromPlan =
        getBlockingUserAction(frozenWorkRequest, preferredActionKind) ??
        getBlockingUserAction(frozenWorkRequest);
    const blockingUnknowns = (frozenWorkRequest.uncertaintyRegistry ?? [])
        .filter((item) => item.status === 'blocking_unknown');
    const hasResearchBlockingUnknown = blockingUnknowns.some((item) => item.topic.startsWith('required_research:'));
    const synthesizedBlockingUnknownAction: UserActionRequest | undefined =
        !blockingUserActionFromPlan && blockingUnknowns.length > 0
            ? {
                id: `blocking-unknown-${taskId}`,
                title: hasResearchBlockingUnknown ? '补齐必需研究数据' : '补齐阻塞信息',
                kind: 'clarify_input',
                description: hasResearchBlockingUnknown
                    ? '执行已暂停：缺少必需研究数据（例如最新价格快照），需先补齐后才能继续。'
                    : '执行已暂停：任务仍存在阻塞信息，需要先补充后才能继续。',
                riskTier: 'high',
                executionPolicy: 'hard_block',
                blocking: true,
                questions: blockingUnknowns.map((item) => item.question || `请补充 ${item.topic} 所需信息。`),
                instructions: [
                    hasResearchBlockingUnknown
                        ? '请提供缺失数据，或同意 Coworkany 重新执行必需 research 以补齐数据后继续。'
                        : '请补充缺失信息后再继续执行。',
                ],
            }
            : undefined;
    const blockingUserAction = blockingUserActionFromPlan ?? synthesizedBlockingUnknownAction;

    const emittedActionIds = new Set<string>();
    const emitUserActionRequired = (action: UserActionRequest): void => {
        if (emittedActionIds.has(action.id)) {
            return;
        }
        emittedActionIds.add(action.id);
        deps.emit(deps.createTaskUserActionRequiredEvent(taskId, {
            actionId: action.id,
            title: action.title,
            kind: action.kind,
            description: action.description,
            riskTier: action.riskTier,
            executionPolicy: action.executionPolicy,
            blocking: action.blocking,
            questions: action.questions,
            instructions: action.instructions,
            fulfillsCheckpointId: action.fulfillsCheckpointId,
        }));
    };

    if (blockingUserAction) {
        emitUserActionRequired(blockingUserAction);
    }
    for (const action of blockingUserActionsFromPlan) {
        emitUserActionRequired(action);
    }

    if (frozenWorkRequest.clarification.required) {
        return {
            blocked: true,
            blockingUserAction,
        };
    }

    if (blockingUserAction && isBlockingPolicy(blockingUserAction.executionPolicy, blockingUserAction.blocking)) {
        deps.emit(deps.createChatMessageEvent(taskId, {
            role: 'assistant',
            content: buildBlockingUserActionMessage(blockingUserAction),
        }));
        deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
        return {
            blocked: true,
            blockingUserAction,
        };
    }

    return {
        blocked: false,
        blockingUserAction,
    };
}

function normalizeComparisonValue(value: string | undefined): string {
    return (value || '')
        .trim()
        .replace(/^(original task|user correction)\s*:\s*/i, '')
        .replace(/^(原始任务|用户更正)\s*[:：]\s*/i, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function buildDeliverableFingerprint(request: FrozenWorkRequestSnapshot): string[] {
    return request.deliverables
        .map((deliverable) => [
            deliverable.type,
            deliverable.path ?? '',
            deliverable.format ?? '',
        ].join(':'))
        .sort();
}

function buildResolvedTargetFingerprint(request: FrozenWorkRequestSnapshot): string[] {
    return request.resolvedTargets;
}

function buildWorkflowFingerprint(request: FrozenWorkRequestSnapshot): string[] {
    return request.preferredWorkflows;
}

function hasCorrectionCue(promptText: string): boolean {
    return /(不是|改成|改为|更正|纠正|我指的是|actually|instead|correction|i meant|rather than|not .* but)/i.test(promptText);
}

function detectFollowUpContractReopen(input: {
    promptText: string;
    previous?: FrozenWorkRequestSnapshot;
    next: FrozenWorkRequestSnapshot;
}): {
    summary: string;
    reason: string;
    trigger: 'new_scope_signal' | 'contradictory_evidence';
    reasons: string[];
    diff: {
        changedFields: Array<'mode' | 'objective' | 'deliverables' | 'execution_targets' | 'workflow'>;
        modeChanged?: { before: string; after: string };
        objectiveChanged?: { before: string; after: string };
        deliverablesChanged?: { before: string[]; after: string[] };
        targetsChanged?: { before: string[]; after: string[] };
        workflowsChanged?: { before: string[]; after: string[] };
    };
} | null {
    if (!input.previous) {
        return null;
    }

    const reasons: string[] = [];
    const diff: {
        changedFields: Array<'mode' | 'objective' | 'deliverables' | 'execution_targets' | 'workflow'>;
        modeChanged?: { before: string; after: string };
        objectiveChanged?: { before: string; after: string };
        deliverablesChanged?: { before: string[]; after: string[] };
        targetsChanged?: { before: string[]; after: string[] };
        workflowsChanged?: { before: string[]; after: string[] };
    } = {
        changedFields: [],
    };
    const previousObjective = normalizeComparisonValue(input.previous.primaryObjective || input.previous.sourceText);
    const nextObjective = normalizeComparisonValue(input.next.primaryObjective || input.next.sourceText);
    const previousDeliverables = buildDeliverableFingerprint(input.previous);
    const nextDeliverables = buildDeliverableFingerprint(input.next);
    const previousTargets = buildResolvedTargetFingerprint(input.previous);
    const nextTargets = buildResolvedTargetFingerprint(input.next);
    const previousWorkflows = buildWorkflowFingerprint(input.previous);
    const nextWorkflows = buildWorkflowFingerprint(input.next);

    if (input.previous.mode !== input.next.mode) {
        reasons.push(`task mode changed from ${input.previous.mode} to ${input.next.mode}`);
        diff.changedFields.push('mode');
        diff.modeChanged = {
            before: input.previous.mode,
            after: input.next.mode,
        };
    }
    if (previousDeliverables.join('|') !== nextDeliverables.join('|')) {
        reasons.push('deliverables or output targets changed');
        diff.changedFields.push('deliverables');
        diff.deliverablesChanged = {
            before: previousDeliverables,
            after: nextDeliverables,
        };
    }
    if (previousTargets.join('|') !== nextTargets.join('|')) {
        reasons.push('execution targets changed');
        diff.changedFields.push('execution_targets');
        diff.targetsChanged = {
            before: previousTargets,
            after: nextTargets,
        };
    }
    if (previousWorkflows.join('|') !== nextWorkflows.join('|')) {
        reasons.push('execution workflow changed');
        diff.changedFields.push('workflow');
        diff.workflowsChanged = {
            before: previousWorkflows,
            after: nextWorkflows,
        };
    }
    if (
        previousObjective !== nextObjective &&
        normalizeComparisonValue(input.promptText).length >= 8
    ) {
        reasons.push('primary objective changed');
        diff.changedFields.push('objective');
        diff.objectiveChanged = {
            before: input.previous.primaryObjective || input.previous.sourceText,
            after: input.next.primaryObjective || input.next.sourceText,
        };
    }

    if (reasons.length === 0) {
        return null;
    }

    const trigger = hasCorrectionCue(input.promptText)
        ? 'contradictory_evidence'
        : 'new_scope_signal';
    const reasonPrefix = trigger === 'contradictory_evidence'
        ? 'User follow-up corrected the previous contract'
        : 'User follow-up introduced a new task scope';

    return {
        summary: `${reasonPrefix}: ${reasons[0]}.`,
        reason: `${reasonPrefix}: ${reasons.join('; ')}.`,
        trigger,
        reasons,
        diff,
    };
}

export async function handleRuntimeCommand(command: IpcCommand, deps: RuntimeCommandDeps): Promise<boolean> {
    switch (command.type) {
        case 'bootstrap_runtime_context': {
            deps.onBootstrapRuntimeContext((command.payload as { runtimeContext: unknown }).runtimeContext);
            deps.restorePersistedTasks();
            deps.emit(respond(command.id, 'bootstrap_runtime_context_response', {
                success: true,
            }));
            return true;
        }

        case 'get_runtime_snapshot': {
            try {
                deps.emit(respond(command.id, 'get_runtime_snapshot_response', {
                    success: true,
                    snapshot: deps.getRuntimeSnapshot(),
                }));
            } catch (error) {
                deps.emit(respond(command.id, 'get_runtime_snapshot_response', {
                    success: false,
                    snapshot: {
                        generatedAt: new Date().toISOString(),
                        tasks: [],
                        count: 0,
                    },
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
            return true;
        }

        case 'doctor_preflight': {
            const payload = (command.payload as {
                startupProfile?: string;
                readinessReportPath?: string;
                controlPlaneThresholdProfile?: string;
                incidentLogPaths?: string[];
                outputDir?: string;
            } | undefined) ?? {};

            try {
                const result = deps.runDoctorPreflight(payload);
                deps.emit(respond(command.id, 'doctor_preflight_response', {
                    success: true,
                    report: result.report,
                    markdown: result.markdown,
                    reportPath: result.reportPath,
                    markdownPath: result.markdownPath,
                }));
            } catch (error) {
                deps.emit(respond(command.id, 'doctor_preflight_response', {
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                }));
            }
            return true;
        }

        case 'start_task': {
            const payload = command.payload as any;
            deps.emit(respond(command.id, 'start_task_response', {
                success: true,
                taskId: payload.taskId,
            }));

            await deps.executeFreshTask({
                taskId: payload.taskId,
                title: payload.title,
                userQuery: payload.userQuery,
                workspacePath: payload.context.workspacePath,
                activeFile: payload.context.activeFile,
                config: payload.config,
                emitStartedEvent: true,
                allowAutonomousFallback: true,
            });
            return true;
        }

        case 'cancel_task': {
            const payload = command.payload as any;
            await deps.cancelTaskExecution(payload.taskId, payload.reason);
            deps.emit(respond(command.id, 'cancel_task_response', {
                success: true,
                taskId: payload.taskId,
            }));
            return true;
        }

        case 'clear_task_history': {
            const payload = command.payload as any;
            const cancellation = await deps.cancelTaskExecution(
                payload.taskId,
                'Task cleared by user'
            );
            deps.taskSessionStore.clearConversation(payload.taskId);
            deps.taskSessionStore.ensureHistoryLimit(payload.taskId);
            deps.taskEventBus.emitRaw(payload.taskId, 'TASK_HISTORY_CLEARED', {
                reason: 'user_requested',
            });
            if (cancellation.success) {
                deps.taskEventBus.emitStatus(payload.taskId, { status: 'idle' });
            }
            deps.emit(respond(command.id, 'clear_task_history_response', {
                success: true,
                taskId: payload.taskId,
            }));
            return true;
        }

        case 'send_task_message': {
            const payload = command.payload as any;
            const taskId = payload.taskId as string;
            const content = payload.content as string;
            const parsedUserInput = parseInlineAttachmentContent(content);
            const promptText = parsedUserInput.promptText || content;
            const authOpenPageUrl = extractAuthOpenPageUrl(promptText);
            const normalizedPromptText = normalizeFollowUpControlText(promptText);
            const conversationContent = parsedUserInput.conversationContent;

            if (deps.suspendResumeManager.isSuspended(taskId)) {
                if (authOpenPageUrl) {
                    const opener = deps.openAuthPageForSuspendedTask;
                    if (!opener) {
                        deps.emit(respond(command.id, 'send_task_message_response', {
                            success: false,
                            taskId,
                            error: 'auth_open_page_unsupported',
                        }));
                        return true;
                    }

                    const openResult = await opener({
                        taskId,
                        url: authOpenPageUrl,
                    });
                    deps.emit(respond(command.id, 'send_task_message_response', {
                        success: openResult.success,
                        taskId,
                        ...(openResult.success ? {} : { error: openResult.error || 'auth_open_page_failed' }),
                    }));
                    return true;
                }

                const suspendedTask = deps.suspendResumeManager.getSuspendedTask?.(taskId);
                const restoredFromPersistence = Boolean(suspendedTask?.context?.restoredFromPersistence);
                if (!restoredFromPersistence) {
                    deps.enqueueResumeMessage(taskId, content, payload.config);
                }
                const resume = await deps.suspendResumeManager.resume(taskId, 'User provided follow-up input');
                if (!resume.success) {
                    deps.emit(respond(command.id, 'send_task_message_response', {
                        success: false,
                        taskId,
                        error: 'resume_failed',
                    }));
                    return true;
                }

                // For runtime suspensions inside an active loop, keep historical behavior:
                // resume + queue replay happens in the loop listener.
                // For persisted suspended tasks restored after sidecar restart, there is no
                // active loop listener, so continue through the normal send path below.
                if (!restoredFromPersistence) {
                    deps.emit(respond(command.id, 'send_task_message_response', {
                        success: true,
                        taskId,
                    }));
                    return true;
                }
            }

            const chatContentForEvent =
                parsedUserInput.imageCount === 0
                && parsedUserInput.fileCount === 0
                && normalizedPromptText !== promptText
                    ? normalizedPromptText
                    : content;
            deps.taskEventBus.emitChatMessage(taskId, {
                role: 'user',
                content: chatContentForEvent,
            });

            const taskConfig = deps.getTaskConfig(taskId);
            let effectiveTaskConfig = taskConfig;
            const workspaceOverrideViolation = validateWorkspaceOverride(taskId, payload.config);
            if (workspaceOverrideViolation) {
                deps.emit(respond(command.id, 'send_task_message_response', {
                    success: false,
                    taskId,
                    error: 'session_workspace_override_denied',
                }));
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'system',
                    content: workspaceOverrideViolation,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                return true;
            }
            deps.emit(respond(command.id, 'send_task_message_response', {
                success: true,
                taskId,
            }));
            if (payload.config) {
                if (typeof payload.config.maxHistoryMessages === 'number' && payload.config.maxHistoryMessages > 0) {
                    deps.taskSessionStore.setHistoryLimit(taskId, payload.config.maxHistoryMessages);
                }
                deps.taskSessionStore.setConfig(taskId, {
                    ...taskConfig,
                    ...payload.config,
                });
                effectiveTaskConfig = deps.getTaskConfig(taskId);
            }

            const workspacePath =
                (effectiveTaskConfig?.workspacePath as string | undefined) ||
                (taskConfig?.workspacePath as string | undefined) ||
                deps.workspaceRoot;

            if (isTaskHistoryClearRequest(normalizedPromptText)) {
                const cancellation = await deps.cancelTaskExecution(
                    taskId,
                    'Task cleared by user'
                );
                deps.taskSessionStore.clearConversation(taskId);
                deps.taskSessionStore.ensureHistoryLimit(taskId);
                deps.taskEventBus.emitRaw(taskId, 'TASK_HISTORY_CLEARED', {
                    reason: 'user_requested',
                });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: '已清空当前任务历史，并停止当前执行。',
                }));
                if (cancellation.success) {
                    deps.taskEventBus.emitStatus(taskId, { status: 'idle' });
                }
                return true;
            }

            if (isResumeInterruptedTaskRequest(normalizedPromptText)) {
                await handleRuntimeCommand({
                    ...command,
                    type: 'resume_interrupted_task',
                    payload: {
                        taskId,
                        config: payload.config,
                        suppressResponse: true,
                    },
                } as IpcCommand, deps);
                return true;
            }

            const autonomousIntent = extractAutonomousStartIntent(normalizedPromptText);
            if (autonomousIntent) {
                await handleRuntimeCommand({
                    ...command,
                    type: 'start_autonomous_task',
                    payload: {
                        taskId,
                        query: autonomousIntent.query,
                        autoSaveMemory: true,
                        runInBackground: false,
                        suppressResponse: true,
                    },
                } as IpcCommand, deps);
                return true;
            }

            if (isScheduledCancellationRequest(normalizedPromptText)) {
                const cancellation = await deps.cancelScheduledTasksForSourceTask({
                    sourceTaskId: taskId,
                    userMessage: normalizedPromptText,
                });
                if (cancellation.success && cancellation.cancelledCount > 0) {
                    const scopeText = cancellation.cancelledTitles.length > 0
                        ? `已取消：${cancellation.cancelledTitles.join('、')}`
                        : '已取消当前会话关联的定时任务';
                    const confirmationMessage = `${scopeText}。后续不会再自动续排。`;
                    deps.pushConversationMessage(taskId, { role: 'user', content: conversationContent });
                    deps.pushConversationMessage(taskId, { role: 'assistant', content: confirmationMessage });
                    deps.emit(deps.createChatMessageEvent(taskId, {
                        role: 'assistant',
                        content: confirmationMessage,
                    }));
                    deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                    return true;
                }
            }

            const existingConversation = deps.taskSessionStore.getConversation(taskId);
            const activePreparedWorkRequest = deps.getActivePreparedWorkRequest?.(taskId);
            const previousFrozenSnapshot =
                activePreparedWorkRequest?.frozenWorkRequest
                    ? snapshotFrozenWorkRequest(activePreparedWorkRequest.frozenWorkRequest)
                    : effectiveTaskConfig?.lastFrozenWorkRequestSnapshot;
            const sourceTextForAnalysis = buildFollowUpSourceText({
                promptText: normalizedPromptText,
                conversation: existingConversation as Array<{ role?: string; content?: unknown }>,
                previousSnapshot: previousFrozenSnapshot,
            });

            deps.ensureTaskRuntimePersistence({
                taskId,
                title: (normalizedPromptText || content).trim().slice(0, 80) || 'Follow-up task',
                workspacePath,
            });
            deps.loadLlmConfig(workspacePath);

            const preparedWorkRequest = await deps.prepareWorkRequestContext({
                sourceText: sourceTextForAnalysis,
                workspacePath,
                workRequestStore: deps.workRequestStore,
            });
            const { frozenWorkRequest } = preparedWorkRequest;
            const frozenSnapshot = snapshotFrozenWorkRequest(frozenWorkRequest);
            const reopenSignal = detectFollowUpContractReopen({
                promptText: normalizedPromptText,
                previous: previousFrozenSnapshot,
                next: frozenSnapshot,
            });
            const nextTaskConfig = appendSupersededContractTombstone(
                {
                    ...(effectiveTaskConfig ?? {}),
                    lastFrozenWorkRequestSnapshot: frozenSnapshot,
                },
                previousFrozenSnapshot,
                frozenSnapshot,
            );
            deps.taskSessionStore.setConfig(taskId, nextTaskConfig);
            effectiveTaskConfig = deps.applyFrozenWorkRequestSessionPolicy?.(
                taskId,
                frozenWorkRequest,
                deps.getTaskConfig(taskId)
            ) ?? deps.getTaskConfig(taskId);
            if (reopenSignal) {
                deps.emit(deps.createTaskContractReopenedEvent(taskId, reopenSignal));
            }
            deps.emit(deps.createTaskResearchUpdatedEvent(taskId, buildTaskResearchUpdatedPayload(frozenWorkRequest)));
            deps.emit(deps.createTaskPlanReadyEvent(taskId, buildTaskPlanReadyPayload(frozenWorkRequest)));
            deps.emit(deps.createPlanUpdatedEvent(taskId, buildPlanUpdatedPayload(preparedWorkRequest)));

            if (frozenWorkRequest.intentRouting?.needsDisambiguation) {
                const disambiguationMessage = '我可以直接回答，也可以帮你创建可跟踪任务。请选择一种：直接回答 / 创建任务。';
                deps.pushConversationMessage(taskId, { role: 'user', content: conversationContent });
                deps.pushConversationMessage(taskId, { role: 'assistant', content: disambiguationMessage });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: disambiguationMessage,
                }));
                deps.emit(deps.createTaskClarificationRequiredEvent(taskId, {
                    reason: '需要先确认你希望走“直接回答”还是“创建任务”路径。',
                    questions: ['请选择：直接回答，或创建任务。'],
                    missingFields: ['intent_route'],
                    clarificationType: 'route_disambiguation',
                    routeChoices: [
                        {
                            id: 'chat',
                            label: '直接回答',
                            value: ROUTE_CHAT_TOKEN,
                        },
                        {
                            id: 'immediate_task',
                            label: '创建任务',
                            value: ROUTE_TASK_TOKEN,
                        },
                    ],
                    intentRouting: frozenWorkRequest.intentRouting,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                return true;
            }

            const needsTaskDraftConfirmation =
                frozenWorkRequest.taskDraftRequired
                && frozenWorkRequest.mode !== 'scheduled_task'
                && frozenWorkRequest.mode !== 'scheduled_multi_task';
            if (needsTaskDraftConfirmation) {
                const draftMessage = '任务草稿已生成。请先确认创建执行任务，或改成普通回答。你也可以直接输入修改内容后提交。';
                deps.pushConversationMessage(taskId, { role: 'user', content: conversationContent });
                deps.pushConversationMessage(taskId, { role: 'assistant', content: draftMessage });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: draftMessage,
                }));
                deps.emit(deps.createTaskClarificationRequiredEvent(taskId, {
                    reason: '任务草稿已生成，请先确认是否创建执行任务。',
                    questions: ['确认创建任务，或改成普通回答。'],
                    missingFields: ['task_draft_confirmation'],
                    clarificationType: 'task_draft_confirmation',
                    routeChoices: [
                        {
                            id: 'immediate_task',
                            label: '确认创建',
                            value: TASK_DRAFT_CONFIRM_TOKEN,
                        },
                        {
                            id: 'chat',
                            label: '改成普通回答',
                            value: TASK_DRAFT_CHAT_TOKEN,
                        },
                    ],
                    intentRouting: frozenWorkRequest.intentRouting,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                return true;
            }

            const artifactContract = deps.buildArtifactContract(
                preparedWorkRequest.executionQuery || normalizedPromptText,
                frozenWorkRequest.deliverables
            );

            deps.taskSessionStore.setArtifactContract(taskId, artifactContract);

            const collaborationGate = emitBlockingCollaborationEvents(taskId, frozenWorkRequest, deps);

            if (frozenWorkRequest.clarification.required) {
                const clarificationMessage = deps.buildClarificationMessage(frozenWorkRequest);
                deps.pushConversationMessage(taskId, { role: 'user', content: conversationContent });
                deps.pushConversationMessage(taskId, { role: 'assistant', content: clarificationMessage });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: clarificationMessage,
                }));
                deps.emit(deps.createTaskClarificationRequiredEvent(taskId, {
                    reason: frozenWorkRequest.clarification.reason,
                    questions: frozenWorkRequest.clarification.questions,
                    missingFields: frozenWorkRequest.clarification.missingFields,
                    clarificationType: 'missing_info',
                    intentRouting: frozenWorkRequest.intentRouting,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                if (deps.shouldUsePlanningFiles(frozenWorkRequest)) {
                    deps.appendPlanningProgressEntry(
                        workspacePath,
                        `Clarification requested for work request ${frozenWorkRequest.id}: ${clarificationMessage}`
                    );
                }
                return true;
            }

            if (collaborationGate.blocked && collaborationGate.blockingUserAction?.kind === 'confirm_plan') {
                const confirmationMessage = buildBlockingUserActionMessage(collaborationGate.blockingUserAction);
                deps.pushConversationMessage(taskId, { role: 'user', content: conversationContent });
                deps.pushConversationMessage(taskId, { role: 'assistant', content: confirmationMessage });
                if (deps.shouldUsePlanningFiles(frozenWorkRequest)) {
                    deps.appendPlanningProgressEntry(
                        workspacePath,
                        `Plan confirmation requested for work request ${frozenWorkRequest.id}: ${confirmationMessage}`
                    );
                }
                return true;
            }
            if (collaborationGate.blocked) {
                if (collaborationGate.blockingUserAction) {
                    const blockedMessage = buildBlockingUserActionMessage(collaborationGate.blockingUserAction);
                    deps.pushConversationMessage(taskId, { role: 'user', content: conversationContent });
                    deps.pushConversationMessage(taskId, { role: 'assistant', content: blockedMessage });
                    if (deps.shouldUsePlanningFiles(frozenWorkRequest)) {
                        deps.appendPlanningProgressEntry(
                            workspacePath,
                            `Execution blocked for work request ${frozenWorkRequest.id}: ${blockedMessage}`
                        );
                    }
                }
                return true;
            }

            deps.taskEventBus.emitStatus(taskId, { status: 'running' });
            if (
                (frozenWorkRequest.mode === 'scheduled_task' || frozenWorkRequest.mode === 'scheduled_multi_task')
                && frozenWorkRequest.schedule?.executeAt
            ) {
                const primaryTask = frozenWorkRequest.tasks?.[0];
                const stagePlans = planScheduledExecutionStages({
                    request: frozenWorkRequest,
                    fallbackTitle: primaryTask?.title || normalizedPromptText.trim().slice(0, 60) || 'Scheduled Task',
                    fallbackQuery: buildExecutionQueryFromFrozenWorkRequest(frozenWorkRequest) || normalizedPromptText,
                });
                const records = stagePlans.map((stage) => deps.scheduleTaskInternal({
                    title: stage.title,
                    taskQuery: stage.taskQuery,
                    executeAt: new Date(stage.executeAt),
                    workspacePath,
                    speakResult: frozenWorkRequest.presentation?.ttsEnabled ?? false,
                    sourceTaskId: taskId,
                    config: deps.toScheduledTaskConfig(effectiveTaskConfig),
                    workRequestId: frozenWorkRequest.id,
                    stageTaskId: stage.taskId,
                    stageIndex: stage.stageIndex,
                    totalStages: stage.totalStages,
                    delayMsFromPrevious: stage.delayMsFromPrevious,
                    frozenWorkRequest,
                }));
                const isSequentialChain = (stagePlans[0]?.executionMode === 'sequential') && (stagePlans[0]?.totalStages ?? 0) > 1;
                const confirmationMessage = isSequentialChain
                    ? [
                        `已拆解为 ${stagePlans[0]?.totalStages ?? records.length} 个链式阶段任务。`,
                        `当前仅安排第 1 阶段：${deps.buildScheduledConfirmationMessage(records[0])}`,
                        '后续阶段会在前一阶段完成后，自动继承结果并继续排程。',
                    ].join('\n')
                    : records.length <= 1
                        ? deps.buildScheduledConfirmationMessage(records[0])
                        : [
                            `已拆解为 ${records.length} 个定时任务：`,
                            ...records.map((record, index) => `${index + 1}. ${deps.buildScheduledConfirmationMessage(record)}`),
                        ].join('\n');
                deps.pushConversationMessage(taskId, { role: 'assistant', content: confirmationMessage });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: confirmationMessage,
                }));
                deps.emit(deps.createTaskFinishedEvent(taskId, {
                    summary: confirmationMessage,
                    duration: 0,
                }));
                return true;
            }

            deps.markWorkRequestExecutionStarted(preparedWorkRequest);
            deps.emit(deps.createPlanUpdatedEvent(taskId, buildPlanUpdatedPayload(preparedWorkRequest)));
            const explicitSkillIds =
                (effectiveTaskConfig?.enabledClaudeSkills as string[] | undefined) ??
                (effectiveTaskConfig?.enabledSkills as string[] | undefined) ??
                (payload.config?.enabledClaudeSkills as string[] | undefined) ??
                (payload.config?.enabledSkills as string[] | undefined);
            const conversation = deps.pushConversationMessage(taskId, { role: 'user', content: conversationContent });

            await deps.continuePreparedAgentFlow({
                taskId,
                userMessage: normalizedPromptText,
                workspacePath,
                config: effectiveTaskConfig,
                preparedWorkRequest,
                workRequestExecutionPrompt: preparedWorkRequest.workRequestExecutionPrompt,
                conversation,
                artifactContract,
                explicitSkillIds,
            }, deps.getExecutionRuntimeDeps(taskId));
            return true;
        }

        case 'resume_interrupted_task': {
            const payload = command.payload as any;
            const taskId = payload.taskId as string;
            const existingConversation = deps.taskSessionStore.getConversation(taskId);
            const suppressResponse = payload.suppressResponse === true;

            if (existingConversation.length === 0) {
                if (suppressResponse) {
                    deps.emit(deps.createChatMessageEvent(taskId, {
                        role: 'assistant',
                        content: '没有可恢复的中断任务上下文，请先描述你要继续的任务。',
                    }));
                    deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                } else {
                    deps.emit(respond(command.id, 'resume_interrupted_task_response', {
                        success: false,
                        taskId,
                        error: 'no_saved_context',
                    }));
                }
                return true;
            }

            const taskConfig = deps.getTaskConfig(taskId);
            let effectiveTaskConfig = taskConfig;
            const workspaceOverrideViolation = validateWorkspaceOverride(taskId, payload.config);
            if (workspaceOverrideViolation) {
                if (!suppressResponse) {
                    deps.emit(respond(command.id, 'resume_interrupted_task_response', {
                        success: false,
                        taskId,
                        error: 'session_workspace_override_denied',
                    }));
                }
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'system',
                    content: workspaceOverrideViolation,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                return true;
            }
            if (payload.config) {
                if (typeof payload.config.maxHistoryMessages === 'number' && payload.config.maxHistoryMessages > 0) {
                    deps.taskSessionStore.setHistoryLimit(taskId, payload.config.maxHistoryMessages);
                }
                deps.taskSessionStore.setConfig(taskId, {
                    ...taskConfig,
                    ...payload.config,
                });
                effectiveTaskConfig = deps.getTaskConfig(taskId);
            }

            const workspacePath =
                (effectiveTaskConfig?.workspacePath as string | undefined) ||
                (taskConfig?.workspacePath as string | undefined) ||
                deps.workspaceRoot;
            const latestUserMessage = getLatestMeaningfulUserMessage(existingConversation);
            const resumeQuery = latestUserMessage || 'Continue from the saved task context.';

            deps.ensureTaskRuntimePersistence({
                taskId,
                title: '',
                workspacePath,
            });
            deps.loadLlmConfig(workspacePath);

            if (!suppressResponse) {
                deps.emit(respond(command.id, 'resume_interrupted_task_response', {
                    success: true,
                    taskId,
                }));
            }
            deps.emit(deps.createTaskStatusEvent(taskId, { status: 'running' }));
            deps.emit(deps.createTaskResumedEvent(taskId, {
                resumeReason: 'interrupted_recovery',
                suspendDurationMs: 0,
            }));

            const conversation = deps.pushConversationMessage(taskId, {
                role: 'user',
                content:
                    `[RESUME_REQUESTED] The previous task execution was interrupted by a sidecar restart. ` +
                    `Resume from the saved context, preserve completed work, and continue the original task without restarting from scratch.`,
            });

            const preparedWorkRequest = await deps.prepareWorkRequestContext({
                sourceText: resumeQuery,
                workspacePath,
                workRequestStore: deps.workRequestStore,
            });
            const resumedSnapshot = snapshotFrozenWorkRequest(preparedWorkRequest.frozenWorkRequest);
            const resumedConfig = appendSupersededContractTombstone(
                {
                    ...(effectiveTaskConfig ?? {}),
                    lastFrozenWorkRequestSnapshot: resumedSnapshot,
                },
                effectiveTaskConfig?.lastFrozenWorkRequestSnapshot,
                resumedSnapshot,
            );
            effectiveTaskConfig = deps.applyFrozenWorkRequestSessionPolicy?.(
                taskId,
                preparedWorkRequest.frozenWorkRequest,
                resumedConfig
            ) ?? (() => {
                deps.taskSessionStore.setConfig(taskId, resumedConfig);
                return deps.getTaskConfig(taskId);
            })();
            deps.emit(
                deps.createTaskResearchUpdatedEvent(
                    taskId,
                    buildTaskResearchUpdatedPayload(preparedWorkRequest.frozenWorkRequest)
                )
            );
            deps.emit(
                deps.createTaskPlanReadyEvent(
                    taskId,
                    buildTaskPlanReadyPayload(preparedWorkRequest.frozenWorkRequest)
                )
            );
            deps.emit(deps.createPlanUpdatedEvent(taskId, buildPlanUpdatedPayload(preparedWorkRequest)));

            if (preparedWorkRequest.frozenWorkRequest.intentRouting?.needsDisambiguation) {
                const disambiguationMessage = '我可以直接回答，也可以帮你创建可跟踪任务。请选择一种：直接回答 / 创建任务。';
                deps.pushConversationMessage(taskId, {
                    role: 'assistant',
                    content: disambiguationMessage,
                });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: disambiguationMessage,
                }));
                deps.emit(deps.createTaskClarificationRequiredEvent(taskId, {
                    reason: '需要先确认你希望走“直接回答”还是“创建任务”路径。',
                    questions: ['请选择：直接回答，或创建任务。'],
                    missingFields: ['intent_route'],
                    clarificationType: 'route_disambiguation',
                    routeChoices: [
                        {
                            id: 'chat',
                            label: '直接回答',
                            value: ROUTE_CHAT_TOKEN,
                        },
                        {
                            id: 'immediate_task',
                            label: '创建任务',
                            value: ROUTE_TASK_TOKEN,
                        },
                    ],
                    intentRouting: preparedWorkRequest.frozenWorkRequest.intentRouting,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                return true;
            }

            const needsTaskDraftConfirmation =
                preparedWorkRequest.frozenWorkRequest.taskDraftRequired
                && preparedWorkRequest.frozenWorkRequest.mode !== 'scheduled_task'
                && preparedWorkRequest.frozenWorkRequest.mode !== 'scheduled_multi_task';
            if (needsTaskDraftConfirmation) {
                const draftMessage = '任务草稿已生成。请先确认创建执行任务，或改成普通回答。你也可以直接输入修改内容后提交。';
                deps.pushConversationMessage(taskId, {
                    role: 'assistant',
                    content: draftMessage,
                });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: draftMessage,
                }));
                deps.emit(deps.createTaskClarificationRequiredEvent(taskId, {
                    reason: '任务草稿已生成，请先确认是否创建执行任务。',
                    questions: ['确认创建任务，或改成普通回答。'],
                    missingFields: ['task_draft_confirmation'],
                    clarificationType: 'task_draft_confirmation',
                    routeChoices: [
                        {
                            id: 'immediate_task',
                            label: '确认创建',
                            value: TASK_DRAFT_CONFIRM_TOKEN,
                        },
                        {
                            id: 'chat',
                            label: '改成普通回答',
                            value: TASK_DRAFT_CHAT_TOKEN,
                        },
                    ],
                    intentRouting: preparedWorkRequest.frozenWorkRequest.intentRouting,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                return true;
            }

            const artifactContract = deps.buildArtifactContract(
                preparedWorkRequest.executionQuery || resumeQuery,
                preparedWorkRequest.frozenWorkRequest?.deliverables
            );
            deps.taskSessionStore.setArtifactContract(taskId, artifactContract);

            const collaborationGate = emitBlockingCollaborationEvents(taskId, preparedWorkRequest.frozenWorkRequest, deps);

            if (preparedWorkRequest.frozenWorkRequest.clarification.required) {
                const clarificationMessage = deps.buildClarificationMessage(preparedWorkRequest.frozenWorkRequest);
                deps.pushConversationMessage(taskId, {
                    role: 'assistant',
                    content: clarificationMessage,
                });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: clarificationMessage,
                }));
                deps.emit(deps.createTaskClarificationRequiredEvent(taskId, {
                    reason: preparedWorkRequest.frozenWorkRequest.clarification.reason,
                    questions: preparedWorkRequest.frozenWorkRequest.clarification.questions,
                    missingFields: preparedWorkRequest.frozenWorkRequest.clarification.missingFields,
                    clarificationType: 'missing_info',
                    intentRouting: preparedWorkRequest.frozenWorkRequest.intentRouting,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                return true;
            }

            if (collaborationGate.blocked && collaborationGate.blockingUserAction?.kind === 'confirm_plan') {
                const confirmationMessage = buildBlockingUserActionMessage(collaborationGate.blockingUserAction);
                deps.pushConversationMessage(taskId, {
                    role: 'assistant',
                    content: confirmationMessage,
                });
                return true;
            }
            if (collaborationGate.blocked) {
                if (collaborationGate.blockingUserAction) {
                    deps.pushConversationMessage(taskId, {
                        role: 'assistant',
                        content: buildBlockingUserActionMessage(collaborationGate.blockingUserAction),
                    });
                }
                return true;
            }

            deps.markWorkRequestExecutionStarted(preparedWorkRequest);
            deps.emit(deps.createPlanUpdatedEvent(taskId, buildPlanUpdatedPayload(preparedWorkRequest)));
            const explicitSkillIds =
                (effectiveTaskConfig?.enabledClaudeSkills as string[] | undefined) ??
                (effectiveTaskConfig?.enabledSkills as string[] | undefined) ??
                (payload.config?.enabledClaudeSkills as string[] | undefined) ??
                (payload.config?.enabledSkills as string[] | undefined);

            await deps.continuePreparedAgentFlow({
                taskId,
                userMessage: resumeQuery,
                workspacePath,
                config: effectiveTaskConfig,
                preparedWorkRequest,
                workRequestExecutionPrompt: preparedWorkRequest.workRequestExecutionPrompt,
                conversation,
                artifactContract,
                explicitSkillIds,
            }, deps.getExecutionRuntimeDeps(taskId));
            return true;
        }

        case 'request_effect': {
            const effectPayload = command.payload as any;
            if (effectPayload.tool === 'Edit' || effectPayload.tool === 'Write') {
                const filePath = effectPayload.parameters?.file_path || effectPayload.parameters?.path;
                const content = effectPayload.parameters?.new_string || effectPayload.parameters?.content;
                if (filePath) {
                    const taskId: string = (command as any).taskId || ((command.payload as any).taskId) || '';
                    const taskContext = deps.taskSessionStore.getConfig(taskId);
                    const workspacePath = (taskContext?.workspacePath as string | undefined) || process.cwd();
                    const hookResults = deps.runPostEditHooks(workspacePath, filePath, content);
                    if (hookResults.length > 0) {
                        deps.formatHookResults(hookResults);
                    }
                }
            }

            deps.emit(respond(command.id, 'request_effect_response', {
                response: {
                    approved: false,
                    requestId: command.id,
                } as any,
            }));
            return true;
        }

        case 'apply_patch':
        case 'read_file':
        case 'list_dir':
        case 'exec_shell':
        case 'capture_screen':
        case 'get_policy_config':
            console.error(`[STUB] Command type "${command.type}" should be forwarded to Rust Policy Gate`);
            return true;

        case 'start_autonomous_task': {
            const payload = command.payload as any;
            const suppressResponse = payload.suppressResponse === true;
            deps.taskEventBus.reset(payload.taskId);
            const llmConfig = deps.loadLlmConfig(deps.workspaceRoot);
            const providerConfig = deps.resolveProviderConfig(llmConfig, {});
            deps.autonomousLlmAdapter.setProviderConfig(providerConfig);
            const agent = deps.getAutonomousAgent(payload.taskId);
            const taskConfig = deps.getTaskConfig(payload.taskId);
            const workspacePath =
                (taskConfig?.workspacePath as string | undefined) ||
                deps.workspaceRoot;

            deps.taskEventBus.emitStarted(payload.taskId, {
                title: 'Autonomous Task',
                description: payload.query,
                context: {
                    workspacePath,
                    userQuery: payload.query,
                },
            });

            if (!suppressResponse) {
                deps.emit(respond(command.id, 'start_autonomous_task_response', {
                    success: true,
                    taskId: payload.taskId,
                    message: 'Autonomous task started',
                }));
            }

            try {
                const task = await agent.startTask(payload.query, {
                    autoSaveMemory: payload.autoSaveMemory ?? true,
                    notifyOnComplete: true,
                    runInBackground: payload.runInBackground ?? false,
                    sessionTaskId: payload.taskId,
                    workspacePath,
                });
                deps.taskEventBus.emitFinished(payload.taskId, {
                    summary: task.summary || 'Task completed',
                    duration: Date.now() - new Date(task.createdAt).getTime(),
                });
            } catch (error) {
                deps.emit(deps.createTaskFailedEvent(payload.taskId, {
                    error: error instanceof Error ? error.message : String(error),
                    errorCode: 'AUTONOMOUS_TASK_ERROR',
                    recoverable: false,
                }));
            }
            return true;
        }

        case 'get_autonomous_task_status': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            const task = agent.getTask(payload.taskId);
            deps.emit(respond(command.id, 'get_autonomous_task_status_response', {
                success: true,
                task: task ? {
                    id: task.id,
                    status: task.status,
                    subtaskCount: task.decomposedTasks.length,
                    completedSubtasks: task.decomposedTasks.filter((s: any) => s.status === 'completed').length,
                    summary: task.summary,
                    memoryExtracted: task.memoryExtracted,
                } : null,
            }));
            return true;
        }

        case 'get_voice_state': {
            deps.emit(respond(command.id, 'get_voice_state_response', {
                success: true,
                state: deps.getVoicePlaybackState(),
            }));
            return true;
        }

        case 'stop_voice': {
            const stopped = await deps.stopVoicePlayback('user_requested');
            deps.emit(respond(command.id, 'stop_voice_response', {
                success: true,
                stopped,
                state: deps.getVoicePlaybackState(),
            }));
            return true;
        }

        case 'get_voice_provider_status': {
            const payload = command.payload as { providerMode?: 'auto' | 'system' | 'custom' };
            deps.emit(respond(command.id, 'get_voice_provider_status_response', {
                success: true,
                ...(deps.getVoiceProviderStatus(payload.providerMode) as Record<string, unknown>),
            }));
            return true;
        }

        case 'transcribe_voice': {
            const payload = command.payload as {
                audioBase64: string;
                mimeType?: string;
                language?: string;
                providerMode?: 'auto' | 'system' | 'custom';
            };
            const result = await deps.transcribeWithCustomAsr(payload);
            deps.emit(respond(command.id, 'transcribe_voice_response', result as Record<string, unknown>));
            return true;
        }

        case 'pause_autonomous_task': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            const success = agent.pauseTask(payload.taskId);
            deps.emit(respond(command.id, 'pause_autonomous_task_response', {
                success,
                taskId: payload.taskId,
            }));
            return true;
        }

        case 'resume_autonomous_task': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            deps.emit(respond(command.id, 'resume_autonomous_task_response', {
                success: true,
                taskId: payload.taskId,
            }));
            agent.resumeTask(payload.taskId, payload.userInput).catch((error) => {
                deps.emit(deps.createTaskFailedEvent(payload.taskId, {
                    error: error instanceof Error ? error.message : String(error),
                    errorCode: 'AUTONOMOUS_RESUME_ERROR',
                    recoverable: false,
                }));
            });
            return true;
        }

        case 'cancel_autonomous_task': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            const success = agent.cancelTask(payload.taskId);
            deps.emit(respond(command.id, 'cancel_autonomous_task_response', {
                success,
                taskId: payload.taskId,
            }));
            if (success) {
                deps.emit(deps.createTaskFailedEvent(payload.taskId, {
                    error: 'Task cancelled by user',
                    errorCode: 'CANCELLED',
                    recoverable: false,
                }));
            }
            return true;
        }

        case 'list_autonomous_tasks': {
            const agent = deps.getAutonomousAgent('global');
            const tasks = agent.getAllTasks();
            deps.emit(respond(command.id, 'list_autonomous_tasks_response', {
                tasks: tasks.map((task) => ({
                    id: task.id,
                    query: task.originalQuery,
                    status: task.status,
                    subtaskCount: task.decomposedTasks.length,
                    completedSubtasks: task.decomposedTasks.filter((s: any) => s.status === 'completed').length,
                    createdAt: task.createdAt,
                    completedAt: task.completedAt,
                })),
            }));
            return true;
        }

        default:
            return false;
    }
}

export type RuntimeResponseDeps = {
    taskEventBus: {
        emitRaw: (taskId: string, type: string, payload: unknown) => void;
    };
    policyBridge?: {
        handleConfirmation: (
            requestId: string,
            approved: boolean,
            approvalType?: ConfirmationPolicy
        ) => void;
        handleDenial: (requestId: string, reason?: string) => void;
    };
};

export async function handleRuntimeResponse(response: IpcResponse, deps: RuntimeResponseDeps): Promise<boolean> {
    switch (response.type) {
        case 'request_effect_response': {
            const effectResponse = (response.payload as any).response;
            const approved = effectResponse.approved;
            const requestId = effectResponse.requestId as string | undefined;
            const denialReason = effectResponse.denialReason as string | undefined;
            const approvalType = effectResponse.approvalType as ConfirmationPolicy | undefined;

            if (requestId) {
                if (approved) {
                    deps.policyBridge?.handleConfirmation(
                        requestId,
                        true,
                        approvalType
                    );
                } else if (denialReason && denialReason !== 'awaiting_confirmation') {
                    deps.policyBridge?.handleDenial(requestId, denialReason);
                }
            }

            if (approved) {
                deps.taskEventBus.emitRaw('global', 'EFFECT_APPROVED', {
                    response: effectResponse,
                    approvedBy: 'policy',
                });
            } else {
                deps.taskEventBus.emitRaw('global', 'EFFECT_DENIED', {
                    response: effectResponse,
                    deniedBy: 'policy',
                });
            }
            return true;
        }
        case 'apply_patch_response': {
            const payload = response.payload as any;
            const success = payload.success;
            const eventType = success ? 'PATCH_APPLIED' : 'PATCH_REJECTED';
            const eventPayload = success
                ? {
                    patchId: payload.patchId,
                    filePath: payload.filePath ?? '',
                    hunksApplied: 0,
                    backupPath: payload.backupPath,
                }
                : {
                    patchId: payload.patchId,
                    reason: payload.error,
                };
            deps.taskEventBus.emitRaw('global', eventType, eventPayload);
            return true;
        }
        default:
            return false;
    }
}
