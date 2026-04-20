import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DesktopEvent } from '../ipc/bridge';
import { deriveDefaultResourceId } from './runtimeIdentity';
import type { HookRuntime } from './hookRuntime';
import type { PolicyEngine, PolicyDecisionAction } from './policyEngine';
import type { PolicyDecisionLogStore } from './policyDecisionLog';
import type { RemoteSessionConflictStrategy, RemoteSessionGovernancePolicy } from './remoteSessionGovernance';
import { coerceAgentTaskNotification } from './agentTaskNotification';
import { buildAgentTaskProgressSnapshot } from './agentProgressTracker';
import { isDelegatedAgentToolName, upsertAgentTaskFromNotification } from './agentTaskStore';
import {
    recoverTaskRuntimeStateAfterRestart,
    type TaskRuntimeCheckpoint,
    type TaskRuntimeExecutionPath,
    type TaskRuntimeOperationAction,
    type TaskRuntimeOperationRecord,
    type TaskRuntimeRetryState,
    type TaskRuntimeState,
} from './taskRuntimeState';
import { classifyRuntimeErrorMessage, type RuntimeFailureClassification } from './runtimeErrorClassifier';
import { handleStartOrSendTaskCommand } from './entrypointTaskCommands';
import { handleRecoveryAndCheckpointCommands } from './entrypointRecoveryCommands';
import { handleTaskControlCommands } from './entrypointTaskControlCommands';
import { handleRemoteSessionCommands } from './entrypointRemoteSessionCommands';
import { failGuard, passGuard, runGuardPipeline } from './entrypointGuardPipeline';
import { buildRuntimeConfigDoctorSummary } from '../config/runtimeConfig';
import {
    buildTaskTurnContract,
    formatTaskCapabilityRequirement,
    normalizeTaskMessageFingerprint,
    resolveTaskCapabilityRequirements,
} from './capabilityRegistry';
import { resolveSubagentFollowupMessage } from './subagentMessageRouter';
import { buildCommandRecoveryHints } from '../utils/commandAlternatives';
type OutgoingMessage = Record<string, unknown>;
type UserMessageExecutionOptions = {
    taskId?: string;
    turnId?: string;
    workspacePath?: string;
    modelId?: string;
    enabledToolpacks?: string[];
    enabledSkills?: string[];
    skillPrompt?: string;
    requireToolApproval?: boolean;
    autoResumeSuspendedTools?: boolean;
    toolCallConcurrency?: number;
    maxSteps?: number;
    executionPath?: 'direct' | 'workflow';
    forcedRouteMode?: 'chat' | 'task';
    useDirectChatResponder?: boolean;
    forcePostAssistantCompletion?: boolean;
    requireToolEvidenceForCompletion?: boolean;
    requiredCompletionCapabilities?: string[];
    turnContractHash?: string;
    turnContractDomain?: string;
    chatTurnDeadlineAtMs?: number;
    chatStartupDeadlineAtMs?: number;
    onPreCompact?: (payload: {
        taskId: string;
        threadId: string;
        resourceId: string;
        workspacePath?: string;
        microSummary: string;
        structuredSummary: string;
        recalledMemoryFiles: string[];
    }) => void;
    onPostCompact?: (payload: {
        taskId: string;
        threadId: string;
        resourceId: string;
        workspacePath?: string;
        microSummary: string;
        structuredSummary: string;
        recalledMemoryFiles: string[];
    }) => void;
};
type RuntimeCapabilitySkill = {
    id: string;
    name?: string;
    enabled: boolean;
    description?: string;
};
type RuntimeCapabilityToolpack = {
    id: string;
    name?: string;
    enabled: boolean;
    description?: string;
    tools?: string[];
};
type RuntimeCapabilitySnapshot = {
    skills: RuntimeCapabilitySkill[];
    toolpacks: RuntimeCapabilityToolpack[];
};
type RuntimeToolsetMap = Record<string, Record<string, unknown>>;
type RuntimeMcpSnapshot = {
    enabled: boolean;
    status: 'disabled' | 'idle' | 'ready' | 'degraded';
    cachedToolCount: number;
    cachedToolsetCount: number;
};
export type TaskMessageExecutionDelegateInput = {
    taskId: string;
    turnId: string;
    message: string;
    resourceId: string;
    preferredThreadId: string;
    workspacePath?: string;
    executionOptions?: UserMessageExecutionOptions;
    emitDesktopEvent: (event: DesktopEvent) => Promise<void>;
    runDirect: () => Promise<void>;
};
export type TaskMessageExecutionDelegateResult = {
    executionPath: TaskRuntimeExecutionPath;
};
type ProtocolCommand = {
    id?: string;
    commandId?: string;
    type?: string;
    payload?: unknown;
    timestamp?: string;
};
type UserMessageHandler = (
    message: string,
    threadId: string,
    resourceId: string,
    sendToDesktop: (event: DesktopEvent) => void,
    options?: UserMessageExecutionOptions,
) => Promise<{ runId: string }>;
type ApprovalHandler = (
    runId: string,
    toolCallId: string,
    approved: boolean,
    sendToDesktop: (event: DesktopEvent) => void,
    options?: {
        taskId?: string;
    },
) => Promise<void>;
type PendingApproval = {
    taskId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
};
type PendingForwardResponse = {
    resolve: (response: ProtocolCommand) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};
type PendingForwardResolution = 'resolved' | 'duplicate' | 'orphan';
type ForwardBridgeStats = {
    forwardedRequests: number;
    successfulResponses: number;
    orphanResponses: number;
    duplicateResponses: number;
    timeoutErrors: number;
    retries: number;
    transportClosedRejects: number;
    invalidResponses: number;
};
type EnqueueTaskExecutionInput = {
    taskId: string;
    turnId: string;
    run: () => Promise<TaskRuntimeExecutionPath>;
};
type EnqueueTaskExecutionResult = {
    queuePosition: number;
    completion: Promise<TaskRuntimeExecutionPath>;
};
type TaskMessageDedupReason = 'in_flight';
type TaskMessageDedupToken = {
    taskId: string;
    fingerprint: string;
};
type TaskMessageDedupState = {
    inFlightFingerprints: Set<string>;
};
type TaskTurnCommandRecoveryHint = {
    failedCommand: string;
    retryCommands: string[];
    probeCommands: string[];
    suggestedFix?: string;
    stderrSnippet?: string;
    toolName?: string;
};
type TaskTurnCommandFailureInfo = {
    failedCommand?: string;
    stderrSnippet?: string;
    exitCode?: number;
    toolName?: string;
};
type TaskTurnTerminalType = 'complete' | 'error' | 'tripwire';
type TaskTurnEventState = {
    assistantNarrativeSeen: boolean;
    assistantNarrativeChars: number;
    toolEvidenceSeen: boolean;
    strongToolEvidenceSeen: boolean;
    satisfiedCompletionCapabilities: string[];
    resultAttemptedCompletionCapabilities: string[];
    observedToolNames: string[];
    requireToolEvidenceForCompletion: boolean;
    requiredCompletionCapabilities: string[];
    turnContractHash?: string;
    turnContractDomain?: string;
    routeMode?: 'chat' | 'task';
    executionPath?: 'direct' | 'workflow';
    primaryNarrativeRunId?: string;
    lastAssistantChunkFingerprint?: string;
    lastCommandInvocation?: string;
    latestCommandRecoveryHint?: TaskTurnCommandRecoveryHint;
    latestCommandFailureInfo?: TaskTurnCommandFailureInfo;
    commandFailureNarrativeEmitted?: boolean;
    terminal?: TaskTurnTerminalType;
    updatedAtMs: number;
};
type TaskStateStore = {
    list: () => TaskRuntimeState[];
    upsert: (state: TaskRuntimeState) => void;
};
type RemoteSessionStatus = 'active' | 'closed';
type RemoteSessionScope = 'managed' | 'project' | 'user';
type RemoteSessionState = {
    remoteSessionId: string;
    taskId: string;
    channel?: string;
    status: RemoteSessionStatus;
    linkedAt: string;
    lastSeenAt: string;
    metadata?: Record<string, unknown>;
};
type ChannelDeliveryStatus = 'pending' | 'acked';
type ChannelDeliveryEvent = {
    id: string;
    taskId: string;
    remoteSessionId?: string;
    channel: string;
    eventType: string;
    content?: string;
    metadata?: Record<string, unknown>;
    injectedAt: string;
    status: ChannelDeliveryStatus;
    deliveryAttempts?: number;
    lastDeliveredAt?: string;
    ackedAt?: string;
    ackMetadata?: Record<string, unknown>;
};
type RemoteSessionArbitrationAction = 'none' | 'takeover' | 'takeover_stale';
type RemoteSessionArbitration = {
    action: RemoteSessionArbitrationAction;
    previousTaskId?: string;
    previousEndpointId?: string;
    staleMs?: number;
};
type RemoteSessionStore = {
    list: (input?: { taskId?: string; status?: RemoteSessionStatus }) => RemoteSessionState[];
    get: (remoteSessionId: string) => RemoteSessionState | undefined;
    upsertLink: (input: {
        remoteSessionId: string;
        taskId: string;
        channel?: string;
        metadata?: Record<string, unknown>;
    }) => { success: boolean; conflict?: boolean; state?: RemoteSessionState };
    heartbeat: (remoteSessionId: string, metadata?: Record<string, unknown>) => {
        success: boolean;
        state?: RemoteSessionState;
    };
    close: (remoteSessionId: string) => {
        success: boolean;
        state?: RemoteSessionState;
    };
    enqueueChannelEvent: (input: {
        taskId: string;
        remoteSessionId?: string;
        channel: string;
        eventType: string;
        content?: string;
        metadata?: Record<string, unknown>;
        eventId?: string;
        forceRequeue?: boolean;
    }) => {
        success: boolean;
        event?: ChannelDeliveryEvent;
        deduplicated?: boolean;
        requeued?: boolean;
    };
    getChannelEvent: (eventId: string) => ChannelDeliveryEvent | undefined;
    listChannelEvents: (input?: {
        taskId?: string;
        remoteSessionId?: string;
        status?: ChannelDeliveryStatus;
        limit?: number;
    }) => ChannelDeliveryEvent[];
    ackChannelEvent: (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
        metadata?: Record<string, unknown>;
    }) => {
        success: boolean;
        event?: ChannelDeliveryEvent;
    };
    markChannelEventDelivered: (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
    }) => {
        success: boolean;
        event?: ChannelDeliveryEvent;
    };
};
type TaskTranscriptEntry = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    at: string;
};
type TaskTranscriptStore = {
    append: (taskId: string, role: 'user' | 'assistant' | 'system', content: string) => TaskTranscriptEntry | null;
    list: (taskId: string, limit?: number) => TaskTranscriptEntry[];
    rewindByUserTurns: (taskId: string, userTurns: number) => {
        success: boolean;
        removedEntries: number;
        removedUserTurns: number;
        remainingEntries: number;
        latestUserMessage?: string;
    };
};
type ProcessorDeps = {
    handleUserMessage: UserMessageHandler;
    handleApprovalResponse: ApprovalHandler;
    getMastraHealth: () => {
        agents: string[];
        workflows: string[];
        storageConfigured: boolean;
        mastraPackages?: Record<string, string | null>;
    };
    stopVoicePlayback?: (reason?: string) => Promise<boolean>;
    getVoicePlaybackState?: () => unknown;
    getVoiceProviderStatus?: (providerMode?: 'auto' | 'system' | 'custom') => unknown;
    transcribeWithCustomAsr?: (input: {
        audioBase64: string;
        mimeType?: string;
        language?: string;
        providerMode?: 'auto' | 'system' | 'custom';
    }) => Promise<Record<string, unknown>>;
    scheduleTaskIfNeeded?: (input: {
        sourceTaskId: string;
        title?: string;
        message: string;
        workspacePath: string;
        config?: Record<string, unknown>;
    }) => Promise<{
        scheduled: boolean;
        summary?: string;
        error?: string;
    }>;
    cancelScheduledTasksForSourceTask?: (input: {
        sourceTaskId: string;
        userMessage: string;
    }) => Promise<{
        success: boolean;
        cancelledCount: number;
        cancelledTitles: string[];
    }>;
    handleAdditionalCommand?: (command: ProtocolCommand) => Promise<OutgoingMessage | null>;
    replayWorkflowRunTimeTravel?: (input: {
        workflowId: string;
        runId: string;
        steps: string[];
        taskId?: string;
        resourceId?: string;
        threadId?: string;
        workspacePath?: string;
        inputData?: unknown;
        resumeData?: unknown;
        perStep?: boolean;
    }) => Promise<{
        success: boolean;
        workflowId: string;
        runId: string;
        status: string;
        steps: string[];
        traceId: string;
        sampled: boolean;
        result?: unknown;
        error?: unknown;
    }>;
    getNowIso?: () => string;
    createId?: () => string;
    resolveResourceId?: (taskId: string) => string;
    resolveSkillPrompt?: (input: {
        message: string;
        workspacePath: string;
        explicitEnabledSkills?: string[];
    }) => {
        prompt?: string;
        enabledSkillIds: string[];
    };
    listRuntimeCapabilities?: () => RuntimeCapabilitySnapshot | Promise<RuntimeCapabilitySnapshot>;
    listRuntimeToolsets?: () => RuntimeToolsetMap | Promise<RuntimeToolsetMap>;
    isRuntimeMcpEnabled?: () => boolean;
    getRuntimeMcpSnapshot?: () => RuntimeMcpSnapshot;
    taskTranscriptStore?: TaskTranscriptStore;
    rewindTaskContext?: (input: {
        taskId: string;
        userTurns: number;
    }) => {
        success: boolean;
        removedTurns: number;
        remainingTurns: number;
    };
    policyEngine?: PolicyEngine;
    policyDecisionLog?: PolicyDecisionLogStore;
    hookRuntime?: HookRuntime;
    taskStateStore?: TaskStateStore;
    remoteSessionStore?: RemoteSessionStore;
    remoteSessionGovernancePolicy?: Partial<RemoteSessionGovernancePolicy>;
    policyGateResponseTimeoutMs?: number;
    policyGateTimeoutRetryCount?: number;
    executeTaskMessage?: (
        input: TaskMessageExecutionDelegateInput,
    ) => Promise<TaskMessageExecutionDelegateResult>;
    warmupChatRuntime?: () => Promise<{
        mcpServerCount: number;
        mcpToolCount: number;
        durationMs: number;
        mcpLoadStatus?: 'disabled' | 'ready' | 'timeout' | 'error';
    }>;
};
const DEFAULT_POLICY_GATE_TIMEOUT_MS = 30_000;
const REQUEST_EFFECT_TIMEOUT_MS = 300_000;
const DEFAULT_POLICY_GATE_TIMEOUT_RETRY_COUNT = 1;
const DEFAULT_REMOTE_SESSION_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_LATE_APPROVAL_GRACE_MS = 2_000;
const DEFAULT_AUTO_APPROVAL_RESUME_TIMEOUT_MS = 20_000;
const DEFAULT_CHAT_TURN_TIMEOUT_MS = 45_000;
const DEFAULT_CHAT_STARTUP_BUDGET_MS = 90_000;
// Task routes can include multi-step research + synthesis + artifact writing.
// Keep a wider default deadline to avoid premature turn-budget exhaustion.
const DEFAULT_TASK_TURN_TIMEOUT_MS = 240_000;
const DEFAULT_TASK_STARTUP_BUDGET_MS = 90_000;
const DEFAULT_COMMAND_ONLY_TASK_TURN_TIMEOUT_MS = 90_000;
const DEFAULT_PROTOCOL_MISSING_TOOL_EVIDENCE_AUTO_RETRY_MAX_ATTEMPTS = 0;
const DEFAULT_PROTOCOL_MISSING_TOOL_EVIDENCE_AUTO_RETRY_DELAY_MS = 1_000;
const ADAPTIVE_MISSING_TOOL_EVIDENCE_RETRY_MAX_ATTEMPTS_CAP = 5;
const ADAPTIVE_MISSING_TOOL_EVIDENCE_RETRY_MIN_ATTEMPTS = 1;
const LOW_RISK_MISSING_TOOL_EVIDENCE_RETRY_CAPABILITIES = new Set([
    'web_research',
    'voice_output',
    'browser_automation',
    'filesystem_read',
]);
const LATE_APPROVAL_POLL_INTERVAL_MS = 50;
const MAX_TASK_OPERATION_LOG = 64;
const TASK_TURN_EVENT_STATE_TTL_MS = 15 * 60 * 1000;
const MAX_TASK_TURN_EVENT_STATES = 1024;
const REMOTE_SESSION_SCOPE_METADATA_KEY = '__remoteSessionScope';
const HOST_CONTROL_APPROVAL_PATTERN = /\b(shutdown|reboot|poweroff|halt|empty\s+(?:the\s+)?(?:trash|recycle\s+bin)|clear\s+(?:the\s+)?(?:trash|recycle\s+bin))\b|关机|重启|清空(?:回收站|垃圾桶)/iu;
const HOUR_CUE_PATTERN = /([01]?\d|2[0-3])\s*点/u;
const DATABASE_OPERATION_PATTERN = /(数据库|mysql|postgres(?:ql)?|sqlite|database|select\s+.+\s+from)/iu;
const TASK_EXECUTION_NARRATION_PREFIX_PATTERN = /^(?:我来|让我|我先|我会|我将|我现在|接下来|正在|先|马上|立即|I'll|I will|Let me|Now I|Next,? I)/iu;
const TASK_EXECUTION_NARRATION_ACTION_PATTERN = /(搜索|查询|检索|获取|查找|确认|分析|收集|核对|search|lookup|check|fetch|verify|analy[sz]e|gather)/iu;
const TASK_META_REASONING_PATTERN = /^(?:the user (?:is asking|asked) me|based on (?:the )?instructions|according to (?:the )?instructions|my approach(?:\s*:)?|i (?:should|need|must) (?:first|then|start|analyze|search)|用户(?:要求|让我)|根据(?:以上)?指令|我的(?:思路|计划)|让我先分析)/iu;
const TASK_META_REASONING_INLINE_PATTERN = /(根据(?:skill|技能)?指令|according to (?:the )?instructions|based on (?:the )?instructions|the user is asking me)/iu;
const TASK_EXECUTION_NARRATION_MAX_SUPPRESS_CHARS = 220;
const TOOL_RESULT_ERROR_CODE_PATTERN = /\b(no_results|low_quality_results|unavailable|timeout|timed_out|rate_limit|forbidden|denied|not[_\s-]?found|empty_result|empty)\b/iu;
const TOOL_RESULT_SUCCESS_FIELD_PATTERN = /\b(success|ok|done|completed|status)\b/iu;
const TOOL_RESULT_PAYLOAD_FIELD_PATTERN = /\b(results?|items?|rows?|documents?|matches|content|summary|answer|snippet|text|stdout|output|data)\b/iu;
const TOOL_RESULT_METADATA_FIELD_PATTERN = /\b(provider|query|request_id|trace_id|tool|tool_name|model|source|url|host|metadata)\b/iu;
const WEB_RESEARCH_EVIDENCE_TOOL_PATTERN = /(search_web|crawl_url|extract_content|get_news|check_weather|finance|quote|ticker|stock|market|weather|forecast|websearch|open_in_browser|browser_[a-z_]+|agent-[a-z0-9_-]+)/iu;
const WEB_RESEARCH_APPROVAL_FALLBACK_TOOL_PATTERN = /\b(mastra_workspace_execute_command|run_command|bash|bash_approval)\b/iu;
const VOICE_OUTPUT_EVIDENCE_TOOL_PATTERN = /\b(voice_speak|tts|text[-_\s]?to[-_\s]?speech|speak|read[_\s-]?aloud)\b|语音|朗读|播报/iu;
const FILESYSTEM_READ_EVIDENCE_TOOL_PATTERN = /\b(list_dir|view_file|read_file|mastra_workspace_list_files|mastra_workspace_read_file|mastra_workspace_file_stat)\b/iu;
const COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN = /\b(mastra_workspace_execute_command|run_command|bash|bash_approval|shell(?:[_\s-]?command)?|terminal(?:[_\s-]?command)?)\b/iu;
const COMMAND_NOT_FOUND_RESULT_PATTERN = /\b(command not found|not recognized as an internal or external command|is not recognized)\b/iu;
const COMMAND_EXECUTION_FAILURE_RESULT_PATTERN = /\b(no such file or directory|permission denied|operation not permitted|error opening input|impossible to open|error while opening encoder|failed to open|unable to (?:open|find)|invalid argument|width not divisible by 2)\b/iu;
const COMMAND_RESULT_EXIT_CODE_PATTERN = /\bexit\s*code\s*[:=]\s*(-?\d+)\b/iu;
const DUPLICATED_PATH_SEGMENT_MARKER_PATTERN = /(^|\/)([^/]+(?:\/[^/]+){0,4})\/\2(\/|$)/u;
const QUOTED_PATH_CANDIDATE_PATTERN = /["']([^"'\n]*[\\/][^"'\n]*)["']/gu;
const UNQUOTED_PATH_CANDIDATE_PATTERN = /(?:^|[\s(])((?:\/|\.\/|\.\.\/)[^\s"'`]+(?:[\\/][^\s"'`]+)+)/gu;
const COMMAND_OPEN_INPUT_FAILURE_PATTERN = /\b(impossible to open|error opening input|error opening input file|no such file or directory)\b/iu;
const COMMAND_OPEN_INPUT_FILE_PATH_PATTERN = /\berror opening input file\s+([^\n\r]+)/iu;
const ARTIFACT_WRITE_EVIDENCE_TOOL_PATTERN = /\b(write_to_file|replace_file_content|append_to_file|move_file|copy_file|create_file|apply_patch|patch_file|mastra_workspace_apply_patch|mastra_workspace_write_file|mastra_workspace_replace_file_content)\b/iu;
const RETRY_EXECUTION_CONTRACT_MARKER = '[CoworkAny Retry Execution Contract]';
function normalizeStringList(values: string[]): string[] {
    return Array.from(new Set(
        values
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
    ));
}

function deriveCompletionCapabilitiesFromMessage(input: {
    message: string;
    workspacePath?: string;
}): string[] {
    return resolveTaskCapabilityRequirements({
        message: input.message,
        workspacePath: input.workspacePath ?? process.cwd(),
    }).map(formatTaskCapabilityRequirement);
}

function resolveRequiredCompletionCapabilities(input: {
    message: string;
    workspacePath?: string;
    executionOptions?: UserMessageExecutionOptions;
}): string[] {
    const explicit = normalizeStringList(input.executionOptions?.requiredCompletionCapabilities ?? []);
    const saveTargetRequested = Boolean(extractSaveTargetFromMessage(input.message));
    const maybeWithArtifactWrite = (capabilities: string[]): string[] => (
        saveTargetRequested
            ? normalizeStringList([...capabilities, ARTIFACT_WRITE_CAPABILITY])
            : capabilities
    );
    if (explicit.length > 0) {
        return maybeWithArtifactWrite(explicit);
    }
    if (input.executionOptions?.requireToolEvidenceForCompletion === false) {
        return [];
    }
    if (input.executionOptions?.forcedRouteMode === 'chat') {
        return [];
    }
    const derived = deriveCompletionCapabilitiesFromMessage({
        message: input.message,
        workspacePath: input.workspacePath,
    });
    return maybeWithArtifactWrite(derived);
}

function buildMissingToolEvidenceRetryMessage(input: {
    message: string;
    requiredCapabilities: string[];
    source: 'complete' | 'error';
    commandRecoveryHint?: TaskTurnCommandRecoveryHint;
}): string {
    const normalizedMessage = input.message.trim();
    if (normalizedMessage.length === 0 || normalizedMessage.includes(RETRY_EXECUTION_CONTRACT_MARKER)) {
        return input.message;
    }
    const required = normalizeStringList(input.requiredCapabilities)
        .map((value) => value.trim().toLowerCase());
    if (required.length === 0) {
        return input.message;
    }
    const lines: string[] = [
        RETRY_EXECUTION_CONTRACT_MARKER,
        input.source === 'error'
            ? '- Previous attempt ended with "error" after a failed command/tooling step. Retry only that failed step, then continue from saved artifacts.'
            : `- Previous attempt ended with "${input.source}" but lacked required tool evidence. You MUST execute required tools before final completion.`,
        '- Do not return refusal-only or disclaimer-only text in this retry.',
    ];
    if (required.includes(COMMAND_EXECUTION_CAPABILITY)) {
        lines.push('- You MUST execute at least one local command tool call relevant to the user request.');
        lines.push('- Execute in persisted steps and keep each intermediate artifact on disk before moving to the next step.');
        lines.push('- On retry, do not restart the whole workflow; rerun only the failed command step and then continue.');
        lines.push('- If first command fails, run a recovery loop: inspect tool error -> choose alternative command -> retry execution -> report final result.');
        lines.push('- For command-not-found/unsupported errors, prefer this order: alternative_commands/suggested_fix/command_recovery from tool result -> probe_commands (or command -v/which/where/Get-Command) -> --help/man -> retry.');
        lines.push('- Do not conclude "cannot execute" without at least one concrete recovery retry.');
        if (input.commandRecoveryHint) {
            lines.push(`- Last failed command: ${input.commandRecoveryHint.failedCommand}`);
            if (input.commandRecoveryHint.retryCommands.length > 0) {
                lines.push(`- Retry this fallback command first: ${input.commandRecoveryHint.retryCommands[0]}`);
                if (input.commandRecoveryHint.retryCommands.length > 1) {
                    lines.push(`- Additional fallback commands: ${input.commandRecoveryHint.retryCommands.slice(1).join(' ; ')}`);
                }
            }
            if (input.commandRecoveryHint.probeCommands.length > 0) {
                lines.push(`- If fallback still fails, run probe commands: ${input.commandRecoveryHint.probeCommands.join(' ; ')}`);
            }
            if (input.commandRecoveryHint.suggestedFix) {
                lines.push(`- Tool suggested fix: ${input.commandRecoveryHint.suggestedFix}`);
            }
            if (input.commandRecoveryHint.stderrSnippet) {
                lines.push(`- Last stderr snippet: ${input.commandRecoveryHint.stderrSnippet}`);
            }
        }
    }
    if (required.includes(WEB_RESEARCH_CAPABILITY)) {
        lines.push('- You MUST complete at least one successful research tool call and ground conclusions in retrieved evidence.');
    }
    if (required.includes(FILESYSTEM_READ_CAPABILITY)) {
        lines.push('- This request requires real workspace inspection evidence before completion.');
        lines.push('- You MUST call filesystem read tools (list_dir / view_file / read_file) and summarize actual observed results.');
    }
    if (required.includes(VOICE_OUTPUT_CAPABILITY)) {
        lines.push('- Spoken-output requests require a successful voice_speak tool call before completion.');
        if (required.includes(WEB_RESEARCH_CAPABILITY)) {
            lines.push('- For web-research + spoken-output retries, execute "search -> concise synthesis -> voice_speak" in one retry turn.');
            lines.push('- Do not loop research-only calls: after up to 3 retrieval calls, you MUST call voice_speak with a best-effort summary.');
        }
    }
    if (required.includes(ARTIFACT_WRITE_CAPABILITY)) {
        lines.push('- This request requires writing deliverable files before completion.');
        lines.push('- You MUST call workspace file-write tools (write_to_file / replace_file_content) to persist artifacts.');
        const saveTarget = extractSaveTargetFromMessage(input.message);
        if (saveTarget) {
            lines.push(`- Required output target hint: ${saveTarget}`);
        }
    }
    return `${input.message}\n\n${lines.join('\n')}`;
}

function buildAlternativeRetryCommandsForMessage(input: {
    command: string;
    alternatives: string[];
}): string[] {
    const rawCommand = input.command.trim();
    if (rawCommand.length === 0) {
        return input.alternatives;
    }
    if (/[|&;<>`\n]/.test(rawCommand)) {
        return input.alternatives;
    }
    const firstSpace = rawCommand.search(/\s/u);
    const base = firstSpace >= 0 ? rawCommand.slice(0, firstSpace).trim() : rawCommand;
    const rest = firstSpace >= 0 ? rawCommand.slice(firstSpace + 1).trim() : '';
    if (base.length === 0) {
        return input.alternatives;
    }
    const candidates = input.alternatives
        .map((alternative) => alternative.trim())
        .filter((alternative) => alternative.length > 0)
        .map((alternative) => (rest.length > 0 ? `${alternative} ${rest}` : alternative));
    const deduped = Array.from(new Set(candidates));
    return deduped.length > 0 ? deduped : input.alternatives;
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function extractCommandFromToolArgs(args: unknown): string | null {
    const direct = getString(toRecord(args).command);
    if (direct) {
        return direct.trim();
    }
    const nestedInput = getString(toRecord(toRecord(args).input).command);
    if (nestedInput) {
        return nestedInput.trim();
    }
    const nestedPayload = getString(toRecord(toRecord(args).payload).command);
    if (nestedPayload) {
        return nestedPayload.trim();
    }
    return null;
}

function extractCommandOptionPath(command: string, option: string): string | null {
    const escapedOption = option.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const pattern = new RegExp(`(?:^|\\s)${escapedOption}\\s+(?:"([^"]+)"|'([^']+)'|([^\\s]+))`, 'u');
    const match = pattern.exec(command);
    const captured = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
    const normalized = captured.trim();
    return normalized.length > 0 ? normalized : null;
}

function collapseConsecutiveDuplicatePathSegments(pathValue: string): string {
    const normalized = pathValue.replace(/\\/gu, '/').replace(/\/+/gu, '/');
    const isAbsolute = normalized.startsWith('/');
    const segments = normalized
        .split('/')
        .filter((segment) => segment.length > 0);
    if (segments.length < 2) {
        return normalized;
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (let start = 0; start < segments.length - 1; start += 1) {
            const maxWindow = Math.floor((segments.length - start) / 2);
            for (let size = maxWindow; size >= 1; size -= 1) {
                const left = segments.slice(start, start + size);
                const right = segments.slice(start + size, start + 2 * size);
                if (left.length === right.length && left.every((segment, index) => segment === right[index])) {
                    segments.splice(start + size, size);
                    changed = true;
                    break;
                }
            }
            if (changed) {
                break;
            }
        }
    }

    const collapsed = segments.join('/');
    return isAbsolute ? `/${collapsed}` : collapsed;
}

function hasConsecutiveDuplicatePathSegments(pathValue: string): boolean {
    const collapsed = collapseConsecutiveDuplicatePathSegments(pathValue);
    const normalizedOriginal = pathValue.replace(/\\/gu, '/').replace(/\/+/gu, '/');
    return collapsed !== normalizedOriginal && DUPLICATED_PATH_SEGMENT_MARKER_PATTERN.test(normalizedOriginal);
}

function extractPathCandidatesFromText(text: string): string[] {
    const candidates: string[] = [];
    const pushCandidate = (value: string): void => {
        const normalized = value.trim().replace(/\\/gu, '/');
        if (normalized.length === 0) {
            return;
        }
        if (!normalized.includes('/')) {
            return;
        }
        if (!candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };
    for (const match of text.matchAll(QUOTED_PATH_CANDIDATE_PATTERN)) {
        const candidate = match[1];
        if (candidate) {
            pushCandidate(candidate);
        }
    }
    for (const match of text.matchAll(UNQUOTED_PATH_CANDIDATE_PATTERN)) {
        const candidate = match[1];
        if (candidate) {
            pushCandidate(candidate);
        }
    }
    return candidates;
}

function collectCommandDiagnosticTextCandidates(
    value: unknown,
    depth = 0,
    sink: string[] = [],
): string[] {
    if (depth > 5 || value == null) {
        return sink;
    }
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized.length > 0 && !sink.includes(normalized)) {
            sink.push(normalized);
        }
        return sink;
    }
    const record = toOptionalRecord(value);
    if (!record) {
        return sink;
    }
    const directTextKeys = [
        'stderr',
        'stdout',
        'output',
        'text',
        'message',
        'detail',
        'error',
        'reason',
        'summary',
    ];
    for (const key of directTextKeys) {
        const candidate = record[key];
        if (typeof candidate === 'string') {
            const normalized = candidate.trim();
            if (normalized.length > 0 && !sink.includes(normalized)) {
                sink.push(normalized);
            }
            continue;
        }
        if (candidate && typeof candidate === 'object') {
            collectCommandDiagnosticTextCandidates(candidate, depth + 1, sink);
        }
    }
    const nestedKeys = ['result', 'response', 'payload', 'data'];
    for (const key of nestedKeys) {
        const nested = record[key];
        if (nested && typeof nested === 'object') {
            collectCommandDiagnosticTextCandidates(nested, depth + 1, sink);
        }
    }
    return sink;
}

function resolveCommandDiagnosticTextFromToolResult(result: unknown): string {
    if (typeof result === 'string') {
        return result;
    }
    const candidates = collectCommandDiagnosticTextCandidates(result);
    if (candidates.length === 0) {
        return '';
    }
    return candidates.join('\n');
}

function extractInputFilePathFromFailureText(text: string): string | null {
    const match = COMMAND_OPEN_INPUT_FILE_PATH_PATTERN.exec(text);
    if (!match?.[1]) {
        return null;
    }
    const normalized = match[1]
        .trim()
        .replace(/^['"]|['"]$/gu, '')
        .replace(/[.,;:]+$/gu, '')
        .trim();
    return normalized.length > 0 ? normalized : null;
}

function buildInputManifestDuplicatePathRecoveryHint(input: {
    command: string;
    stderr: string;
    toolName: string;
}): TaskTurnCommandRecoveryHint | null {
    const normalizedCommand = input.command.trim();
    if (normalizedCommand.length === 0) {
        return null;
    }
    const manifestPath = extractCommandOptionPath(normalizedCommand, '-i')
        ?? extractInputFilePathFromFailureText(input.stderr);
    if (!manifestPath) {
        return null;
    }
    const normalizedStderr = input.stderr.replace(/\\/gu, '/').trim();
    const duplicatePathSample = extractPathCandidatesFromText(normalizedStderr)
        .find((candidate) => hasConsecutiveDuplicatePathSegments(candidate));
    const hasOpenInputFailure = COMMAND_OPEN_INPUT_FAILURE_PATTERN.test(input.stderr);
    if (!duplicatePathSample || !hasOpenInputFailure) {
        return null;
    }
    const serializedManifestPath = JSON.stringify(manifestPath);
    const normalizeManifestCommand = [
        'python3 - <<\'PY\'',
        'import pathlib',
        `manifest_path = pathlib.Path(${serializedManifestPath})`,
        'if not manifest_path.exists():',
        '    raise SystemExit(f"input manifest not found: {manifest_path}")',
        '',
        'def collapse(path_value: str) -> str:',
        '    normalized = path_value.replace("\\\\", "/")',
        '    is_abs = normalized.startswith("/")',
        '    segments = [segment for segment in normalized.split("/") if segment not in ("", ".")]',
        '    changed = True',
        '    while changed:',
        '        changed = False',
        '        segment_count = len(segments)',
        '        for start in range(0, max(segment_count - 1, 0)):',
        '            max_window = (segment_count - start) // 2',
        '            for size in range(max_window, 0, -1):',
        '                if segments[start:start+size] == segments[start+size:start+2*size]:',
        '                    segments = segments[:start+size] + segments[start+2*size:]',
        '                    changed = True',
        '                    break',
        '            if changed:',
        '                break',
        '    collapsed = "/".join(segments)',
        '    return f"/{collapsed}" if is_abs else collapsed',
        '',
        'fixed_lines = []',
        'workspace_root = pathlib.Path.cwd()',
        'for raw in manifest_path.read_text(encoding=\'utf-8\').splitlines():',
        '    if raw.startswith("file \'") and raw.endswith("\'"):',
        '        path_token = raw[6:-1]',
        '        normalized_path = collapse(path_token)',
        '        candidate = pathlib.Path(normalized_path)',
        '        if not candidate.is_absolute():',
        '            workspace_candidate = (workspace_root / candidate).resolve()',
        '            manifest_candidate = (manifest_path.parent / candidate).resolve()',
        '            if workspace_candidate.exists():',
        '                candidate = workspace_candidate',
        '            elif manifest_candidate.exists():',
        '                candidate = manifest_candidate',
            '            else:',
        '                candidate = workspace_candidate',
        '        fixed_lines.append(f"file \'{candidate.resolve().as_posix()}\'")',
        '    else:',
        '        fixed_lines.append(raw)',
        'manifest_path.write_text("\\n".join(fixed_lines) + "\\n", encoding=\'utf-8\')',
        'print(f"normalized manifest paths: {manifest_path}")',
        'PY',
    ].join('\n');
    const verifyManifestPathsCommand = [
        'python3 - <<\'PY\'',
        'import pathlib',
        `manifest_path = pathlib.Path(${serializedManifestPath})`,
        'missing = []',
        'for raw in manifest_path.read_text(encoding=\'utf-8\').splitlines():',
        '    if not raw.startswith("file \'") or not raw.endswith("\'"):',
        '        continue',
        '    path_value = pathlib.Path(raw[6:-1])',
        '    if not path_value.exists():',
        '        missing.append(str(path_value))',
        'print(f"checked {manifest_path}, missing={len(missing)}")',
        'if missing:',
        '    print("\\n".join(missing[:10]))',
        '    raise SystemExit(1)',
        'PY',
    ].join('\n');
    return {
        failedCommand: normalizedCommand,
        retryCommands: [`${normalizeManifestCommand}\n${normalizedCommand}`],
        probeCommands: [verifyManifestPathsCommand],
        suggestedFix: 'Input manifest contains duplicated path segments. Normalize manifest entries to valid absolute paths, verify referenced files, then rerun only this failed step.',
        stderrSnippet: input.stderr.trim().replace(/\s+/gu, ' ').slice(0, 320),
        toolName: input.toolName,
    };
}

function resolveCommandRecoveryHintFromToolResult(input: {
    toolName: string;
    result: unknown;
    fallbackCommand?: string;
}): TaskTurnCommandRecoveryHint | null {
    const normalizedToolName = input.toolName.trim().toLowerCase();
    if (!COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN.test(normalizedToolName)) {
        return null;
    }
    const resultRecord = toOptionalRecord(input.result);
    const explicitCommand = getString(resultRecord?.command);
    const command = explicitCommand?.trim() || input.fallbackCommand?.trim() || '';
    if (command.length === 0) {
        return null;
    }
    const stderrFromRecord = getString(resultRecord?.stderr) ?? '';
    const diagnosticText = resolveCommandDiagnosticTextFromToolResult(input.result);
    const stderr = stderrFromRecord.trim().length > 0 ? stderrFromRecord : diagnosticText;
    const manifestDuplicatePathHint = buildInputManifestDuplicatePathRecoveryHint({
        command,
        stderr,
        toolName: normalizedToolName,
    });
    if (manifestDuplicatePathHint) {
        return manifestDuplicatePathHint;
    }
    const errorType = getString(resultRecord?.error_type)?.toLowerCase() ?? '';
    const exitCode = (
        typeof resultRecord?.exitCode === 'number'
            ? resultRecord.exitCode
            : (typeof resultRecord?.exit_code === 'number' ? resultRecord.exit_code : undefined)
    );
    const hasNotFoundSignal = (
        errorType === 'not_found'
        || COMMAND_NOT_FOUND_RESULT_PATTERN.test(stderr)
        || exitCode === 127
        || exitCode === 9009
    );
    if (!hasNotFoundSignal) {
        return null;
    }
    const explicitAlternatives = toStringArray(
        resultRecord?.alternative_commands
            ?? toOptionalRecord(resultRecord?.command_recovery)?.alternativeCommands,
    );
    const explicitProbeCommands = toStringArray(
        resultRecord?.probe_commands
            ?? toOptionalRecord(resultRecord?.command_recovery)?.probeCommands,
    );
    const explicitSuggestedFix = getString(resultRecord?.suggested_fix)
        ?? getString(toOptionalRecord(resultRecord?.command_recovery)?.suggestion)
        ?? undefined;
    const derivedRecovery = buildCommandRecoveryHints({
        command,
        stderr,
        exitCode,
    });
    const derivedAlternatives = derivedRecovery?.alternativeCommands ?? [];
    const retryCommands = buildAlternativeRetryCommandsForMessage({
        command,
        alternatives: explicitAlternatives.length > 0 ? explicitAlternatives : derivedAlternatives,
    });
    const probeCommands = explicitProbeCommands.length > 0
        ? explicitProbeCommands
        : (derivedRecovery?.probeCommands ?? []);
    if (retryCommands.length === 0 && probeCommands.length === 0 && !explicitSuggestedFix) {
        return null;
    }
    return {
        failedCommand: command,
        retryCommands,
        probeCommands,
        suggestedFix: explicitSuggestedFix ?? derivedRecovery?.suggestion,
        stderrSnippet: stderr.trim().slice(0, 240),
        toolName: normalizedToolName,
    };
}

function resolveCommandExitCodeFromResult(
    resultRecord: Record<string, unknown> | null | undefined,
    stderr: string,
): number | undefined {
    if (typeof resultRecord?.exitCode === 'number' && Number.isFinite(resultRecord.exitCode)) {
        return Math.trunc(resultRecord.exitCode);
    }
    if (typeof resultRecord?.exit_code === 'number' && Number.isFinite(resultRecord.exit_code)) {
        return Math.trunc(resultRecord.exit_code);
    }
    const match = COMMAND_RESULT_EXIT_CODE_PATTERN.exec(stderr);
    if (!match?.[1]) {
        return undefined;
    }
    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveCommandFailureInfoFromToolResult(input: {
    toolName: string;
    result: unknown;
    fallbackCommand?: string;
    isError?: boolean;
}): TaskTurnCommandFailureInfo | null {
    const normalizedToolName = input.toolName.trim().toLowerCase();
    if (!COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN.test(normalizedToolName)) {
        return null;
    }
    const resultRecord = toOptionalRecord(input.result);
    const explicitCommand = getString(resultRecord?.command);
    const failedCommand = explicitCommand?.trim() || input.fallbackCommand?.trim() || undefined;
    const stderrFromRecord = getString(resultRecord?.stderr) ?? getString(resultRecord?.error) ?? '';
    const diagnosticText = resolveCommandDiagnosticTextFromToolResult(input.result);
    const stderr = stderrFromRecord.trim().length > 0 ? stderrFromRecord : diagnosticText;
    const exitCode = resolveCommandExitCodeFromResult(resultRecord, stderr);
    const hasFailureSignal = (
        input.isError === true
        || isToolResultExplicitlyErrored(input.result)
        || (typeof exitCode === 'number' && exitCode !== 0)
        || COMMAND_EXECUTION_FAILURE_RESULT_PATTERN.test(stderr)
        || COMMAND_RESULT_EXIT_CODE_PATTERN.test(stderr)
    );
    if (!hasFailureSignal) {
        return null;
    }
    const normalizedSnippet = stderr.trim().replace(/\s+/gu, ' ').slice(0, 320);
    return {
        failedCommand,
        stderrSnippet: normalizedSnippet.length > 0 ? normalizedSnippet : undefined,
        exitCode,
        toolName: normalizedToolName,
    };
}

function appendCommandFailureContextToFailureMessage(input: {
    message: string;
    commandFailure?: TaskTurnCommandFailureInfo;
}): string {
    const normalizedMessage = input.message.trim();
    if (!input.commandFailure) {
        return normalizedMessage;
    }
    const segments: string[] = [];
    if (input.commandFailure.failedCommand) {
        segments.push(`command=${input.commandFailure.failedCommand}`);
    }
    if (typeof input.commandFailure.exitCode === 'number') {
        segments.push(`exitCode=${input.commandFailure.exitCode}`);
    }
    if (input.commandFailure.stderrSnippet) {
        segments.push(`stderr=${input.commandFailure.stderrSnippet}`);
    }
    if (segments.length === 0) {
        return normalizedMessage;
    }
    const context = segments.join('; ');
    return normalizedMessage.includes(context)
        ? normalizedMessage
        : `${normalizedMessage} [command_failure: ${context}]`;
}

function buildCommandFailureReadableDelta(input: {
    commandFailure: TaskTurnCommandFailureInfo;
}): string {
    const lines: string[] = [
        '已定位到失败步骤：命令执行阶段报错。',
    ];
    if (input.commandFailure.failedCommand) {
        lines.push(`失败命令：${input.commandFailure.failedCommand}`);
    }
    if (typeof input.commandFailure.exitCode === 'number') {
        lines.push(`退出码：${input.commandFailure.exitCode}`);
    }
    if (input.commandFailure.stderrSnippet) {
        lines.push(`错误信息：${input.commandFailure.stderrSnippet}`);
    }
    lines.push('建议：仅重试当前失败步骤（无需重跑整个任务），修正该命令后继续后续步骤。');
    return lines.join('\n');
}

export function deriveHostControlShellCommand(message: string): string {
    const normalized = message.trim();
    const isTrashCleanup = /\b(empty\s+(?:the\s+)?(?:trash|recycle\s+bin)|clear\s+(?:the\s+)?(?:trash|recycle\s+bin))\b|清空(?:回收站|垃圾桶)/iu.test(normalized);
    if (isTrashCleanup) {
        if (process.platform === 'darwin') {
            return `osascript -e 'tell application "Finder" to empty the trash'`;
        }
        if (process.platform === 'win32') {
            return 'PowerShell -NoProfile -Command "Clear-RecycleBin -Force"';
        }
        return 'if command -v gio >/dev/null 2>&1; then gio trash --empty; elif command -v trash-empty >/dev/null 2>&1; then trash-empty; else echo "no_supported_trash_cli"; exit 127; fi';
    }
    const isReboot = /\b(reboot)\b|重启/u.test(normalized);
    const hourMatch = normalized.match(HOUR_CUE_PATTERN);
    if (hourMatch?.[1]) {
        const hour = hourMatch[1].padStart(2, '0');
        return isReboot
            ? `sudo shutdown -r ${hour}00`
            : `sudo shutdown -h ${hour}00`;
    }
    return isReboot
        ? 'sudo shutdown -r now'
        : 'sudo shutdown -h now';
}

function isToolResultExplicitlyErrored(result: unknown): boolean {
    const record = toOptionalRecord(result);
    if (!record) {
        return false;
    }
    if (record.success === false || record.ok === false) {
        return true;
    }
    const errorValue = record.error;
    const error = typeof errorValue === 'string' ? errorValue.trim().toLowerCase() : '';
    if (error.length > 0) {
        return TOOL_RESULT_ERROR_CODE_PATTERN.test(error)
            || /^(error|failed|failure|exception)$/iu.test(error);
    }
    const statusValue = record.status;
    const status = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : '';
    if (status.length === 0) {
        return false;
    }
    return status === 'error' || status === 'failed' || status === 'failure';
}

function isToolResultExplicitlySuccessful(result: unknown): boolean {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
        return false;
    }
    const record = result as Record<string, unknown>;
    if (record.success === true || record.ok === true) {
        return true;
    }
    const statusValue = record.status;
    const status = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : '';
    if (status.length === 0) {
        return false;
    }
    return status === 'ok' || status === 'success' || status === 'completed' || status === 'done';
}

function normalizeToolResultNarrativeText(result: unknown): string {
    if (typeof result === 'string') {
        return result.trim();
    }
    if (!result || typeof result !== 'object') {
        return '';
    }
    const record = result as Record<string, unknown>;
    const candidate = [
        record.text,
        record.content,
        record.summary,
        record.output,
        record.answer,
        record.message,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);
    return typeof candidate === 'string' ? candidate.trim() : '';
}

function extractFinalSynthesisTextFromToolResult(input: {
    toolName: string;
    isError: boolean;
    result: unknown;
}): string {
    if (input.isError) {
        return '';
    }
    if (input.toolName.trim().toLowerCase() !== 'final_synthesis') {
        return '';
    }
    return normalizeToolResultNarrativeText(input.result);
}

function hasUsableToolResultPayloadValue(value: unknown, depth = 0): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    if (depth > 4) {
        return false;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return false;
        }
        return !TOOL_RESULT_ERROR_CODE_PATTERN.test(trimmed);
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.some((entry) => hasUsableToolResultPayloadValue(entry, depth + 1));
    }
    if (typeof value !== 'object') {
        return false;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record);
    if (entries.length === 0) {
        return false;
    }
    for (const [key, fieldValue] of entries) {
        if (
            TOOL_RESULT_METADATA_FIELD_PATTERN.test(key)
            || TOOL_RESULT_SUCCESS_FIELD_PATTERN.test(key)
        ) {
            continue;
        }
        if (TOOL_RESULT_ERROR_CODE_PATTERN.test(key)) {
            continue;
        }
        if (TOOL_RESULT_PAYLOAD_FIELD_PATTERN.test(key)) {
            if (hasUsableToolResultPayloadValue(fieldValue, depth + 1)) {
                return true;
            }
            continue;
        }
        if (hasUsableToolResultPayloadValue(fieldValue, depth + 1)) {
            return true;
        }
    }
    return false;
}

function hasUsableToolResultPayload(result: unknown): boolean {
    if (result === null || result === undefined) {
        return false;
    }
    if (isToolResultExplicitlyErrored(result)) {
        return false;
    }
    if (typeof result === 'string') {
        const normalized = result.trim();
        if (normalized.length === 0) {
            return false;
        }
        return !TOOL_RESULT_ERROR_CODE_PATTERN.test(normalized);
    }
    if (Array.isArray(result)) {
        return result.length > 0 && hasUsableToolResultPayloadValue(result);
    }
    if (typeof result === 'object') {
        const record = result as Record<string, unknown>;
        if (Object.keys(record).length === 0) {
            return false;
        }
        return hasUsableToolResultPayloadValue(record);
    }
    return false;
}

function isLikelyTaskExecutionNarrationChunk(chunk: string): boolean {
    const normalized = chunk.trim();
    if (normalized.length < 10) {
        return false;
    }
    return TASK_EXECUTION_NARRATION_PREFIX_PATTERN.test(normalized)
        && TASK_EXECUTION_NARRATION_ACTION_PATTERN.test(normalized);
}

function isLikelyTaskMetaReasoningChunk(chunk: string): boolean {
    const normalized = chunk.trim();
    if (normalized.length < 16) {
        return false;
    }
    return TASK_META_REASONING_PATTERN.test(normalized)
        || TASK_META_REASONING_INLINE_PATTERN.test(normalized);
}

function resolveToolResultEvidenceStrength(input: {
    event: Extract<DesktopEvent, { type: 'tool_result' }>;
    requiredCompletionCapabilities: string[];
}): 'weak' | 'strong' {
    const toolName = input.event.toolName.trim();
    if (input.event.isError === true || toolName.length === 0) {
        return 'weak';
    }
    const requiredCapabilities = input.requiredCompletionCapabilities.map((value) => value.toLowerCase());
    const requiresVoiceOutput = requiredCapabilities.includes(VOICE_OUTPUT_CAPABILITY);
    const requiresWebResearch = requiredCapabilities.includes(WEB_RESEARCH_CAPABILITY);
    const requiresFilesystemRead = requiredCapabilities.includes(FILESYSTEM_READ_CAPABILITY);
    const requiresCommandExecution = requiredCapabilities.includes(COMMAND_EXECUTION_CAPABILITY);
    const requiresArtifactWrite = requiredCapabilities.includes(ARTIFACT_WRITE_CAPABILITY);
    const requiresCapability = requiresVoiceOutput || requiresWebResearch || requiresFilesystemRead || requiresCommandExecution || requiresArtifactWrite;
    if (!requiresCapability) {
        return 'strong';
    }
    const matchesRequiredCapability = (
        (requiresVoiceOutput && VOICE_OUTPUT_EVIDENCE_TOOL_PATTERN.test(toolName))
        || (requiresCommandExecution && COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN.test(toolName))
        || (requiresWebResearch && WEB_RESEARCH_EVIDENCE_TOOL_PATTERN.test(toolName))
        || (requiresFilesystemRead && FILESYSTEM_READ_EVIDENCE_TOOL_PATTERN.test(toolName))
        || (requiresArtifactWrite && ARTIFACT_WRITE_EVIDENCE_TOOL_PATTERN.test(toolName))
    );
    if (!matchesRequiredCapability) {
        return 'weak';
    }
    const hasExplicitError = isToolResultExplicitlyErrored(input.event.result);
    if (hasExplicitError) {
        return 'weak';
    }
    if (hasUsableToolResultPayload(input.event.result)) {
        return 'strong';
    }
    // Some tools can complete successfully with sparse payloads (for example file writes).
    // Keep web_research strict: empty/low-quality results should trigger retry/repair.
    if (
        isToolResultExplicitlySuccessful(input.event.result)
        && (requiresVoiceOutput || requiresFilesystemRead || requiresCommandExecution || requiresArtifactWrite)
    ) {
        return 'strong';
    }
    return 'weak';
}

function resolveNonResultToolEvidenceStrength(input: {
    event: Extract<DesktopEvent, { type: 'tool_call' | 'approval_required' }>;
    requiredCompletionCapabilities: string[];
    isDelegatedAgentToolCall: boolean;
}): 'weak' | 'strong' {
    const requiredCapabilities = input.requiredCompletionCapabilities.map((value) => value.toLowerCase());
    const requiresVoiceOutput = requiredCapabilities.includes(VOICE_OUTPUT_CAPABILITY);
    const requiresWebResearch = requiredCapabilities.includes(WEB_RESEARCH_CAPABILITY);
    const requiresFilesystemRead = requiredCapabilities.includes(FILESYSTEM_READ_CAPABILITY);
    const requiresCommandExecution = requiredCapabilities.includes(COMMAND_EXECUTION_CAPABILITY);
    const requiresArtifactWrite = requiredCapabilities.includes(ARTIFACT_WRITE_CAPABILITY);
    const toolName = typeof input.event.toolName === 'string' ? input.event.toolName.trim() : '';
    if (!requiresWebResearch && !requiresVoiceOutput && !requiresFilesystemRead && !requiresCommandExecution && !requiresArtifactWrite) {
        return (
            input.event.type === 'approval_required'
            || (input.event.type === 'tool_call' && !input.isDelegatedAgentToolCall)
        )
            ? 'strong'
            : 'weak';
    }
    if (input.event.type === 'tool_call') {
        if (toolName.length === 0) {
            return 'weak';
        }
        const matchesRequiredCapability = (
            (requiresVoiceOutput && VOICE_OUTPUT_EVIDENCE_TOOL_PATTERN.test(toolName))
            || (requiresCommandExecution && COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN.test(toolName))
            || (requiresWebResearch && WEB_RESEARCH_EVIDENCE_TOOL_PATTERN.test(toolName))
            || (requiresFilesystemRead && FILESYSTEM_READ_EVIDENCE_TOOL_PATTERN.test(toolName))
            || (requiresArtifactWrite && ARTIFACT_WRITE_EVIDENCE_TOOL_PATTERN.test(toolName))
        );
        if (!matchesRequiredCapability) {
            return 'weak';
        }
        if (input.isDelegatedAgentToolCall) {
            return 'weak';
        }
        // For capability-required tasks, a call event alone is not sufficient evidence.
        // Require a successful tool_result payload to satisfy completion protocol.
        return 'weak';
    }
    if (input.event.type !== 'approval_required') {
        return 'weak';
    }
    if (toolName.length === 0) {
        return 'weak';
    }
    const matchesVoice = requiresVoiceOutput && VOICE_OUTPUT_EVIDENCE_TOOL_PATTERN.test(toolName);
    const matchesCommand = requiresCommandExecution && COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN.test(toolName);
    const matchesWeb = requiresWebResearch
        && (WEB_RESEARCH_EVIDENCE_TOOL_PATTERN.test(toolName) || WEB_RESEARCH_APPROVAL_FALLBACK_TOOL_PATTERN.test(toolName));
    const matchesFilesystemRead = requiresFilesystemRead && FILESYSTEM_READ_EVIDENCE_TOOL_PATTERN.test(toolName);
    const matchesArtifactWrite = requiresArtifactWrite && ARTIFACT_WRITE_EVIDENCE_TOOL_PATTERN.test(toolName);
    if (!matchesVoice && !matchesCommand && !matchesWeb && !matchesFilesystemRead && !matchesArtifactWrite) {
        return 'weak';
    }
    // Artifact writing requires a successful tool_result before completion.
    if (matchesArtifactWrite && !matchesVoice && !matchesCommand && !matchesWeb) {
        return 'weak';
    }
    // Approval-required events indicate a real executable invocation pending user/policy gating.
    return 'strong';
}

function resolveSatisfiedCompletionCapabilitiesFromToolEvidence(input: {
    event: Extract<DesktopEvent, { type: 'tool_result' | 'tool_call' | 'approval_required' }>;
    requiredCompletionCapabilities: string[];
    isDelegatedAgentToolCall: boolean;
}): string[] {
    const requiredCompletionCapabilities = normalizeStringList(
        input.requiredCompletionCapabilities.map((value) => value.toLowerCase()),
    );
    if (requiredCompletionCapabilities.length === 0) {
        return [];
    }
    const satisfied: string[] = [];
    for (const capability of requiredCompletionCapabilities) {
        const evidenceStrength = input.event.type === 'tool_result'
            ? resolveToolResultEvidenceStrength({
                event: input.event,
                requiredCompletionCapabilities: [capability],
            })
            : resolveNonResultToolEvidenceStrength({
                event: input.event,
                requiredCompletionCapabilities: [capability],
                isDelegatedAgentToolCall: input.isDelegatedAgentToolCall,
            });
        if (evidenceStrength === 'strong') {
            satisfied.push(capability);
        }
    }
    return normalizeStringList(satisfied);
}

function resolveToolResultAttemptedCompletionCapabilities(input: {
    event: Extract<DesktopEvent, { type: 'tool_result' }>;
    requiredCompletionCapabilities: string[];
}): string[] {
    const requiredCompletionCapabilities = normalizeStringList(
        input.requiredCompletionCapabilities.map((value) => value.toLowerCase()),
    );
    if (requiredCompletionCapabilities.length === 0) {
        return [];
    }
    const toolName = typeof input.event.toolName === 'string' ? input.event.toolName.trim() : '';
    if (toolName.length === 0) {
        return [];
    }
    const attempted: string[] = [];
    for (const capability of requiredCompletionCapabilities) {
        if (capability === VOICE_OUTPUT_CAPABILITY && VOICE_OUTPUT_EVIDENCE_TOOL_PATTERN.test(toolName)) {
            attempted.push(capability);
            continue;
        }
        if (capability === COMMAND_EXECUTION_CAPABILITY && COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN.test(toolName)) {
            attempted.push(capability);
            continue;
        }
        if (capability === WEB_RESEARCH_CAPABILITY && WEB_RESEARCH_EVIDENCE_TOOL_PATTERN.test(toolName)) {
            attempted.push(capability);
            continue;
        }
        if (capability === FILESYSTEM_READ_CAPABILITY && FILESYSTEM_READ_EVIDENCE_TOOL_PATTERN.test(toolName)) {
            attempted.push(capability);
            continue;
        }
        if (capability === ARTIFACT_WRITE_CAPABILITY && ARTIFACT_WRITE_EVIDENCE_TOOL_PATTERN.test(toolName)) {
            attempted.push(capability);
        }
    }
    return normalizeStringList(attempted);
}

function isIpcTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('IPC response timeout');
}
function resolveLateApprovalGraceMs(
    env: Record<string, string | undefined> = process.env,
): number {
    const raw = env.COWORKANY_MASTRA_LATE_APPROVAL_GRACE_MS;
    const parsed = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
    }
    return DEFAULT_LATE_APPROVAL_GRACE_MS;
}
function resolveAutoApprovalResumeTimeoutMs(
    env: Record<string, string | undefined> = process.env,
): number {
    const raw = env.COWORKANY_MASTRA_AUTO_APPROVAL_RESUME_TIMEOUT_MS;
    const parsed = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= 1_000) {
        return parsed;
    }
    return DEFAULT_AUTO_APPROVAL_RESUME_TIMEOUT_MS;
}

function resolveBoundedEnvInt(
    name: string,
    fallback: number,
    min: number,
    max: number,
    env: Record<string, string | undefined> = process.env,
): number {
    const raw = env[name];
    const parsed = Number.parseInt(raw ?? '', 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function resolveChatTurnTimeoutMs(
    env: Record<string, string | undefined> = process.env,
): number {
    return resolveBoundedEnvInt(
        'COWORKANY_MASTRA_CHAT_TURN_TIMEOUT_MS',
        DEFAULT_CHAT_TURN_TIMEOUT_MS,
        30_000,
        180_000,
        env,
    );
}

function resolveChatStartupBudgetMs(
    env: Record<string, string | undefined> = process.env,
): number {
    return resolveBoundedEnvInt(
        'COWORKANY_MASTRA_CHAT_STARTUP_BUDGET_MS',
        DEFAULT_CHAT_STARTUP_BUDGET_MS,
        15_000,
        120_000,
        env,
    );
}

function resolveTaskTurnTimeoutMs(
    env: Record<string, string | undefined> = process.env,
): number {
    return resolveBoundedEnvInt(
        'COWORKANY_MASTRA_TASK_TURN_TIMEOUT_MS',
        DEFAULT_TASK_TURN_TIMEOUT_MS,
        30_000,
        240_000,
        env,
    );
}

function resolveCommandOnlyTaskTurnTimeoutMs(
    env: Record<string, string | undefined> = process.env,
): number {
    return resolveBoundedEnvInt(
        'COWORKANY_MASTRA_COMMAND_ONLY_TASK_TURN_TIMEOUT_MS',
        DEFAULT_COMMAND_ONLY_TASK_TURN_TIMEOUT_MS,
        30_000,
        180_000,
        env,
    );
}

function resolveTaskStartupBudgetMs(
    env: Record<string, string | undefined> = process.env,
): number {
    return resolveBoundedEnvInt(
        'COWORKANY_MASTRA_TASK_STARTUP_BUDGET_MS',
        DEFAULT_TASK_STARTUP_BUDGET_MS,
        15_000,
        120_000,
        env,
    );
}

function resolveMissingToolEvidenceAutoRetryMaxAttempts(
    env: Record<string, string | undefined> = process.env,
): number {
    return resolveBoundedEnvInt(
        'COWORKANY_PROTOCOL_MISSING_TOOL_EVIDENCE_AUTO_RETRY_MAX_ATTEMPTS',
        DEFAULT_PROTOCOL_MISSING_TOOL_EVIDENCE_AUTO_RETRY_MAX_ATTEMPTS,
        0,
        10,
        env,
    );
}

function resolveMissingToolEvidenceAutoRetryDelayMs(
    env: Record<string, string | undefined> = process.env,
): number {
    return resolveBoundedEnvInt(
        'COWORKANY_PROTOCOL_MISSING_TOOL_EVIDENCE_AUTO_RETRY_DELAY_MS',
        DEFAULT_PROTOCOL_MISSING_TOOL_EVIDENCE_AUTO_RETRY_DELAY_MS,
        100,
        10_000,
        env,
    );
}

function resolveAdaptiveMissingToolEvidenceRetryCeiling(input: {
    configuredMaxAttempts: number;
    requiredCapabilityCount: number;
}): number {
    if (input.requiredCapabilityCount >= 2) {
        return ADAPTIVE_MISSING_TOOL_EVIDENCE_RETRY_MAX_ATTEMPTS_CAP;
    }
    return Math.max(2, Math.min(3, input.configuredMaxAttempts));
}

function resolveAdaptiveMissingToolEvidenceRetryMaxAttempts(input: {
    configuredMaxAttempts: number;
    currentAttempts: number;
    lastError?: string;
    requiredCapabilities: string[];
}): number {
    const boundedConfiguredMaxAttempts = Number.isFinite(input.configuredMaxAttempts)
        ? Math.max(0, Math.floor(input.configuredMaxAttempts))
        : 0;
    if (boundedConfiguredMaxAttempts <= 0) {
        return 0;
    }
    const boundedCurrentAttempts = Number.isFinite(input.currentAttempts)
        ? Math.max(0, Math.floor(input.currentAttempts))
        : 0;
    const normalizedLastError = String(input.lastError ?? '').trim().toLowerCase();
    const isMissingToolEvidenceFailure = normalizedLastError.includes('complete_without_required_tool_evidence');
    const classification = (
        !isMissingToolEvidenceFailure && normalizedLastError.length > 0
    )
        ? classifyRuntimeErrorMessage(normalizedLastError)
        : undefined;

    if (classification) {
        if (classification.failureClass === 'blocked' || classification.failureClass === 'configuration_required') {
            return Math.max(
                ADAPTIVE_MISSING_TOOL_EVIDENCE_RETRY_MIN_ATTEMPTS,
                Math.min(boundedConfiguredMaxAttempts, boundedCurrentAttempts),
            );
        }
    }

    const shouldExpandBudget = (
        boundedCurrentAttempts >= boundedConfiguredMaxAttempts
        && (
            isMissingToolEvidenceFailure
            || (
                classification?.failureClass === 'retryable'
            )
        )
    );
    if (!shouldExpandBudget) {
        return Math.max(
            ADAPTIVE_MISSING_TOOL_EVIDENCE_RETRY_MIN_ATTEMPTS,
            Math.min(ADAPTIVE_MISSING_TOOL_EVIDENCE_RETRY_MAX_ATTEMPTS_CAP, boundedConfiguredMaxAttempts),
        );
    }

    const ceiling = resolveAdaptiveMissingToolEvidenceRetryCeiling({
        configuredMaxAttempts: boundedConfiguredMaxAttempts,
        requiredCapabilityCount: input.requiredCapabilities.length,
    });
    return Math.max(
        ADAPTIVE_MISSING_TOOL_EVIDENCE_RETRY_MIN_ATTEMPTS,
        Math.min(ceiling, boundedConfiguredMaxAttempts + 1),
    );
}

function resolveMissingToolEvidenceRetryFloor(requiredCapabilities: string[]): number {
    const normalized = normalizeStringList(requiredCapabilities.map((value) => value.toLowerCase()));
    if (normalized.length === 0) {
        return 0;
    }
    return normalized.every((value) => LOW_RISK_MISSING_TOOL_EVIDENCE_RETRY_CAPABILITIES.has(value))
        ? 1
        : 0;
}

function isAutoApprovalDebugEnabled(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return env.COWORKANY_DEBUG_AUTO_APPROVAL === '1';
}
function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}
function toOptionalRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}
function toProtocolCommand(value: unknown): ProtocolCommand | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as ProtocolCommand;
}
function getString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeLegacyApprovalResultCommand(command: ProtocolCommand): ProtocolCommand {
    if (command.type !== 'request_effect_response') {
        return command;
    }

    const payload = toRecord(command.payload);
    const hasForwardMetadata = Boolean(getString(payload.taskId) || getString(payload.effectType));
    if (hasForwardMetadata) {
        return command;
    }

    const directRequestId = getString(payload.requestId);
    const directSuccess = payload.success;
    if (directRequestId && typeof directSuccess === 'boolean') {
        return {
            ...command,
            type: 'report_effect_result',
            payload,
        };
    }

    const nestedResponse = toOptionalRecord(payload.response);
    const nestedRequestId = nestedResponse ? getString(nestedResponse.requestId) : null;
    const nestedApproved = nestedResponse?.approved;
    if (!nestedRequestId || typeof nestedApproved !== 'boolean') {
        return command;
    }
    const confirmedNestedResponse = nestedResponse!;

    return {
        ...command,
        type: 'report_effect_result',
        payload: {
            ...payload,
            requestId: nestedRequestId,
            success: nestedApproved,
            reason: getString(payload.reason) ?? getString(confirmedNestedResponse.denialReason) ?? undefined,
            approvalType: payload.approvalType ?? confirmedNestedResponse.approvalType,
        },
    };
}

function sanitizeLegacyPlannedOutputPath(value: string): string {
    const trimmed = value.trim();
    if (LEGACY_LEAKED_PLANNED_OUTPUT_PATTERN.test(trimmed)) {
        return 'reports/task-output.md';
    }
    return trimmed;
}

function extractLegacyPathTargetsFromArtifactContract(contract: Record<string, unknown>): string[] {
    const expectedArtifacts = Array.isArray(contract.expectedArtifacts)
        ? contract.expectedArtifacts
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
        : [];
    if (expectedArtifacts.length > 0) {
        return expectedArtifacts;
    }
    if (!Array.isArray(contract.requirements)) {
        return [];
    }
    return contract.requirements
        .map((item) => toRecord(item))
        .map((item) => getString(toRecord(item.payload).path))
        .filter((item): item is string => Boolean(item))
        .map((item) => item.trim());
}

function buildLegacyPlannedArtifactContract(sourceQuery: string, paths: string[]): Record<string, unknown> {
    return {
        sourceQuery,
        requirements: paths.map((targetPath, index) => ({
            id: `planned-deliverable-${index + 1}`,
            kind: 'file',
            description: `Planned deliverable file: ${path.basename(targetPath)}`,
            strictness: 'hard',
            payload: {
                extension: path.extname(targetPath) || '.md',
                path: targetPath,
                source: 'planned_deliverable',
            },
        })),
    };
}

function extractSaveTargetFromMessage(message?: string): string | null {
    if (!message || message.trim().length === 0) {
        return null;
    }
    const matched = LEGACY_SAVE_TARGET_PATTERN.exec(message);
    if (matched && matched.length >= 2) {
        const candidate = matched[1]?.trim();
        if (candidate && candidate.length > 0) {
            return candidate;
        }
    }
    const hasSaveIntent = /(?:save(?:\s+it)?\s+to|write(?:\s+(?:it|result|output|report|file))?\s+to|保存到|写入|输出到)/iu
        .test(message);
    if (!hasSaveIntent) {
        return null;
    }
    const pathMatch = LEGACY_PATH_TOKEN_PATTERN.exec(message);
    LEGACY_PATH_TOKEN_PATTERN.lastIndex = 0;
    return pathMatch?.[0] ?? null;
}

function getNonNegativeInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return Math.floor(value);
}

function getOptionalFiniteNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return value;
}
function parseVoiceProviderMode(value: unknown): 'auto' | 'system' | 'custom' | undefined {
    return value === 'auto' || value === 'system' || value === 'custom'
        ? value
        : undefined;
}
function parseHookRuntimeEventType(
    value: unknown,
): 'SessionStart' | 'TaskCreated' | 'RemoteSessionLinked' | 'ChannelEventInjected' | 'PermissionRequest' | 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'PostCompact' | 'TaskCompleted' | 'TaskFailed' | 'TaskRewound' | undefined {
    return value === 'SessionStart'
        || value === 'TaskCreated'
        || value === 'RemoteSessionLinked'
        || value === 'ChannelEventInjected'
        || value === 'PermissionRequest'
        || value === 'PreToolUse'
        || value === 'PostToolUse'
        || value === 'PreCompact'
        || value === 'PostCompact'
        || value === 'TaskCompleted'
        || value === 'TaskFailed'
        || value === 'TaskRewound'
        ? value
        : undefined;
}
function buildUnsupportedAutonomousResponse(
    commandType: string,
    payload: Record<string, unknown>,
): { type: string; payload: Record<string, unknown> } | null {
    if (commandType === 'start_autonomous_task') {
        return {
            type: 'start_autonomous_task_response',
            payload: {
                success: false,
                taskId: getString(payload.taskId) ?? '',
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    if (commandType === 'get_autonomous_task_status') {
        return {
            type: 'get_autonomous_task_status_response',
            payload: {
                success: false,
                task: null,
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    if (
        commandType === 'pause_autonomous_task'
        || commandType === 'resume_autonomous_task'
        || commandType === 'cancel_autonomous_task'
    ) {
        return {
            type: `${commandType}_response`,
            payload: {
                success: false,
                taskId: getString(payload.taskId) ?? '',
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    if (commandType === 'list_autonomous_tasks') {
        return {
            type: 'list_autonomous_tasks_response',
            payload: {
                success: false,
                tasks: [],
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    return null;
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
    return /\b(cancel|stop|abort|terminate)\b/i.test(trimmed) && /\b(reminder|scheduled?|task)\b/i.test(trimmed);
}
function isStoreDisabledHistoryReferenceError(message: string): boolean {
    const normalized = message.toLowerCase();
    const mentionsStoreDisabled = normalized.includes('store')
        && normalized.includes('false')
        && (
            normalized.includes('not persisted')
            || normalized.includes('store is set to false')
        );
    if (mentionsStoreDisabled) {
        return true;
    }
    return normalized.includes('item with id')
        && normalized.includes('not found')
        && normalized.includes('store')
        && normalized.includes('false');
}
function isNoAssistantNarrativeRuntimeError(message: string): boolean {
    return /\b(stream_exhausted_without_assistant_text|complete_without_assistant_text)\b/i.test(message);
}
function isRetryableRuntimeStreamError(message: string): boolean {
    return /\b(stream_idle_timeout|stream_progress_timeout|stream_exhausted_without_assistant_text|complete_without_assistant_text|missing_terminal_after_tooling_progress|generate_fallback_timeout|No snapshot found for this workflow run|timeout|timed out|aborterror|econnreset|etimedout|socket hang up|network|429|rate.?limit|temporar(?:y|ily)|unavailable|gateway|upstream|unable to get issuer certificate|unable to verify (?:the first|leaf) certificate|self[-\s]?signed certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_[A-Z_]+)\b/i
        .test(message);
}

function normalizeTaskFailureMessage(
    message: string,
    classification: RuntimeFailureClassification,
    commandFailure?: TaskTurnCommandFailureInfo,
): string {
    const normalizedMessage = message.trim().length > 0
        ? message
        : 'runtime_error';
    const codeHint = (() => {
        if (classification.errorCode === 'PROVIDER_QUOTA_EXCEEDED') {
            return 'insufficient_user_quota';
        }
        if (classification.errorCode === 'PROVIDER_TEMPORARILY_UNAVAILABLE') {
            return 'provider_temporarily_unavailable';
        }
        if (classification.errorCode === 'PROVIDER_CONFIG_REQUIRED') {
            return 'provider_config_required';
        }
        return null;
    })();
    if (!codeHint) {
        return appendCommandFailureContextToFailureMessage({
            message: normalizedMessage,
            commandFailure,
        });
    }
    if (normalizedMessage.toLowerCase().includes(codeHint)) {
        return appendCommandFailureContextToFailureMessage({
            message: normalizedMessage,
            commandFailure,
        });
    }
    return appendCommandFailureContextToFailureMessage({
        message: `${normalizedMessage} [${codeHint}]`,
        commandFailure,
    });
}

function isWorkflowSnapshotMissingError(message: string): boolean {
    return /\bNo snapshot found for this workflow run\b/i.test(message);
}
function pickResourceOverride(payload: Record<string, unknown>): string | null {
    const fromPayload = getString(payload.resourceId) ?? getString(payload.memoryResourceId);
    if (fromPayload) {
        return fromPayload;
    }
    const context = toRecord(payload.context);
    const fromContext = getString(context.resourceId) ?? getString(context.memoryResourceId);
    if (fromContext) {
        return fromContext;
    }
    const config = toRecord(payload.config);
    return getString(config.resourceId) ?? getString(config.memoryResourceId);
}

function parseRemoteSessionScope(
    payload: Record<string, unknown>,
    metadata?: Record<string, unknown>,
): RemoteSessionScope {
    const payloadScope = getString(payload.scope);
    if (payloadScope === 'managed' || payloadScope === 'project' || payloadScope === 'user') {
        return payloadScope;
    }
    const metadataScope = metadata ? getString(metadata.scope) : null;
    if (metadataScope === 'managed' || metadataScope === 'project' || metadataScope === 'user') {
        return metadataScope;
    }
    const storedScope = metadata ? getString(metadata[REMOTE_SESSION_SCOPE_METADATA_KEY]) : null;
    if (storedScope === 'managed' || storedScope === 'project' || storedScope === 'user') {
        return storedScope;
    }
    return 'project';
}

function withRemoteSessionScopeMetadata(
    metadata: Record<string, unknown> | undefined,
    scope: RemoteSessionScope,
): Record<string, unknown> | undefined {
    if (!metadata) {
        return {
            [REMOTE_SESSION_SCOPE_METADATA_KEY]: scope,
        };
    }
    return {
        ...metadata,
        [REMOTE_SESSION_SCOPE_METADATA_KEY]: scope,
    };
}

function pickTenantFromPayloadOrMetadata(payload: Record<string, unknown>): string | undefined {
    const metadataTenant = pickRemoteTenantId(toRecord(payload.metadata));
    if (metadataTenant) {
        return metadataTenant;
    }
    const keys = ['tenantId', 'tenant', 'organizationId', 'orgId'];
    for (const key of keys) {
        const value = getString(payload[key]);
        if (value) {
            return value;
        }
    }
    return undefined;
}

function pickRemoteTenantId(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) {
        return undefined;
    }
    const keys = ['tenantId', 'tenant', 'organizationId', 'orgId'];
    for (const key of keys) {
        const value = getString(metadata[key]);
        if (value) {
            return value;
        }
    }
    return undefined;
}

function pickRemoteEndpointId(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) {
        return undefined;
    }
    const keys = ['endpointId', 'clientId', 'deviceId', 'connectionId'];
    for (const key of keys) {
        const value = getString(metadata[key]);
        if (value) {
            return value;
        }
    }
    return undefined;
}

function resolveRemoteSessionGovernancePolicy(
    policy?: Partial<RemoteSessionGovernancePolicy>,
): RemoteSessionGovernancePolicy {
    const strategy = policy?.conflictStrategy;
    const conflictStrategy: RemoteSessionConflictStrategy = (
        strategy === 'reject'
        || strategy === 'takeover'
        || strategy === 'takeover_if_stale'
    )
        ? strategy
        : 'reject';
    const staleAfterMs = (
        typeof policy?.staleAfterMs === 'number'
        && Number.isFinite(policy.staleAfterMs)
        && policy.staleAfterMs >= 1_000
    )
        ? Math.floor(policy.staleAfterMs)
        : DEFAULT_REMOTE_SESSION_STALE_AFTER_MS;
    return {
        conflictStrategy,
        staleAfterMs,
        enforceTenantIsolation: policy?.enforceTenantIsolation === true,
        requireTenantIdForManaged: policy?.requireTenantIdForManaged === true,
        requireEndpointIdForManaged: policy?.requireEndpointIdForManaged === true,
        enforceEndpointIsolation: policy?.enforceEndpointIsolation === true,
        enforceManagedIdentityImmutable: policy?.enforceManagedIdentityImmutable === true,
        requireTenantIdForManagedCommands: policy?.requireTenantIdForManagedCommands === true,
    };
}

function pickBooleanConfigValue(config: Record<string, unknown>, key: string): boolean | undefined {
    const value = config[key];
    return typeof value === 'boolean' ? value : undefined;
}

function pickStringConfigValue(config: Record<string, unknown>, key: string): string | undefined {
    const value = getString(config[key]);
    return value ?? undefined;
}

function pickPositiveIntegerConfigValue(
    config: Record<string, unknown>,
    key: string,
    min: number,
    max: number,
): number | undefined {
    const value = config[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    const normalized = Math.floor(value);
    if (normalized < min || normalized > max) {
        return undefined;
    }
    return normalized;
}

function pickStringArrayConfigValue(config: Record<string, unknown>, key: string): string[] | undefined {
    const value = config[key];
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    return normalized.length > 0 ? normalized : undefined;
}

function pickTaskRuntimeRetryConfig(config: Record<string, unknown>): TaskRuntimeRetryState | undefined {
    // `maxRetries: 0` is an explicit contract to disable auto retry.
    const maxRetries = pickPositiveIntegerConfigValue(config, 'maxRetries', 0, 10);
    if (typeof maxRetries !== 'number') {
        return undefined;
    }
    return {
        attempts: 0,
        maxAttempts: maxRetries,
        lastRetryAt: undefined,
        lastError: undefined,
    };
}

function pickTaskExecutionPath(config: Record<string, unknown>): 'direct' | 'workflow' | undefined {
    const value = getString(config.executionPath);
    if (value === 'direct' || value === 'workflow') {
        return value;
    }
    return undefined;
}

function toUserMessageExecutionPath(path?: TaskRuntimeExecutionPath): 'direct' | 'workflow' {
    return path === 'direct' ? 'direct' : 'workflow';
}

function buildResponse(
    commandId: string,
    type: string,
    payload: Record<string, unknown>,
    getNowIso: () => string,
): OutgoingMessage {
    return {
        type,
        commandId,
        timestamp: getNowIso(),
        payload,
    };
}

// Tools that are safe to auto-approve without user confirmation
const AUTO_APPROVE_TOOLS = new Set([
    'updateWorkingMemory',
]);
const WORKSPACE_EXECUTE_COMMAND_TOOL = 'mastra_workspace_execute_command';
const READ_ONLY_WORKSPACE_TOOLS = new Set([
    'mastra_workspace_list_files',
    'mastra_workspace_read_file',
    'mastra_workspace_file_stat',
    'list_dir',
    'view_file',
    'read_file',
]);
const WEB_RESEARCH_CAPABILITY = 'web_research';
const FILESYSTEM_READ_CAPABILITY = 'filesystem_read';
const VOICE_OUTPUT_CAPABILITY = 'voice_output';
const COMMAND_EXECUTION_CAPABILITY = 'command_execution';
const ARTIFACT_WRITE_CAPABILITY = 'artifact_write';
const LEGACY_RUNTIME_STATE_FILE = 'task-runtime.json';
const LEGACY_LEAKED_PLANNED_OUTPUT_PATTERN = /^reports\/\d+-x-planned-output-artifact-.*-checkpoint-before-final-delivery\.[a-z0-9]+$/iu;
const LEGACY_SAVE_TARGET_PATTERN = /(?:save(?:\s+it)?\s+to|write(?:\s+(?:it|result|output|report|file))?\s+to|保存到|写入|输出到)\s+([^\s,，。!?]+)/iu;
const LEGACY_PATH_TOKEN_PATTERN = /(?:\/|\.\/|\.\.\/|~\/|[A-Za-z]:\\)[^\s,，。!?"'`]+/gu;
const TASK_SUMMARY_MIN_CHARS = 100;
const TASK_PROGRESS_IDLE_TERMINAL_NON_WEB_MS = 70_000;
const TASK_PROGRESS_IDLE_TERMINAL_WEB_MS = 170_000;
const TASK_EXECUTION_HEARTBEAT_INTERVAL_MS = 20_000;
const SHELL_MUTATION_OR_HIGH_RISK_PATTERN = /\b(rm|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|mkfs|mount|umount|sudo|npm|pnpm|yarn|pip|brew)\b|[><]|\$\(.*\)|`.*`|&&\s*(rm|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|mkfs|mount|umount|sudo|npm|pnpm|yarn|pip|brew)\b/i;
const READ_ONLY_PIPELINE_COMMANDS = new Set([
    'rg',
    'curl',
    'wget',
    'date',
    'ls',
    'pwd',
    'whoami',
    'uname',
    'find',
    'stat',
    'du',
    'df',
    'realpath',
    'which',
    'id',
    'head',
    'tail',
    'grep',
    'egrep',
    'fgrep',
    'awk',
    'sed',
    'jq',
    'cut',
    'tr',
    'sort',
    'uniq',
    'wc',
    'cat',
    'printf',
    'echo',
    'xargs',
    'command',
]);
function buildMissingTerminalRecoverySummary(options: {
    evidenceSatisfied: boolean;
}): string {
    if (options.evidenceSatisfied) {
        return [
            '本轮任务已完成所需工具调用并拿到有效结果，但上游没有按协议返回终止事件，系统已自动触发终端恢复并安全结束当前回合。',
            '这属于通用流控兜底，不代表业务执行失败；已产出的工具结果可以继续复用。',
            '如果你希望我继续，我会在下一轮基于当前上下文补充完整结论、关键依据和下一步建议。',
        ].join('\n');
    }
    return [
        '本轮任务在工具阶段后未收到终止事件，系统已自动触发终端恢复并结束当前回合，避免任务长时间卡住。',
        '当前结果可能不完整，你可以直接重试一次；我会继续沿用已有上下文和已执行信息。',
        '若需要，我也可以在下一轮先给出简版结论，再补充完整证据与后续动作清单。',
    ].join('\n');
}
const SAFE_GIT_READ_ONLY_SUBCOMMANDS = new Set([
    'status',
    'diff',
    'log',
    'show',
    'rev-parse',
    'branch',
    'remote',
    'tag',
    'describe',
    'ls-files',
    'grep',
    'blame',
    'shortlog',
    'config',
]);

function extractWorkspaceExecuteCommand(args: unknown): string | null {
    const direct = getString(toRecord(args).command);
    if (direct) {
        return direct.trim();
    }
    const nestedInput = getString(toRecord(toRecord(args).input).command);
    if (nestedInput) {
        return nestedInput.trim();
    }
    const nestedPayload = getString(toRecord(toRecord(args).payload).command);
    if (nestedPayload) {
        return nestedPayload.trim();
    }
    return null;
}

function isLowRiskReadOnlyWorkspaceCommand(command: string): boolean {
    const normalized = command.trim();
    if (normalized.length === 0 || normalized.length > 1_000) {
        return false;
    }
    if (SHELL_MUTATION_OR_HIGH_RISK_PATTERN.test(normalized)) {
        return false;
    }
    const segments = splitShellSegments(normalized);
    if (segments.length === 0) {
        return false;
    }
    for (const segment of segments) {
        const executable = segment.match(/^([A-Za-z0-9._-]+)/)?.[1]?.toLowerCase() ?? '';
        if (executable === 'git') {
            if (!isSafeReadOnlyGitCommand(segment)) {
                return false;
            }
            continue;
        }
        if (!READ_ONLY_PIPELINE_COMMANDS.has(executable)) {
            return false;
        }
        if (executable === 'curl' || executable === 'wget') {
            if (/\s(?:-o|--output|--remote-name(?:-all)?|-T|--upload-file)\b/i.test(segment)) {
                return false;
            }
        }
    }
    return true;
}

function splitShellSegments(command: string): string[] {
    const segments: string[] = [];
    let current = '';
    let quote: '\'' | '"' | '`' | null = null;
    let escaped = false;
    for (let index = 0; index < command.length; index += 1) {
        const char = command[index] ?? '';
        const next = command[index + 1] ?? '';
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\' && quote !== '\'') {
            current += char;
            escaped = true;
            continue;
        }
        if (quote) {
            current += char;
            if (char === quote) {
                quote = null;
            }
            continue;
        }
        if (char === '\'' || char === '"' || char === '`') {
            current += char;
            quote = char;
            continue;
        }
        if (
            char === ';'
            || (char === '|' && next === '|')
            || (char === '&' && next === '&')
            || char === '|'
        ) {
            const segment = current.trim();
            if (segment.length > 0) {
                segments.push(segment);
            }
            current = '';
            if ((char === '|' && next === '|') || (char === '&' && next === '&')) {
                index += 1;
            }
            continue;
        }
        current += char;
    }
    const finalSegment = current.trim();
    if (finalSegment.length > 0) {
        segments.push(finalSegment);
    }
    return segments;
}

function splitShellTokens(command: string): string[] {
    return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

function isSafeReadOnlyGitCommand(commandSegment: string): boolean {
    const tokens = splitShellTokens(commandSegment.trim()).map((token) => token.trim());
    if (tokens.length < 2 || tokens[0]?.toLowerCase() !== 'git') {
        return false;
    }
    const subcommand = (tokens[1] ?? '').toLowerCase();
    if (!SAFE_GIT_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
        return false;
    }
    const args = tokens.slice(2).map((arg) => arg.toLowerCase());
    if (subcommand === 'branch') {
        const blocked = new Set([
            '-d',
            '-D',
            '--delete',
            '-m',
            '-M',
            '--move',
            '-c',
            '-C',
            '--copy',
            '--set-upstream-to',
            '-u',
            '--unset-upstream',
            '--edit-description',
            '--create-reflog',
        ]);
        if (args.some((arg) => blocked.has(arg))) {
            return false;
        }
        return args.every((arg) => arg.startsWith('-'));
    }
    if (subcommand === 'tag') {
        const blocked = new Set([
            '-d',
            '--delete',
            '-a',
            '-s',
            '-m',
            '-f',
            '--annotate',
            '--sign',
            '--message',
            '--force',
        ]);
        if (args.some((arg) => blocked.has(arg))) {
            return false;
        }
        return args.every((arg) => arg.startsWith('-'));
    }
    if (subcommand === 'config') {
        return args.some((arg) => arg === '--get' || arg === '--get-all' || arg === '--list');
    }
    return true;
}

function isReadOnlyBrowserResearchTool(toolName: string): boolean {
    const normalized = toolName.trim().toLowerCase();
    if (!normalized.startsWith('browser_')) {
        return false;
    }
    return !/\b(click|fill|type|press|select|submit|upload|drag|drop|delete|remove|write|set|eval|execute|script)\b/i
        .test(normalized);
}

function shouldAutoApproveTool(input: {
    event: Extract<DesktopEvent, { type: 'approval_required' }>;
    requiredCompletionCapabilities?: string[];
}): boolean {
    const event = input.event;
    const normalizedToolName = event.toolName.trim().toLowerCase();
    if (AUTO_APPROVE_TOOLS.has(event.toolName) || isDelegatedAgentToolName(event.toolName)) {
        return true;
    }
    if (READ_ONLY_WORKSPACE_TOOLS.has(normalizedToolName)) {
        return true;
    }
    const requiredCompletionCapabilities = normalizeStringList(input.requiredCompletionCapabilities ?? [])
        .map((value) => value.toLowerCase());
    if (
        requiredCompletionCapabilities.includes(WEB_RESEARCH_CAPABILITY)
        && isReadOnlyBrowserResearchTool(event.toolName)
    ) {
        return true;
    }
    if (event.toolName !== WORKSPACE_EXECUTE_COMMAND_TOOL) {
        return false;
    }
    const command = extractWorkspaceExecuteCommand(event.args);
    if (!command) {
        return false;
    }
    return isLowRiskReadOnlyWorkspaceCommand(command);
}

export function createMastraEntrypointProcessor(deps: ProcessorDeps) {
    const getNowIso = deps.getNowIso ?? (() => new Date().toISOString());
    const createId = deps.createId ?? (() => randomUUID());
    const resolveResourceId = deps.resolveResourceId ?? deriveDefaultResourceId;
    const stopVoicePlayback = deps.stopVoicePlayback ?? (async () => false);
    const getVoicePlaybackState = deps.getVoicePlaybackState ?? (() => ({
        isSpeaking: false,
        canStop: false,
    }));
    const getVoiceProviderStatus = deps.getVoiceProviderStatus ?? (() => ({
        preferredAsr: 'system',
        preferredTts: 'system',
        hasCustomAsr: false,
        hasCustomTts: false,
        providers: {
            asr: [],
            tts: [],
        },
    }));
    const transcribeWithCustomAsr = deps.transcribeWithCustomAsr ?? (async () => ({
        success: false,
        error: 'transcription_unavailable',
    }));
    const pendingApprovals = new Map<string, PendingApproval>();
    const missingToolEvidenceAutoRetryByTurnKey = new Set<string>();
    const pendingForwardResponses = new Map<string, PendingForwardResponse>();
    const completedForwardResponseIds = new Set<string>();
    const forwardBridgeStats: ForwardBridgeStats = {
        forwardedRequests: 0,
        successfulResponses: 0,
        orphanResponses: 0,
        duplicateResponses: 0,
        timeoutErrors: 0,
        retries: 0,
        transportClosedRejects: 0,
        invalidResponses: 0,
    };
    const policyGateResponseTimeoutMs =
        deps.policyGateResponseTimeoutMs ?? DEFAULT_POLICY_GATE_TIMEOUT_MS;
    const policyGateTimeoutRetryCount =
        deps.policyGateTimeoutRetryCount ?? DEFAULT_POLICY_GATE_TIMEOUT_RETRY_COUNT;
    const remoteSessionGovernancePolicy = resolveRemoteSessionGovernancePolicy(
        deps.remoteSessionGovernancePolicy,
    );
    let transportClosed = false;
    const taskStates = new Map<string, TaskRuntimeState>();
    const taskExecutionTailByTaskId = new Map<string, Promise<void>>();
    const taskExecutionDepthByTaskId = new Map<string, number>();
    const latestRunIdByTaskId = new Map<string, string>();
    const latestCommandInvocationByTaskId = new Map<string, string>();
    const latestCommandRecoveryHintByTaskId = new Map<string, TaskTurnCommandRecoveryHint>();
    const latestCommandFailureInfoByTaskId = new Map<string, TaskTurnCommandFailureInfo>();
    const autoApprovalInFlightByTaskId = new Map<string, Set<string>>();
    const autoApprovalCompletedByTaskId = new Map<string, Set<string>>();
    const taskMessageDedupByTaskId = new Map<string, TaskMessageDedupState>();
    const taskTurnEventStates = new Map<string, TaskTurnEventState>();
    const legacyDeliverablesByTaskId = new Map<string, string[]>();
    const remoteSessionToTaskId = new Map<string, string>();
    const channelDeliveryEvents = new Map<string, ChannelDeliveryEvent>();
    if (deps.taskStateStore) {
        try {
            for (const state of deps.taskStateStore.list()) {
                const recovered = recoverTaskRuntimeStateAfterRestart(state);
                taskStates.set(recovered.taskId, recovered);
                if (recovered !== state) {
                    deps.taskStateStore.upsert(recovered);
                }
            }
        } catch (error) {
            console.error('[MastraEntrypoint] Failed to load persisted task state:', error);
        }
    }
    if (deps.remoteSessionStore) {
        try {
            for (const session of deps.remoteSessionStore.list({ status: 'active' })) {
                remoteSessionToTaskId.set(session.remoteSessionId, session.taskId);
            }
            for (const event of deps.remoteSessionStore.listChannelEvents()) {
                channelDeliveryEvents.set(event.id, event);
            }
        } catch (error) {
            console.error('[MastraEntrypoint] Failed to load persisted remote sessions:', error);
        }
    }
    const forwardedCommandTypes = new Set<string>([
        'request_effect',
        'propose_patch',
        'apply_patch',
        'reject_patch',
        'read_file',
        'list_dir',
        'exec_shell',
        'capture_screen',
        'get_policy_config',
    ]);
    let bootstrapRuntimeContext: Record<string, unknown> | undefined;
    const buildTaskTurnEventStateKey = (input: {
        taskId: string;
        turnId?: string;
        runId?: string;
    }): string => {
        const turnPart = (input.turnId && input.turnId.trim().length > 0)
            ? input.turnId.trim()
            : (
                input.runId && input.runId.trim().length > 0
                    ? `run:${input.runId.trim()}`
                    : 'unknown'
            );
        return `${input.taskId}:${turnPart}`;
    };
    const pruneTaskTurnEventStates = (nowMs: number): void => {
        for (const [key, state] of taskTurnEventStates.entries()) {
            if (nowMs - state.updatedAtMs > TASK_TURN_EVENT_STATE_TTL_MS) {
                taskTurnEventStates.delete(key);
            }
        }
        if (taskTurnEventStates.size <= MAX_TASK_TURN_EVENT_STATES) {
            return;
        }
        const oldest = [...taskTurnEventStates.entries()]
            .sort((left, right) => left[1].updatedAtMs - right[1].updatedAtMs)
            .slice(0, taskTurnEventStates.size - MAX_TASK_TURN_EVENT_STATES);
        for (const [key] of oldest) {
            taskTurnEventStates.delete(key);
        }
    };
    const getTaskTurnEventState = (
        key: string,
        nowMs: number,
    ): TaskTurnEventState => {
        const existing = taskTurnEventStates.get(key);
        if (existing) {
            const updated = {
                ...existing,
                updatedAtMs: nowMs,
            };
            taskTurnEventStates.set(key, updated);
            return updated;
        }
        const created: TaskTurnEventState = {
            assistantNarrativeSeen: false,
            assistantNarrativeChars: 0,
            toolEvidenceSeen: false,
            strongToolEvidenceSeen: false,
            satisfiedCompletionCapabilities: [],
            resultAttemptedCompletionCapabilities: [],
            observedToolNames: [],
            requireToolEvidenceForCompletion: false,
            requiredCompletionCapabilities: [],
            commandFailureNarrativeEmitted: false,
            updatedAtMs: nowMs,
        };
        taskTurnEventStates.set(key, created);
        return created;
    };
    const setTaskTurnCompletionRequirement = (input: {
        key: string;
        requireToolEvidence: boolean;
        requiredCompletionCapabilities?: string[];
        turnContractHash?: string;
        turnContractDomain?: string;
        routeMode?: 'chat' | 'task';
        executionPath?: 'direct' | 'workflow';
    }): void => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        const normalizedContractHash = typeof input.turnContractHash === 'string' && input.turnContractHash.trim().length > 0
            ? input.turnContractHash.trim()
            : undefined;
        const shouldKeepExistingLock = Boolean(
            state.turnContractHash
            && normalizedContractHash
            && state.turnContractHash !== normalizedContractHash,
        );
        if (shouldKeepExistingLock) {
            console.warn('[MastraEntrypoint] Ignoring turn-contract drift for in-flight turn', {
                key: input.key,
                existingContractHash: state.turnContractHash,
                incomingContractHash: normalizedContractHash,
            });
        }
        taskTurnEventStates.set(input.key, {
            ...state,
            requireToolEvidenceForCompletion: input.requireToolEvidence,
            requiredCompletionCapabilities: normalizeStringList(input.requiredCompletionCapabilities ?? []),
            turnContractHash: shouldKeepExistingLock
                ? state.turnContractHash
                : normalizedContractHash ?? state.turnContractHash,
            turnContractDomain: shouldKeepExistingLock
                ? state.turnContractDomain
                : input.turnContractDomain ?? state.turnContractDomain,
            routeMode: shouldKeepExistingLock
                ? state.routeMode
                : input.routeMode ?? state.routeMode,
            executionPath: shouldKeepExistingLock
                ? state.executionPath
                : input.executionPath ?? state.executionPath,
            updatedAtMs: nowMs,
        });
    };
    const markTaskTurnAssistantNarrative = (input: {
        key: string;
        content?: string;
    }): void => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        const deltaChars = typeof input.content === 'string' ? input.content.trim().length : 0;
        const nextChars = state.assistantNarrativeChars + deltaChars;
        const nextSeen = state.assistantNarrativeSeen || deltaChars > 0;
        if (state.assistantNarrativeSeen === nextSeen && state.assistantNarrativeChars === nextChars) {
            return;
        }
        taskTurnEventStates.set(input.key, {
            ...state,
            assistantNarrativeSeen: nextSeen,
            assistantNarrativeChars: nextChars,
            updatedAtMs: nowMs,
        });
    };
    const claimTaskTurnPrimaryNarrativeRun = (input: {
        key: string;
        runId: string;
    }): boolean => {
        const normalizedRunId = input.runId.trim();
        if (normalizedRunId.length === 0) {
            return true;
        }
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        if (state.primaryNarrativeRunId && state.primaryNarrativeRunId !== normalizedRunId) {
            return false;
        }
        if (state.primaryNarrativeRunId === normalizedRunId) {
            return true;
        }
        taskTurnEventStates.set(input.key, {
            ...state,
            primaryNarrativeRunId: normalizedRunId,
            updatedAtMs: nowMs,
        });
        return true;
    };
    const shouldSuppressTaskTurnAssistantChunk = (input: {
        key: string;
        chunk: string;
    }): boolean => {
        const normalizedChunk = normalizeTaskMessageFingerprint(input.chunk);
        if (normalizedChunk.length < 24) {
            return false;
        }
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        if (state.lastAssistantChunkFingerprint === normalizedChunk) {
            return true;
        }
        taskTurnEventStates.set(input.key, {
            ...state,
            lastAssistantChunkFingerprint: normalizedChunk,
            updatedAtMs: nowMs,
        });
        return false;
    };
    const hasTaskTurnAssistantNarrative = (key: string): boolean => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        return getTaskTurnEventState(key, nowMs).assistantNarrativeSeen;
    };
    const getTaskTurnAssistantNarrativeChars = (key: string): number => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        return getTaskTurnEventState(key, nowMs).assistantNarrativeChars;
    };
    const markTaskTurnToolEvidence = (input: {
        key: string;
        evidenceStrength?: 'weak' | 'strong';
        toolName?: string;
        satisfiedCompletionCapabilities?: string[];
        resultAttemptedCompletionCapabilities?: string[];
    }): void => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        const evidenceStrength = input.evidenceStrength ?? 'weak';
        const normalizedToolName = typeof input.toolName === 'string' ? input.toolName.trim() : '';
        const normalizedSatisfied = normalizeStringList(
            (input.satisfiedCompletionCapabilities ?? []).map((value) => value.toLowerCase()),
        );
        const normalizedResultAttempted = normalizeStringList(
            (input.resultAttemptedCompletionCapabilities ?? []).map((value) => value.toLowerCase()),
        );
        const nextObservedToolNames = normalizedToolName.length > 0
            ? normalizeStringList([...state.observedToolNames, normalizedToolName])
            : state.observedToolNames;
        const nextSatisfiedCompletionCapabilities = normalizedSatisfied.length > 0
            ? normalizeStringList([...state.satisfiedCompletionCapabilities, ...normalizedSatisfied])
            : state.satisfiedCompletionCapabilities;
        const nextResultAttemptedCompletionCapabilities = normalizedResultAttempted.length > 0
            ? normalizeStringList([...state.resultAttemptedCompletionCapabilities, ...normalizedResultAttempted])
            : state.resultAttemptedCompletionCapabilities;
        const shouldMarkWeakEvidence = !state.toolEvidenceSeen;
        const shouldMarkStrongEvidence = evidenceStrength === 'strong' && !state.strongToolEvidenceSeen;
        const shouldUpdateObservedToolNames = nextObservedToolNames.length !== state.observedToolNames.length;
        const shouldUpdateSatisfiedCapabilities = nextSatisfiedCompletionCapabilities.length !== state.satisfiedCompletionCapabilities.length;
        const shouldUpdateResultAttempts = nextResultAttemptedCompletionCapabilities.length !== state.resultAttemptedCompletionCapabilities.length;
        if (!shouldMarkWeakEvidence && !shouldMarkStrongEvidence && !shouldUpdateObservedToolNames && !shouldUpdateSatisfiedCapabilities && !shouldUpdateResultAttempts) {
            return;
        }
        taskTurnEventStates.set(input.key, {
            ...state,
            toolEvidenceSeen: true,
            strongToolEvidenceSeen: state.strongToolEvidenceSeen || evidenceStrength === 'strong',
            observedToolNames: nextObservedToolNames,
            satisfiedCompletionCapabilities: nextSatisfiedCompletionCapabilities,
            resultAttemptedCompletionCapabilities: nextResultAttemptedCompletionCapabilities,
            updatedAtMs: nowMs,
        });
    };
    const markTaskTurnCommandInvocation = (input: {
        key: string;
        taskId?: string;
        command: string;
    }): void => {
        const normalizedCommand = input.command.trim();
        if (normalizedCommand.length === 0) {
            return;
        }
        if (input.taskId && input.taskId.trim().length > 0) {
            latestCommandInvocationByTaskId.set(input.taskId, normalizedCommand);
        }
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        if (state.lastCommandInvocation === normalizedCommand) {
            return;
        }
        taskTurnEventStates.set(input.key, {
            ...state,
            lastCommandInvocation: normalizedCommand,
            updatedAtMs: nowMs,
        });
    };
    const markTaskTurnCommandRecoveryHint = (input: {
        key: string;
        taskId?: string;
        hint: TaskTurnCommandRecoveryHint;
    }): void => {
        if (input.taskId && input.taskId.trim().length > 0) {
            latestCommandRecoveryHintByTaskId.set(input.taskId, input.hint);
        }
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        taskTurnEventStates.set(input.key, {
            ...state,
            latestCommandRecoveryHint: input.hint,
            updatedAtMs: nowMs,
        });
    };
    const markTaskTurnCommandFailureInfo = (input: {
        key: string;
        taskId?: string;
        info: TaskTurnCommandFailureInfo;
    }): void => {
        if (input.taskId && input.taskId.trim().length > 0) {
            latestCommandFailureInfoByTaskId.set(input.taskId, input.info);
        }
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        taskTurnEventStates.set(input.key, {
            ...state,
            latestCommandFailureInfo: input.info,
            updatedAtMs: nowMs,
        });
    };
    const markTaskTurnCommandFailureNarrativeEmitted = (key: string): void => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(key, nowMs);
        if (state.commandFailureNarrativeEmitted) {
            return;
        }
        taskTurnEventStates.set(key, {
            ...state,
            commandFailureNarrativeEmitted: true,
            updatedAtMs: nowMs,
        });
    };
    const hasTaskTurnCommandFailureNarrativeEmitted = (key: string): boolean => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        return getTaskTurnEventState(key, nowMs).commandFailureNarrativeEmitted === true;
    };
    const getTaskTurnCommandRecoveryHint = (
        key: string,
        taskId?: string,
    ): TaskTurnCommandRecoveryHint | undefined => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const perTurn = getTaskTurnEventState(key, nowMs).latestCommandRecoveryHint;
        if (perTurn) {
            return perTurn;
        }
        if (taskId && taskId.trim().length > 0) {
            return latestCommandRecoveryHintByTaskId.get(taskId);
        }
        return undefined;
    };
    const getTaskTurnCommandFailureInfo = (
        key: string,
        taskId?: string,
    ): TaskTurnCommandFailureInfo | undefined => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const perTurn = getTaskTurnEventState(key, nowMs).latestCommandFailureInfo;
        if (perTurn) {
            return perTurn;
        }
        if (taskId && taskId.trim().length > 0) {
            return latestCommandFailureInfoByTaskId.get(taskId);
        }
        return undefined;
    };
    const getTaskLatestCommandInvocation = (key: string, taskId?: string): string | undefined => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const perTurn = getTaskTurnEventState(key, nowMs).lastCommandInvocation;
        if (typeof perTurn === 'string' && perTurn.trim().length > 0) {
            return perTurn;
        }
        if (taskId && taskId.trim().length > 0) {
            return latestCommandInvocationByTaskId.get(taskId);
        }
        return undefined;
    };
    const hasTaskTurnToolEvidenceRequirement = (key: string): boolean => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        return getTaskTurnEventState(key, nowMs).requireToolEvidenceForCompletion;
    };
    const getTaskTurnRequiredCompletionCapabilities = (key: string): string[] => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        return [...getTaskTurnEventState(key, nowMs).requiredCompletionCapabilities];
    };
    const getTaskTurnMissingRequiredCompletionCapabilities = (key: string): string[] => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(key, nowMs);
        const satisfied = new Set(state.satisfiedCompletionCapabilities.map((value) => value.toLowerCase()));
        return state.requiredCompletionCapabilities
            .map((value) => value.toLowerCase())
            .filter((capability) => !satisfied.has(capability));
    };
    const getTaskTurnResultAttemptedCompletionCapabilities = (key: string): string[] => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        return [...getTaskTurnEventState(key, nowMs).resultAttemptedCompletionCapabilities];
    };
    const hasTaskTurnSatisfiedCompletionEvidence = (key: string): boolean => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(key, nowMs);
        if (!state.requireToolEvidenceForCompletion) {
            return true;
        }
        if (state.requiredCompletionCapabilities.length === 0) {
            return state.strongToolEvidenceSeen;
        }
        return getTaskTurnMissingRequiredCompletionCapabilities(key).length === 0;
    };
    const getTaskTurnObservedToolNames = (key: string): string[] => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        return [...getTaskTurnEventState(key, nowMs).observedToolNames];
    };
    const getTaskTurnRouteMode = (key: string): 'chat' | 'task' | undefined => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const routeMode = getTaskTurnEventState(key, nowMs).routeMode;
        return routeMode === 'chat' || routeMode === 'task'
            ? routeMode
            : undefined;
    };
    const getTaskTurnContractDomain = (key: string): string | undefined => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const domain = getTaskTurnEventState(key, nowMs).turnContractDomain;
        if (typeof domain !== 'string') {
            return undefined;
        }
        const normalized = domain.trim().toLowerCase();
        return normalized.length > 0 ? normalized : undefined;
    };
    const shouldSuppressTaskTurnExecutionNarrationChunk = (input: {
        key: string;
        chunk: string;
    }): boolean => {
        const normalized = input.chunk.trim();
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(input.key, nowMs);
        if (state.routeMode !== 'task') {
            return false;
        }
        if (state.assistantNarrativeSeen || state.toolEvidenceSeen) {
            return false;
        }
        if (isLikelyTaskMetaReasoningChunk(normalized)) {
            return true;
        }
        if (
            normalized.length > TASK_EXECUTION_NARRATION_MAX_SUPPRESS_CHARS
            || !isLikelyTaskExecutionNarrationChunk(normalized)
        ) {
            return false;
        }
        return true;
    };
    const hasTaskTurnTerminalEvent = (key: string): boolean => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(key, nowMs);
        return typeof state.terminal === 'string';
    };
    const shouldSuppressTaskTurnTerminalEvent = (
        key: string,
        nextTerminal: TaskTurnTerminalType,
    ): boolean => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(key, nowMs);
        const currentTerminal = state.terminal;
        if (!currentTerminal) {
            return false;
        }
        if (currentTerminal === nextTerminal) {
            return true;
        }
        if (currentTerminal === 'complete') {
            return true;
        }
        if (nextTerminal === 'complete') {
            return false;
        }
        return true;
    };
    const markTaskTurnTerminalEvent = (
        key: string,
        terminal: TaskTurnTerminalType,
    ): void => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(key, nowMs);
        taskTurnEventStates.set(key, {
            ...state,
            terminal,
            updatedAtMs: nowMs,
        });
    };
    const resetTaskTurnAttemptStreamState = (key: string): void => {
        const nowMs = Date.now();
        pruneTaskTurnEventStates(nowMs);
        const state = getTaskTurnEventState(key, nowMs);
        taskTurnEventStates.set(key, {
            ...state,
            assistantNarrativeSeen: false,
            assistantNarrativeChars: 0,
            toolEvidenceSeen: false,
            strongToolEvidenceSeen: false,
            satisfiedCompletionCapabilities: [],
            resultAttemptedCompletionCapabilities: [],
            observedToolNames: [],
            primaryNarrativeRunId: undefined,
            lastAssistantChunkFingerprint: undefined,
            commandFailureNarrativeEmitted: false,
            terminal: undefined,
            updatedAtMs: nowMs,
        });
    };
    const buildRetryExecutionOptionsFromTaskState = (state: TaskRuntimeState): UserMessageExecutionOptions => {
        const contract = state.turnContract;
        const requiredCompletionCapabilities = normalizeStringList(contract?.requiredCapabilities ?? []);
        return {
            modelId: state.modelId,
            enabledSkills: state.enabledSkills ?? [],
            executionPath: state.executionPath === 'direct' ? 'direct' : 'workflow',
            forcedRouteMode: contract?.mode === 'chat' ? 'chat' : 'task',
            requireToolEvidenceForCompletion: requiredCompletionCapabilities.length > 0,
            requiredCompletionCapabilities,
            turnContractHash: contract?.hash,
            turnContractDomain: contract?.domain,
            useDirectChatResponder: contract?.mode === 'chat' ? true : undefined,
            forcePostAssistantCompletion: true,
        };
    };
    const clearPendingApprovalsForTask = (taskId: string): void => {
        for (const [requestId, pending] of pendingApprovals.entries()) {
            if (pending.taskId === taskId) {
                pendingApprovals.delete(requestId);
            }
        }
        autoApprovalInFlightByTaskId.delete(taskId);
        autoApprovalCompletedByTaskId.delete(taskId);
    };
    const hasPendingApprovalForTask = (taskId: string): boolean => {
        for (const pending of pendingApprovals.values()) {
            if (pending.taskId === taskId) {
                return true;
            }
        }
        return false;
    };
    const hasMatchingPendingApproval = (input: {
        taskId: string;
        toolCallId?: string;
        toolName?: string;
    }): boolean => {
        for (const pending of pendingApprovals.values()) {
            if (pending.taskId !== input.taskId) {
                continue;
            }
            if (
                input.toolCallId
                && pending.toolCallId === input.toolCallId
            ) {
                return true;
            }
            if (
                (!input.toolCallId || input.toolCallId.length === 0)
                && input.toolName
                && pending.toolName === input.toolName
            ) {
                return true;
            }
        }
        return false;
    };
    const claimTaskMessageDispatch = (input: {
        taskId: string;
        message: string;
        dedupeKey?: string;
    }): {
        deduplicated: boolean;
        reason?: TaskMessageDedupReason;
        token?: TaskMessageDedupToken;
    } => {
        const fingerprint = (
            typeof input.dedupeKey === 'string'
            && input.dedupeKey.trim().length > 0
        )
            ? input.dedupeKey.trim()
            : normalizeTaskMessageFingerprint(input.message);
        const state = taskMessageDedupByTaskId.get(input.taskId) ?? {
            inFlightFingerprints: new Set<string>(),
        };
        if (state.inFlightFingerprints.has(fingerprint)) {
            taskMessageDedupByTaskId.set(input.taskId, state);
            return {
                deduplicated: true,
                reason: 'in_flight',
            };
        }
        state.inFlightFingerprints.add(fingerprint);
        taskMessageDedupByTaskId.set(input.taskId, state);
        return {
            deduplicated: false,
            token: {
                taskId: input.taskId,
                fingerprint,
            },
        };
    };
    const completeTaskMessageDispatch = (input: {
        taskId: string;
        fingerprint: string;
    }): void => {
        const state = taskMessageDedupByTaskId.get(input.taskId);
        if (!state) {
            return;
        }
        state.inFlightFingerprints.delete(input.fingerprint);
        if (state.inFlightFingerprints.size === 0) {
            taskMessageDedupByTaskId.delete(input.taskId);
            return;
        }
        taskMessageDedupByTaskId.set(input.taskId, state);
    };
    const enqueueTaskExecution = (input: EnqueueTaskExecutionInput): EnqueueTaskExecutionResult => {
        const pendingDepth = taskExecutionDepthByTaskId.get(input.taskId) ?? 0;
        const queuePosition = pendingDepth;
        taskExecutionDepthByTaskId.set(input.taskId, pendingDepth + 1);

        const previousTail = taskExecutionTailByTaskId.get(input.taskId) ?? Promise.resolve();
        const completion = previousTail
            .catch(() => undefined)
            .then(async () => {
                return await input.run();
            });

        taskExecutionTailByTaskId.set(
            input.taskId,
            completion
                .then(() => undefined)
                .catch(() => undefined),
        );

        void completion.finally(() => {
            const remaining = (taskExecutionDepthByTaskId.get(input.taskId) ?? 1) - 1;
            if (remaining <= 0) {
                taskExecutionDepthByTaskId.delete(input.taskId);
                taskExecutionTailByTaskId.delete(input.taskId);
            } else {
                taskExecutionDepthByTaskId.set(input.taskId, remaining);
            }
        });

        return {
            queuePosition,
            completion,
        };
    };
    const resolveTaskResourceId = (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ): string => {
        const fromPayload = pickResourceOverride(payload);
        if (fromPayload) {
            return fromPayload;
        }
        if (existingResourceId) {
            return existingResourceId;
        }
        const fromBootstrap = bootstrapRuntimeContext
            ? (getString(bootstrapRuntimeContext.resourceId) ?? getString(bootstrapRuntimeContext.memoryResourceId))
            : null;
        if (fromBootstrap) {
            return fromBootstrap;
        }
        return resolveResourceId(taskId);
    };
    const resolveTaskCheckpointVersion = (state?: TaskRuntimeState): number => {
        const fromState = getNonNegativeInteger(state?.checkpointVersion);
        if (fromState !== null) {
            return fromState;
        }
        const fromCheckpoint = getNonNegativeInteger(state?.checkpoint?.version);
        if (fromCheckpoint !== null) {
            return fromCheckpoint;
        }
        return 0;
    };
    const resolveTaskOperationId = (
        payload: Record<string, unknown>,
        defaultValue: string,
    ): string => {
        const operationId = getString(payload.operationId)
            ?? getString(payload.idempotencyKey)
            ?? getString(payload.recoveryOperationId);
        return operationId ?? defaultValue;
    };
    const resolveExpectedCheckpointVersion = (payload: Record<string, unknown>): number | undefined => {
        const version = getNonNegativeInteger(payload.expectedCheckpointVersion);
        return version === null ? undefined : version;
    };
    const findTaskOperationRecord = (
        state: TaskRuntimeState | undefined,
        operationId: string,
        actions?: TaskRuntimeOperationAction[],
    ): TaskRuntimeOperationRecord | null => {
        if (!state || !Array.isArray(state.operationLog) || state.operationLog.length === 0) {
            return null;
        }
        const actionSet = actions ? new Set(actions) : null;
        for (let index = state.operationLog.length - 1; index >= 0; index -= 1) {
            const entry = state.operationLog[index];
            if (entry.operationId !== operationId) {
                continue;
            }
            if (actionSet && !actionSet.has(entry.action)) {
                continue;
            }
            return entry;
        }
        return null;
    };
    const appendTaskOperationRecord = (
        state: TaskRuntimeState | undefined,
        record: TaskRuntimeOperationRecord,
    ): TaskRuntimeOperationRecord[] => {
        const base = Array.isArray(state?.operationLog) ? state.operationLog : [];
        const deduped = base.filter((entry) => entry.operationId !== record.operationId);
        const next = [...deduped, record];
        if (next.length <= MAX_TASK_OPERATION_LOG) {
            return next;
        }
        return next.slice(next.length - MAX_TASK_OPERATION_LOG);
    };
    const upsertTaskState = (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ): TaskRuntimeState => {
        const existing = taskStates.get(taskId);
        const hasSuspended = Object.prototype.hasOwnProperty.call(patch, 'suspended');
        const hasSuspensionReason = Object.prototype.hasOwnProperty.call(patch, 'suspensionReason');
        const hasLastUserMessage = Object.prototype.hasOwnProperty.call(patch, 'lastUserMessage');
        const hasLastTraceId = Object.prototype.hasOwnProperty.call(patch, 'lastTraceId');
        const hasEnabledSkills = Object.prototype.hasOwnProperty.call(patch, 'enabledSkills');
        const hasModelId = Object.prototype.hasOwnProperty.call(patch, 'modelId');
        const hasCheckpoint = Object.prototype.hasOwnProperty.call(patch, 'checkpoint');
        const hasCheckpointVersion = Object.prototype.hasOwnProperty.call(patch, 'checkpointVersion');
        const hasRetry = Object.prototype.hasOwnProperty.call(patch, 'retry');
        const hasAgentTasks = Object.prototype.hasOwnProperty.call(patch, 'agentTasks');
        const hasAgentTaskProgress = Object.prototype.hasOwnProperty.call(patch, 'agentTaskProgress');
        const hasOperationLog = Object.prototype.hasOwnProperty.call(patch, 'operationLog');
        const hasExecutionPath = Object.prototype.hasOwnProperty.call(patch, 'executionPath');
        const hasTurnContract = Object.prototype.hasOwnProperty.call(patch, 'turnContract');
        const fallbackCheckpointVersion = resolveTaskCheckpointVersion(existing);
        const next: TaskRuntimeState = {
            taskId,
            conversationThreadId: patch.conversationThreadId ?? existing?.conversationThreadId ?? taskId,
            title: patch.title ?? existing?.title ?? 'Task',
            workspacePath: patch.workspacePath ?? existing?.workspacePath ?? process.cwd(),
            createdAt: existing?.createdAt ?? patch.createdAt ?? getNowIso(),
            status: patch.status ?? existing?.status ?? 'idle',
            suspended: hasSuspended ? patch.suspended : existing?.suspended,
            suspensionReason: hasSuspensionReason ? patch.suspensionReason : existing?.suspensionReason,
            lastUserMessage: hasLastUserMessage ? patch.lastUserMessage : existing?.lastUserMessage,
            lastTraceId: hasLastTraceId ? patch.lastTraceId : existing?.lastTraceId,
            enabledSkills: hasEnabledSkills ? patch.enabledSkills : existing?.enabledSkills,
            modelId: hasModelId ? patch.modelId : existing?.modelId,
            resourceId: patch.resourceId ?? existing?.resourceId ?? resolveResourceId(taskId),
            checkpoint: hasCheckpoint ? patch.checkpoint : existing?.checkpoint,
            checkpointVersion: hasCheckpointVersion
                ? patch.checkpointVersion
                : fallbackCheckpointVersion,
            retry: hasRetry ? patch.retry : existing?.retry,
            agentTasks: hasAgentTasks ? patch.agentTasks : existing?.agentTasks,
            agentTaskProgress: hasAgentTaskProgress ? patch.agentTaskProgress : existing?.agentTaskProgress,
            operationLog: hasOperationLog ? patch.operationLog : existing?.operationLog,
            executionPath: hasExecutionPath ? patch.executionPath : existing?.executionPath,
            turnContract: hasTurnContract ? patch.turnContract : existing?.turnContract,
        };
        taskStates.set(taskId, next);
        if (deps.taskStateStore) {
            try {
                deps.taskStateStore.upsert(next);
            } catch (error) {
                console.error(`[MastraEntrypoint] Failed to persist task state for ${taskId}:`, error);
            }
        }
        return next;
    };
    const recordDelegatedAgentTaskNotification = (input: {
        taskId: string;
        event: Extract<DesktopEvent, { type: 'tool_call' | 'tool_result' }>;
        turnId?: string;
        traceId?: string | null;
    }): void => {
        if (input.event.toolName !== 'agent_task_notification') {
            return;
        }
        const payload = input.event.type === 'tool_call'
            ? input.event.args
            : input.event.result;
        const notification = coerceAgentTaskNotification(payload);
        if (!notification) {
            return;
        }
        const current = taskStates.get(input.taskId);
        const recordedAt = getNowIso();
        const runId = typeof input.event.runId === 'string' && input.event.runId.trim().length > 0
            ? input.event.runId
            : undefined;
        const traceId = typeof input.traceId === 'string' && input.traceId.trim().length > 0
            ? input.traceId
            : undefined;
        const turnId = typeof input.turnId === 'string' && input.turnId.trim().length > 0
            ? input.turnId
            : undefined;
        const agentTasks = upsertAgentTaskFromNotification({
            existing: current?.agentTasks,
            notification,
            at: recordedAt,
            runId,
            traceId,
            turnId,
        });
        const agentTaskProgress = buildAgentTaskProgressSnapshot({
            agentTasks,
            previous: current?.agentTaskProgress,
            latestNotification: notification,
            at: recordedAt,
            runId,
            traceId,
            turnId,
        });
        upsertTaskState(input.taskId, {
            agentTasks,
            agentTaskProgress,
        });
    };
    const hydrateLegacyRuntimeRecordsFromBootstrap = (runtimeContext?: Record<string, unknown>): void => {
        const appDataDir = getString(runtimeContext?.appDataDir);
        if (!appDataDir) {
            return;
        }
        const legacyRuntimePath = path.join(appDataDir, LEGACY_RUNTIME_STATE_FILE);
        if (!fs.existsSync(legacyRuntimePath)) {
            return;
        }
        let rawRecords: unknown;
        try {
            rawRecords = JSON.parse(fs.readFileSync(legacyRuntimePath, 'utf-8')) as unknown;
        } catch {
            return;
        }
        if (!Array.isArray(rawRecords)) {
            return;
        }

        let changed = false;
        const sanitizedRecords = rawRecords.map((record) => {
            const nextRecord = toRecord(record);
            const taskId = getString(nextRecord.taskId);
            const workspacePath = getString(nextRecord.workspacePath) ?? process.cwd();
            const config = toRecord(nextRecord.config);
            const snapshot = toRecord(config.lastFrozenWorkRequestSnapshot);
            const deliverables = Array.isArray(snapshot.deliverables)
                ? snapshot.deliverables.map((item) => toRecord(item))
                : [];
            const plannedPaths: string[] = [];
            const sanitizedDeliverables = deliverables.map((deliverable) => {
                const originalPath = getString(deliverable.path);
                if (!originalPath) {
                    return deliverable;
                }
                const normalizedPath = sanitizeLegacyPlannedOutputPath(originalPath);
                plannedPaths.push(normalizedPath);
                if (normalizedPath !== originalPath) {
                    changed = true;
                    return {
                        ...deliverable,
                        path: normalizedPath,
                    };
                }
                return deliverable;
            });
            if (deliverables.length > 0) {
                nextRecord.config = {
                    ...config,
                    lastFrozenWorkRequestSnapshot: {
                        ...snapshot,
                        deliverables: sanitizedDeliverables,
                    },
                };
            }

            const sourceQuery = getString(snapshot.primaryObjective)
                ?? getString(snapshot.sourceText)
                ?? getString(toRecord(nextRecord.artifactContract).sourceQuery)
                ?? 'restored planned deliverables';
            if (plannedPaths.length > 0) {
                const normalizedArtifactContract = buildLegacyPlannedArtifactContract(sourceQuery, plannedPaths);
                const previousArtifactContract = toRecord(nextRecord.artifactContract);
                if (JSON.stringify(previousArtifactContract) !== JSON.stringify(normalizedArtifactContract)) {
                    changed = true;
                }
                nextRecord.artifactContract = normalizedArtifactContract;
            }

            if (taskId) {
                const artifactPaths = plannedPaths.length > 0
                    ? plannedPaths
                    : extractLegacyPathTargetsFromArtifactContract(toRecord(nextRecord.artifactContract));
                if (artifactPaths.length > 0) {
                    legacyDeliverablesByTaskId.set(taskId, artifactPaths);
                }
                const conversation = Array.isArray(nextRecord.conversation) ? nextRecord.conversation : [];
                const lastUserMessage = conversation
                    .map((item) => toRecord(item))
                    .reverse()
                    .find((item) => getString(item.role)?.toLowerCase() === 'user');
                const lastUserContent = getString(lastUserMessage?.content) ?? undefined;
                const rawStatus = getString(nextRecord.status);
                const status: TaskRuntimeState['status'] = (
                    rawStatus === 'running'
                    || rawStatus === 'retrying'
                    || rawStatus === 'idle'
                    || rawStatus === 'finished'
                    || rawStatus === 'failed'
                    || rawStatus === 'interrupted'
                    || rawStatus === 'suspended'
                    || rawStatus === 'scheduled'
                )
                    ? rawStatus
                    : 'idle';
                const statePatch: Partial<TaskRuntimeState> = {
                    title: getString(nextRecord.title) ?? 'Task',
                    workspacePath,
                    createdAt: getString(nextRecord.createdAt) ?? getNowIso(),
                    status,
                    lastUserMessage: lastUserContent,
                    resourceId: resolveTaskResourceId(taskId, {}),
                    executionPath: 'direct',
                };
                if (lastUserContent) {
                    statePatch.turnContract = buildTaskTurnContract({
                        message: lastUserContent,
                        workspacePath,
                        mode: 'task',
                        route: 'direct',
                        requiredCapabilities: [],
                        createdAt: getNowIso(),
                    });
                }
                upsertTaskState(taskId, statePatch);
            }
            return nextRecord;
        });

        if (!changed) {
            return;
        }
        try {
            fs.writeFileSync(legacyRuntimePath, JSON.stringify(sanitizedRecords, null, 2), 'utf-8');
        } catch (error) {
            console.warn('[MastraEntrypoint] Failed to persist sanitized legacy runtime records:', error);
        }
    };
    const collectRuntimeSnapshot = () => {
        const tasks = Array.from(taskStates.values()).map((task) => ({
            taskId: task.taskId,
            threadId: task.conversationThreadId,
            title: task.title,
            workspacePath: task.workspacePath,
            createdAt: task.createdAt,
            status: task.status,
            suspended: task.suspended,
            suspensionReason: task.suspensionReason,
            lastTraceId: task.lastTraceId,
            enabledSkills: task.enabledSkills,
            modelId: task.modelId,
            resourceId: task.resourceId,
            checkpoint: task.checkpoint,
            checkpointVersion: task.checkpointVersion ?? resolveTaskCheckpointVersion(task),
            retry: task.retry,
            agentTasks: task.agentTasks ?? [],
            agentTaskProgress: task.agentTaskProgress ?? null,
            operationLog: task.operationLog ?? [],
            executionPath: task.executionPath ?? 'workflow',
            turnContract: task.turnContract ?? null,
        }));
        const remoteSessions = deps.remoteSessionStore
            ? deps.remoteSessionStore.list()
            : Array.from(remoteSessionToTaskId.entries()).map(([remoteSessionId, taskId]) => ({
                remoteSessionId,
                taskId,
                status: 'active' as const,
                linkedAt: getNowIso(),
                lastSeenAt: getNowIso(),
            }));
        const channelDeliveries = listChannelDeliveryEvents();
        const pendingChannelDeliveries = channelDeliveries.filter((event) => event.status === 'pending').length;
        const ackedChannelDeliveries = channelDeliveries.filter((event) => event.status === 'acked').length;
        const activeTaskId = tasks.find((task) => task.status === 'running')?.taskId
            ?? tasks.find((task) => task.status === 'retrying')?.taskId
            ?? tasks.find((task) => task.status === 'suspended')?.taskId
            ?? tasks.find((task) => task.status === 'interrupted')?.taskId;
        return {
            generatedAt: getNowIso(),
            activeTaskId,
            tasks,
            count: tasks.length,
            remoteSessions: {
                count: remoteSessions.length,
                sessions: remoteSessions,
            },
            channelDeliveries: {
                count: channelDeliveries.length,
                pending: pendingChannelDeliveries,
                acked: ackedChannelDeliveries,
            },
            policyGateBridge: {
                ...forwardBridgeStats,
            },
            remoteSessionGovernance: {
                ...remoteSessionGovernancePolicy,
            },
        };
    };
    const bindRemoteSessionToTask = (taskId: string, remoteSessionId: string): void => {
        const normalizedRemoteSessionId = remoteSessionId.trim();
        if (!normalizedRemoteSessionId) {
            return;
        }
        remoteSessionToTaskId.set(normalizedRemoteSessionId, taskId);
    };
    const unbindRemoteSession = (remoteSessionId: string): void => {
        const normalizedRemoteSessionId = remoteSessionId.trim();
        if (!normalizedRemoteSessionId) {
            return;
        }
        remoteSessionToTaskId.delete(normalizedRemoteSessionId);
    };
    const resolveTaskIdForExternalEvent = (payload: Record<string, unknown>): string | null => {
        const directTaskId = getString(payload.taskId);
        if (directTaskId) {
            return directTaskId;
        }
        const remoteSessionId = getString(payload.remoteSessionId);
        if (!remoteSessionId) {
            return null;
        }
        return remoteSessionToTaskId.get(remoteSessionId) ?? null;
    };
    const resolveRemoteSessionState = (remoteSessionId: string): RemoteSessionState | undefined => {
        if (deps.remoteSessionStore) {
            return deps.remoteSessionStore.get(remoteSessionId);
        }
        const taskId = remoteSessionToTaskId.get(remoteSessionId);
        if (!taskId) {
            return undefined;
        }
        return {
            remoteSessionId,
            taskId,
            status: 'active',
            linkedAt: getNowIso(),
            lastSeenAt: getNowIso(),
        };
    };
    const listRemoteSessions = (input?: {
        taskId?: string;
        status?: RemoteSessionStatus;
    }): RemoteSessionState[] => {
        if (deps.remoteSessionStore) {
            return deps.remoteSessionStore.list(input);
        }
        return Array.from(remoteSessionToTaskId.entries())
            .map(([remoteSessionId, mappedTaskId]) => ({
                remoteSessionId,
                taskId: mappedTaskId,
                status: 'active' as const,
                linkedAt: getNowIso(),
                lastSeenAt: getNowIso(),
            }))
            .filter((session) => !input?.taskId || session.taskId === input.taskId)
            .filter((session) => !input?.status || session.status === input.status);
    };
    const evaluateRemoteSessionGovernance = (input: {
        remoteSessionId: string;
        targetTaskId: string;
        scope: RemoteSessionScope;
        metadata?: Record<string, unknown>;
    }): {
        allowed: boolean;
        error?: string;
        existingState?: RemoteSessionState;
        arbitration?: RemoteSessionArbitration;
    } => {
        const existingState = resolveRemoteSessionState(input.remoteSessionId);
        const targetTenantId = pickRemoteTenantId(input.metadata);
        const targetEndpointId = pickRemoteEndpointId(input.metadata);
        const existingScope = existingState
            ? parseRemoteSessionScope({}, existingState.metadata)
            : null;
        const managedContext = input.scope === 'managed' || existingScope === 'managed';
        if (
            remoteSessionGovernancePolicy.requireTenantIdForManaged
            && managedContext
            && !targetTenantId
        ) {
            return {
                allowed: false,
                error: 'remote_session_tenant_required',
                existingState,
            };
        }
        if (
            remoteSessionGovernancePolicy.requireEndpointIdForManaged
            && managedContext
            && !targetEndpointId
        ) {
            return {
                allowed: false,
                error: 'remote_session_endpoint_required',
                existingState,
            };
        }
        if (!existingState || existingState.status !== 'active') {
            return {
                allowed: true,
                existingState,
                arbitration: {
                    action: 'none',
                },
            };
        }
        const existingTenantId = pickRemoteTenantId(existingState.metadata);
        const existingEndpointId = pickRemoteEndpointId(existingState.metadata);
        if (
            remoteSessionGovernancePolicy.enforceManagedIdentityImmutable
            && managedContext
        ) {
            if (
                existingTenantId
                && targetTenantId
                && existingTenantId !== targetTenantId
            ) {
                return {
                    allowed: false,
                    error: 'remote_session_tenant_conflict_immutable',
                    existingState,
                };
            }
            if (
                existingEndpointId
                && targetEndpointId
                && existingEndpointId !== targetEndpointId
            ) {
                return {
                    allowed: false,
                    error: 'remote_session_endpoint_conflict_immutable',
                    existingState,
                };
            }
        }
        if (
            remoteSessionGovernancePolicy.enforceTenantIsolation
            && existingTenantId
            && targetTenantId
            && existingTenantId !== targetTenantId
        ) {
            return {
                allowed: false,
                error: 'remote_session_tenant_conflict',
                existingState,
            };
        }
        const crossTaskConflict = existingState.taskId !== input.targetTaskId;
        const endpointConflict = (
            remoteSessionGovernancePolicy.enforceEndpointIsolation
            && !crossTaskConflict
            && existingEndpointId
            && targetEndpointId
            && existingEndpointId !== targetEndpointId
        );
        if (!crossTaskConflict && !endpointConflict) {
            return {
                allowed: true,
                existingState,
                arbitration: {
                    action: 'none',
                },
            };
        }
        if (remoteSessionGovernancePolicy.conflictStrategy === 'takeover') {
            return {
                allowed: true,
                existingState,
                arbitration: {
                    action: 'takeover',
                    previousTaskId: existingState.taskId,
                    previousEndpointId: existingEndpointId,
                },
            };
        }
        if (remoteSessionGovernancePolicy.conflictStrategy === 'takeover_if_stale') {
            const lastSeenAtMs = Date.parse(existingState.lastSeenAt);
            const nowMs = Date.parse(getNowIso());
            const staleMs = (
                Number.isFinite(lastSeenAtMs)
                && Number.isFinite(nowMs)
            )
                ? Math.max(0, nowMs - lastSeenAtMs)
                : Number.POSITIVE_INFINITY;
            if (staleMs >= remoteSessionGovernancePolicy.staleAfterMs) {
                return {
                    allowed: true,
                    existingState,
                    arbitration: {
                        action: 'takeover_stale',
                        previousTaskId: existingState.taskId,
                        previousEndpointId: existingEndpointId,
                        staleMs,
                    },
                };
            }
            return {
                allowed: false,
                error: endpointConflict
                    ? 'remote_session_endpoint_conflict_active'
                    : 'remote_session_task_conflict_active',
                existingState,
            };
        }
        return {
            allowed: false,
            error: endpointConflict
                ? 'remote_session_endpoint_conflict'
                : 'remote_session_task_conflict',
            existingState,
        };
    };
    const evaluateManagedTenantCommandGovernance = (
        payload: Record<string, unknown>,
        remoteSessionId?: string,
    ): { allowed: true } | { allowed: false; error: string; remoteSession: RemoteSessionState | null } => {
        if (!remoteSessionGovernancePolicy.requireTenantIdForManagedCommands) {
            return { allowed: true };
        }
        if (!remoteSessionId) {
            return { allowed: true };
        }
        const existingState = resolveRemoteSessionState(remoteSessionId);
        if (!existingState) {
            return { allowed: true };
        }
        const scope = parseRemoteSessionScope({}, existingState.metadata);
        if (scope !== 'managed') {
            return { allowed: true };
        }
        const existingTenantId = pickRemoteTenantId(existingState.metadata);
        if (!existingTenantId) {
            return { allowed: true };
        }
        const providedTenantId = pickTenantFromPayloadOrMetadata(payload);
        if (!providedTenantId) {
            return {
                allowed: false,
                error: 'remote_session_tenant_command_required',
                remoteSession: existingState,
            };
        }
        if (providedTenantId !== existingTenantId) {
            return {
                allowed: false,
                error: 'remote_session_tenant_command_mismatch',
                remoteSession: existingState,
            };
        }
        return { allowed: true };
    };
    const upsertRemoteSessionRecord = (input: {
        remoteSessionId: string;
        taskId: string;
        channel?: string;
        metadata?: Record<string, unknown>;
    }): { success: boolean; conflict?: boolean; state?: RemoteSessionState } => {
        if (!deps.remoteSessionStore) {
            return {
                success: true,
                state: {
                    remoteSessionId: input.remoteSessionId,
                    taskId: input.taskId,
                    channel: input.channel,
                    status: 'active',
                    linkedAt: getNowIso(),
                    lastSeenAt: getNowIso(),
                    metadata: input.metadata,
                },
            };
        }
        return deps.remoteSessionStore.upsertLink(input);
    };
    const heartbeatRemoteSessionRecord = (remoteSessionId: string, metadata?: Record<string, unknown>): {
        success: boolean;
        state?: RemoteSessionState;
    } => {
        if (!deps.remoteSessionStore) {
            const taskId = remoteSessionToTaskId.get(remoteSessionId);
            if (!taskId) {
                return { success: false };
            }
            return {
                success: true,
                state: {
                    remoteSessionId,
                    taskId,
                    status: 'active',
                    linkedAt: getNowIso(),
                    lastSeenAt: getNowIso(),
                    metadata,
                },
            };
        }
        return deps.remoteSessionStore.heartbeat(remoteSessionId, metadata);
    };
    const closeRemoteSessionRecord = (remoteSessionId: string): {
        success: boolean;
        state?: RemoteSessionState;
    } => {
        if (!deps.remoteSessionStore) {
            const taskId = remoteSessionToTaskId.get(remoteSessionId);
            if (!taskId) {
                return { success: false };
            }
            return {
                success: true,
                state: {
                    remoteSessionId,
                    taskId,
                    status: 'closed',
                    linkedAt: getNowIso(),
                    lastSeenAt: getNowIso(),
                },
            };
        }
        return deps.remoteSessionStore.close(remoteSessionId);
    };
    const enqueueChannelDeliveryEvent = (input: {
        taskId: string;
        remoteSessionId?: string;
        channel: string;
        eventType: string;
        content?: string;
        metadata?: Record<string, unknown>;
        eventId?: string;
        forceRequeue?: boolean;
    }): {
        event: ChannelDeliveryEvent;
        deduplicated: boolean;
        requeued: boolean;
    } => {
        if (!deps.remoteSessionStore) {
            const normalizedEventId = getString(input.eventId) ?? '';
            const existing = normalizedEventId ? channelDeliveryEvents.get(normalizedEventId) : undefined;
            if (existing && input.forceRequeue !== true) {
                return {
                    event: existing,
                    deduplicated: true,
                    requeued: false,
                };
            }
            const event: ChannelDeliveryEvent = {
                id: normalizedEventId || `delivery-${createId()}-${channelDeliveryEvents.size + 1}`,
                taskId: input.taskId,
                remoteSessionId: input.remoteSessionId,
                channel: input.channel,
                eventType: input.eventType,
                content: input.content,
                metadata: input.metadata,
                injectedAt: existing?.injectedAt ?? getNowIso(),
                status: 'pending',
                deliveryAttempts: existing?.deliveryAttempts ?? 0,
                lastDeliveredAt: existing?.lastDeliveredAt,
            };
            channelDeliveryEvents.set(event.id, event);
            return {
                event,
                deduplicated: false,
                requeued: Boolean(existing),
            };
        }
        const created = deps.remoteSessionStore.enqueueChannelEvent({
            taskId: input.taskId,
            remoteSessionId: input.remoteSessionId,
            channel: input.channel,
            eventType: input.eventType,
            content: input.content,
            metadata: input.metadata,
            eventId: input.eventId,
            forceRequeue: input.forceRequeue,
        });
        if (created.success && created.event) {
            channelDeliveryEvents.set(created.event.id, created.event);
            return {
                event: created.event,
                deduplicated: created.deduplicated === true,
                requeued: created.requeued === true,
            };
        }
        const fallback: ChannelDeliveryEvent = {
            id: getString(input.eventId) || `delivery-${createId()}-${channelDeliveryEvents.size + 1}`,
            taskId: input.taskId,
            remoteSessionId: input.remoteSessionId,
            channel: input.channel,
            eventType: input.eventType,
            content: input.content,
            metadata: input.metadata,
            injectedAt: getNowIso(),
            status: 'pending',
            deliveryAttempts: 0,
        };
        channelDeliveryEvents.set(fallback.id, fallback);
        return {
            event: fallback,
            deduplicated: false,
            requeued: false,
        };
    };
    const listChannelDeliveryEvents = (input?: {
        taskId?: string;
        remoteSessionId?: string;
        status?: ChannelDeliveryStatus;
        limit?: number;
    }): ChannelDeliveryEvent[] => {
        if (!deps.remoteSessionStore) {
            const taskId = getString(input?.taskId) ?? undefined;
            const remoteSessionId = getString(input?.remoteSessionId) ?? undefined;
            const status = input?.status;
            const limit = typeof input?.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
                ? Math.floor(input.limit)
                : undefined;
            const listed = Array
                .from(channelDeliveryEvents.values())
                .filter((event) => !taskId || event.taskId === taskId)
                .filter((event) => !remoteSessionId || event.remoteSessionId === remoteSessionId)
                .filter((event) => !status || event.status === status)
                .sort((left, right) => right.injectedAt.localeCompare(left.injectedAt));
            return limit ? listed.slice(0, limit) : listed;
        }
        const listed = deps.remoteSessionStore.listChannelEvents(input);
        for (const event of listed) {
            channelDeliveryEvents.set(event.id, event);
        }
        return listed;
    };
    const ackChannelDeliveryEvent = (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
        metadata?: Record<string, unknown>;
    }): { success: boolean; event?: ChannelDeliveryEvent } => {
        if (!deps.remoteSessionStore) {
            const existing = channelDeliveryEvents.get(input.eventId);
            if (!existing) {
                return { success: false };
            }
            if (input.taskId && existing.taskId !== input.taskId) {
                return { success: false };
            }
            if (input.remoteSessionId && existing.remoteSessionId !== input.remoteSessionId) {
                return { success: false };
            }
            const next: ChannelDeliveryEvent = {
                ...existing,
                status: 'acked',
                ackedAt: getNowIso(),
                ackMetadata: input.metadata,
            };
            channelDeliveryEvents.set(next.id, next);
            return {
                success: true,
                event: next,
            };
        }
        const acked = deps.remoteSessionStore.ackChannelEvent(input);
        if (acked.success && acked.event) {
            channelDeliveryEvents.set(acked.event.id, acked.event);
        }
        return acked;
    };
    const getChannelDeliveryEvent = (eventId: string): ChannelDeliveryEvent | undefined => {
        if (!deps.remoteSessionStore) {
            return channelDeliveryEvents.get(eventId);
        }
        const event = deps.remoteSessionStore.getChannelEvent(eventId);
        if (event) {
            channelDeliveryEvents.set(event.id, event);
        }
        return event;
    };
    const markChannelDeliveryDelivered = (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
    }): { success: boolean; event?: ChannelDeliveryEvent } => {
        if (!deps.remoteSessionStore) {
            const existing = channelDeliveryEvents.get(input.eventId);
            if (!existing) {
                return { success: false };
            }
            if (input.taskId && existing.taskId !== input.taskId) {
                return { success: false };
            }
            if (input.remoteSessionId && existing.remoteSessionId && existing.remoteSessionId !== input.remoteSessionId) {
                return { success: false };
            }
            if (existing.status !== 'pending') {
                return { success: true, event: existing };
            }
            const updated: ChannelDeliveryEvent = {
                ...existing,
                deliveryAttempts: (existing.deliveryAttempts ?? 0) + 1,
                lastDeliveredAt: getNowIso(),
            };
            channelDeliveryEvents.set(updated.id, updated);
            return {
                success: true,
                event: updated,
            };
        }
        const marked = deps.remoteSessionStore.markChannelEventDelivered(input);
        if (marked.success && marked.event) {
            channelDeliveryEvents.set(marked.event.id, marked.event);
        }
        return marked;
    };
    const appendTranscript = (
        taskId: string,
        role: 'user' | 'assistant' | 'system',
        content: string,
    ): void => {
        if (!deps.taskTranscriptStore) {
            return;
        }
        try {
            deps.taskTranscriptStore.append(taskId, role, content);
        } catch (error) {
            console.error(`[MastraEntrypoint] Failed to append transcript for ${taskId}:`, error);
        }
    };
    const emitHookEvent = (
        type: 'SessionStart' | 'TaskCreated' | 'RemoteSessionLinked' | 'ChannelEventInjected' | 'PermissionRequest' | 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'PostCompact' | 'TaskCompleted' | 'TaskFailed' | 'TaskRewound',
        event: {
            taskId?: string;
            runId?: string;
            traceId?: string;
            payload?: Record<string, unknown>;
        },
    ): void => {
        if (!deps.hookRuntime) {
            return;
        }
        try {
            deps.hookRuntime.emit({
                type,
                taskId: event.taskId,
                runId: event.runId,
                traceId: event.traceId,
                payload: event.payload,
            });
        } catch (error) {
            console.error(`[MastraEntrypoint] Failed to emit hook event (${type}):`, error);
        }
    };
    const applyPolicyDecision = (input: {
        requestId: string;
        action: PolicyDecisionAction;
        commandType?: string;
        taskId?: string;
        source: string;
        payload?: Record<string, unknown>;
        approved?: boolean;
    }): {
        allowed: boolean;
        reason: string;
        ruleId: string;
    } => {
        const decision = deps.policyEngine
            ? deps.policyEngine.evaluate({
                action: input.action,
                commandType: input.commandType,
                taskId: input.taskId,
                payload: input.payload,
                approved: input.approved,
            })
            : {
                allowed: true,
                reason: 'allowed_by_default',
                ruleId: 'default-allow',
            };
        if (deps.policyDecisionLog) {
            try {
                deps.policyDecisionLog.append({
                    requestId: input.requestId,
                    action: input.action,
                    commandType: input.commandType,
                    taskId: input.taskId,
                    source: input.source,
                    allowed: decision.allowed,
                    reason: decision.reason,
                    ruleId: decision.ruleId,
                });
            } catch (error) {
                console.error('[MastraEntrypoint] Failed to append policy decision log:', error);
            }
        }
        return decision;
    };
    let runMissingToolEvidenceAutoRetry: ((input: {
        taskId: string;
        turnEventStateKey: string;
        turnId?: string;
        traceId?: string | null;
        requiredCapabilities: string[];
        source: 'complete' | 'error';
        runId?: string;
    }) => boolean) | null = null;
    const emitDesktopEvent = async (
        taskId: string,
        event: DesktopEvent,
        emit: (message: OutgoingMessage) => void,
        enforcedTurnId?: string,
    ): Promise<void> => {
        const turnId = event.turnId ?? enforcedTurnId;
        const traceId = event.traceId ?? null;
        const eventRunId = typeof event.runId === 'string' ? event.runId.trim() : '';
        const latestTaskRunId = latestRunIdByTaskId.get(taskId);
        const shouldForceAdvanceTaskRunId = (
            event.type === 'tool_call'
            && typeof event.toolName === 'string'
            && isDelegatedAgentToolName(event.toolName)
        );
        const shouldTrackTaskRunId = eventRunId.length > 0
            && (
                event.type === 'tool_call'
                || event.type === 'text_delta'
                || event.type === 'complete'
                || event.type === 'error'
                || event.type === 'tripwire'
            );
        if (
            shouldTrackTaskRunId
            && (
                !latestTaskRunId
                || latestTaskRunId.length === 0
                || latestTaskRunId === eventRunId
                || shouldForceAdvanceTaskRunId
            )
        ) {
            latestRunIdByTaskId.set(taskId, eventRunId);
        }
        const trackedTaskRunId = latestRunIdByTaskId.get(taskId);
        const isAgentApprovalEvent = event.type === 'approval_required'
            && isDelegatedAgentToolName(event.toolName);
        const turnEventStateKey = buildTaskTurnEventStateKey({
            taskId,
            turnId,
            runId: event.runId,
        });
        const isToolEvidenceEvent = event.type === 'tool_call'
            || event.type === 'tool_result'
            || event.type === 'approval_required';
        if (isToolEvidenceEvent) {
            const isDelegatedAgentToolCall = event.type === 'tool_call'
                && typeof event.toolName === 'string'
                && isDelegatedAgentToolName(event.toolName);
            const requiredCompletionCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
            const evidenceStrength: 'weak' | 'strong' = event.type === 'tool_result'
                ? resolveToolResultEvidenceStrength({
                    event,
                    requiredCompletionCapabilities,
                })
                : resolveNonResultToolEvidenceStrength({
                    event,
                    requiredCompletionCapabilities,
                    isDelegatedAgentToolCall,
                });
            const satisfiedCompletionCapabilities = resolveSatisfiedCompletionCapabilitiesFromToolEvidence({
                event,
                requiredCompletionCapabilities,
                isDelegatedAgentToolCall,
            });
            const resultAttemptedCompletionCapabilities = event.type === 'tool_result'
                ? resolveToolResultAttemptedCompletionCapabilities({
                    event,
                    requiredCompletionCapabilities,
                })
                : [];
            if (event.type === 'tool_call') {
                const toolName = typeof event.toolName === 'string' ? event.toolName : '';
                if (COMMAND_EXECUTION_EVIDENCE_TOOL_PATTERN.test(toolName)) {
                    const command = extractCommandFromToolArgs(event.args);
                    if (command) {
                        markTaskTurnCommandInvocation({
                            key: turnEventStateKey,
                            taskId,
                            command,
                        });
                    }
                }
            } else if (event.type === 'tool_result') {
                const fallbackCommand = getTaskLatestCommandInvocation(turnEventStateKey, taskId);
                const recoveryHint = resolveCommandRecoveryHintFromToolResult({
                    toolName: event.toolName,
                    result: event.result,
                    fallbackCommand,
                });
                if (recoveryHint) {
                    markTaskTurnCommandRecoveryHint({
                        key: turnEventStateKey,
                        taskId,
                        hint: recoveryHint,
                    });
                    markTaskTurnCommandInvocation({
                        key: turnEventStateKey,
                        taskId,
                        command: recoveryHint.failedCommand,
                    });
                }
                const commandFailureInfo = resolveCommandFailureInfoFromToolResult({
                    toolName: event.toolName,
                    result: event.result,
                    fallbackCommand,
                    isError: event.isError === true,
                });
                if (commandFailureInfo) {
                    markTaskTurnCommandFailureInfo({
                        key: turnEventStateKey,
                        taskId,
                        info: commandFailureInfo,
                    });
                    if (commandFailureInfo.failedCommand) {
                        markTaskTurnCommandInvocation({
                            key: turnEventStateKey,
                            taskId,
                            command: commandFailureInfo.failedCommand,
                        });
                    }
                }
            }
            markTaskTurnToolEvidence({
                key: turnEventStateKey,
                evidenceStrength,
                toolName: typeof event.toolName === 'string' ? event.toolName : undefined,
                satisfiedCompletionCapabilities,
                resultAttemptedCompletionCapabilities,
            });
            if (event.type === 'tool_call' || event.type === 'tool_result') {
                recordDelegatedAgentTaskNotification({
                    taskId,
                    event,
                    turnId,
                    traceId,
                });
            }
        }
        const emitMissingToolEvidenceFailure = (source: 'complete' | 'error'): void => {
            const requiredCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
            const missingCapabilities = getTaskTurnMissingRequiredCompletionCapabilities(turnEventStateKey);
            const retryCapabilities = missingCapabilities.length > 0
                ? missingCapabilities
                : requiredCapabilities;
            if (
                runMissingToolEvidenceAutoRetry
                && runMissingToolEvidenceAutoRetry({
                    taskId,
                    turnEventStateKey,
                    turnId,
                    traceId,
                    requiredCapabilities: retryCapabilities,
                    source,
                    runId: event.runId,
                })
            ) {
                return;
            }
            if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'error')) {
                return;
            }
            markTaskTurnTerminalEvent(turnEventStateKey, 'error');
            clearPendingApprovalsForTask(taskId);
            const existingRetry = taskStates.get(taskId)?.retry;
            upsertTaskState(taskId, {
                status: 'failed',
                suspended: false,
                suspensionReason: undefined,
                checkpoint: undefined,
                retry: existingRetry
                    ? {
                        ...existingRetry,
                        lastError: 'complete_without_required_tool_evidence',
                    }
                    : undefined,
            });
            emitHookEvent('TaskFailed', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    message: 'Task completed without required tool evidence.',
                    errorCode: 'E_PROTOCOL_MISSING_TOOL_EVIDENCE',
                    recoverable: true,
                    requiredCapabilities,
                    missingCapabilities,
                    source,
                },
            });
            emit({
                type: 'TASK_FAILED',
                taskId,
                payload: {
                    error: 'Task completed without required tool evidence.',
                    errorCode: 'E_PROTOCOL_MISSING_TOOL_EVIDENCE',
                    recoverable: true,
                    suggestion: 'Retry this task and ensure required tools are invoked before completion.',
                    requiredCapabilities,
                    missingCapabilities,
                    source,
                    traceId,
                    turnId,
                },
            });
        };
        const suppressTerminalWhileAwaitingApproval = (input: {
            terminalType: 'complete' | 'error' | 'tripwire';
            detail?: string;
        }): boolean => {
            if (!hasPendingApprovalForTask(taskId)) {
                return false;
            }
            const currentState = taskStates.get(taskId);
            upsertTaskState(taskId, {
                status: 'suspended',
                suspended: true,
                suspensionReason: 'approval_required',
                checkpoint: currentState?.checkpoint ?? {
                    id: `checkpoint:approval-required:${createId()}`,
                    label: 'Awaiting user approval',
                    at: getNowIso(),
                    metadata: {
                        reason: 'approval_required',
                    },
                },
            });
            if (isAutoApprovalDebugEnabled()) {
                console.warn('[MastraEntrypoint] Suppressing terminal event while awaiting approval', {
                    taskId,
                    terminalType: input.terminalType,
                    detail: input.detail ?? null,
                    turnId: turnId ?? null,
                    runId: event.runId ?? null,
                });
            }
            return true;
        };
        const emitSupplementalTaskSummaryIfNeeded = (): void => {
            const requiredCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
            if (requiredCapabilities.length === 0) {
                return;
            }
            if (!hasTaskTurnSatisfiedCompletionEvidence(turnEventStateKey)) {
                return;
            }
            const assistantNarrativeChars = getTaskTurnAssistantNarrativeChars(turnEventStateKey);
            if (assistantNarrativeChars <= 0 || assistantNarrativeChars >= TASK_SUMMARY_MIN_CHARS) {
                return;
            }
            const turnContractDomain = getTaskTurnContractDomain(turnEventStateKey);
            const supplementalSummary = turnContractDomain === 'market'
                ? '已完成必要工具调用并汇总结果。投资建议评级：观望（Hold）。若需要，我可以继续补充更详细的依据、价格区间与风险提示。'
                : '已完成必要工具调用并汇总结果。若需要，我可以继续补充更详细的结论、依据与下一步建议。';
            appendTranscript(taskId, 'assistant', supplementalSummary);
            markTaskTurnAssistantNarrative({
                key: turnEventStateKey,
                content: supplementalSummary,
            });
            const streamCorrelationId = eventRunId.length > 0
                ? (
                    turnId && turnId.trim().length > 0
                        ? `stream:${taskId}:${turnId.trim()}:assistant`
                        : `stream:${eventRunId}:assistant`
                )
                : (
                    turnId && turnId.trim().length > 0
                        ? `stream:${taskId}:${turnId.trim()}:assistant`
                        : undefined
                );
            emit({
                type: 'TEXT_DELTA',
                taskId,
                payload: {
                    delta: supplementalSummary,
                    role: 'assistant',
                    messageId: streamCorrelationId,
                    correlationId: streamCorrelationId,
                    traceId,
                    turnId,
                },
            });
        };
        const isTerminalEvent = event.type === 'complete' || event.type === 'error' || event.type === 'tripwire';
        if (!isTerminalEvent && hasTaskTurnTerminalEvent(turnEventStateKey)) {
            return;
        }
        if (typeof event.traceId === 'string' && event.traceId.length > 0) {
            upsertTaskState(taskId, {
                lastTraceId: event.traceId,
            });
        }
        if (event.type === 'text_delta') {
            const taskTurnRouteMode = getTaskTurnRouteMode(turnEventStateKey);
            if (taskTurnRouteMode === 'task' && event.role === 'thinking') {
                return;
            }
            if (typeof event.content === 'string') {
                const trimmedContent = event.content.trim();
                if (trimmedContent.length > 0) {
                    if (
                        taskTurnRouteMode === 'task'
                        && shouldSuppressTaskTurnExecutionNarrationChunk({
                            key: turnEventStateKey,
                            chunk: event.content,
                        })
                    ) {
                        return;
                    }
                    if (
                        eventRunId.length > 0
                        && !claimTaskTurnPrimaryNarrativeRun({
                            key: turnEventStateKey,
                            runId: eventRunId,
                        })
                    ) {
                        return;
                    }
                    if (shouldSuppressTaskTurnAssistantChunk({
                        key: turnEventStateKey,
                        chunk: event.content,
                    })) {
                        return;
                    }
                }
                if (event.role !== 'thinking') {
                    appendTranscript(taskId, 'assistant', event.content);
                    if (trimmedContent.length > 0) {
                        markTaskTurnAssistantNarrative({
                            key: turnEventStateKey,
                            content: trimmedContent,
                        });
                    }
                }
            }
            const streamCorrelationId = typeof event.runId === 'string' && event.runId.length > 0
                ? (
                    turnId && turnId.trim().length > 0
                        ? `stream:${taskId}:${turnId.trim()}:assistant`
                        : `stream:${event.runId}:assistant`
                )
                : (
                    turnId && turnId.trim().length > 0
                        ? `stream:${taskId}:${turnId.trim()}:assistant`
                        : undefined
                );
            emit({
                type: 'TEXT_DELTA',
                taskId,
                payload: {
                    delta: event.content,
                    role: event.role ?? 'assistant',
                    messageId: streamCorrelationId,
                    correlationId: streamCorrelationId,
                    traceId,
                    turnId,
                },
            });
            return;
        }
        if (event.type === 'approval_required') {
            const effectiveApprovalRunId = (() => {
                if (isAgentApprovalEvent && trackedTaskRunId && trackedTaskRunId.length > 0) {
                    return trackedTaskRunId;
                }
                if (eventRunId.length > 0) {
                    return eventRunId;
                }
                if (trackedTaskRunId && trackedTaskRunId.length > 0) {
                    return trackedTaskRunId;
                }
                return '';
            })();
            const requiredCompletionCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
            // Auto-approve safe tools without requiring user confirmation
            if (shouldAutoApproveTool({
                event,
                requiredCompletionCapabilities,
            })) {
                const autoApprovalDebugEnabled = isAutoApprovalDebugEnabled();
                const toolCallId = event.toolCallId;
                if (toolCallId && toolCallId.length > 0) {
                    const completed = autoApprovalCompletedByTaskId.get(taskId);
                    if (completed?.has(toolCallId)) {
                        if (autoApprovalDebugEnabled) {
                            console.warn('[MastraEntrypoint][auto-approval] duplicate ignored (completed)', {
                                taskId,
                                toolName: event.toolName,
                                toolCallId,
                            });
                        }
                        return;
                    }
                    const inFlight = autoApprovalInFlightByTaskId.get(taskId);
                    if (inFlight?.has(toolCallId)) {
                        if (autoApprovalDebugEnabled) {
                            console.warn('[MastraEntrypoint][auto-approval] duplicate ignored (in-flight)', {
                                taskId,
                                toolName: event.toolName,
                                toolCallId,
                            });
                        }
                        return;
                    }
                    const nextInFlight = inFlight ?? new Set<string>();
                    nextInFlight.add(toolCallId);
                    autoApprovalInFlightByTaskId.set(taskId, nextInFlight);
                }
                const autoApprovalResumeTimeoutMs = resolveAutoApprovalResumeTimeoutMs();
                const runWithAutoApprovalTimeout = async <T>(promise: Promise<T>, stage: 'approve' | 'forward'): Promise<T> => {
                    return await Promise.race([
                        promise,
                        new Promise<T>((_, reject) => {
                            setTimeout(() => {
                                reject(new Error(`auto_approval_resume_timeout:${stage}:${autoApprovalResumeTimeoutMs}`));
                            }, autoApprovalResumeTimeoutMs);
                        }),
                    ]);
                };
                const candidateRunIds = Array.from(new Set(
                    [
                        effectiveApprovalRunId,
                        eventRunId,
                        trackedTaskRunId,
                    ].filter((value): value is string => typeof value === 'string' && value.length > 0),
                ));
                if (candidateRunIds.length === 0) {
                    candidateRunIds.push(eventRunId);
                }
                if (autoApprovalDebugEnabled) {
                    console.warn('[MastraEntrypoint][auto-approval] start', {
                        taskId,
                        toolName: event.toolName,
                        toolCallId: event.toolCallId,
                        eventRunId,
                        trackedTaskRunId: trackedTaskRunId ?? null,
                        effectiveApprovalRunId,
                        candidateRunIds,
                    });
                }
                const clearAutoApprovalInFlight = (): void => {
                    if (toolCallId && toolCallId.length > 0) {
                        const inFlight = autoApprovalInFlightByTaskId.get(taskId);
                        if (inFlight) {
                            inFlight.delete(toolCallId);
                            if (inFlight.size === 0) {
                                autoApprovalInFlightByTaskId.delete(taskId);
                            }
                        }
                    }
                };
                let lastAutoApprovalError: unknown;
                let shouldCleanupInFlightOnExit = true;
                try {
                    for (const candidateRunId of candidateRunIds) {
                        let autoResumeChain: Promise<void> = Promise.resolve();
                        let approvalPromise: Promise<void> | null = null;
                        try {
                            let sawResumedEvent = false;
                            let resolveFirstResumedEvent: (() => void) | null = null;
                            const firstResumedEvent = new Promise<void>((resolve) => {
                                resolveFirstResumedEvent = resolve;
                            });
                            if (autoApprovalDebugEnabled) {
                                console.warn('[MastraEntrypoint][auto-approval] trying candidate', {
                                    taskId,
                                    toolName: event.toolName,
                                    toolCallId: event.toolCallId,
                                    candidateRunId,
                                });
                            }
                            approvalPromise = deps.handleApprovalResponse(
                                candidateRunId,
                                event.toolCallId,
                                true,
                                (resumedEvent) => {
                                    sawResumedEvent = true;
                                    resolveFirstResumedEvent?.();
                                    resolveFirstResumedEvent = null;
                                    autoResumeChain = autoResumeChain.then(async () => {
                                        await emitDesktopEvent(taskId, resumedEvent, emit, turnId);
                                    });
                                },
                                {
                                    taskId,
                                },
                            );
                            await runWithAutoApprovalTimeout(
                                Promise.race([
                                    firstResumedEvent,
                                    approvalPromise.then(() => {
                                        if (!sawResumedEvent) {
                                            throw new Error('auto_approval_resume_completed_without_events');
                                        }
                                    }),
                                ]),
                                'approve',
                            );
                            // Once resume stream is confirmed active, continue forwarding in background.
                            // Do not block on full stream completion here to avoid false timeout on long tasks.
                            void approvalPromise
                                .then(async () => {
                                    await autoResumeChain;
                                })
                                .catch((resumeError) => {
                                    console.warn('[MastraEntrypoint] Auto-approval resume chain failed after handoff:', resumeError);
                                })
                                .finally(() => {
                                    clearAutoApprovalInFlight();
                                });
                            shouldCleanupInFlightOnExit = false;
                            if (autoApprovalDebugEnabled) {
                                console.warn('[MastraEntrypoint][auto-approval] candidate handoff succeeded', {
                                    taskId,
                                    toolName: event.toolName,
                                    toolCallId: event.toolCallId,
                                    candidateRunId,
                                });
                            }
                            lastAutoApprovalError = undefined;
                            break;
                        } catch (candidateError) {
                            const message = candidateError instanceof Error ? candidateError.message : String(candidateError);
                            if (autoApprovalDebugEnabled) {
                                console.warn('[MastraEntrypoint][auto-approval] candidate failed', {
                                    taskId,
                                    toolName: event.toolName,
                                    toolCallId: event.toolCallId,
                                    candidateRunId,
                                    error: message,
                                });
                            }
                            lastAutoApprovalError = candidateError;
                            autoResumeChain = autoResumeChain.catch((resumeError) => {
                                console.warn('[MastraEntrypoint] Auto-approval resume chain failed after candidate retry:', resumeError);
                            });
                            if (message.includes('auto_approval_resume_timeout:')) {
                                // Timeout means candidate may still be running; avoid issuing duplicate approvals
                                // against fallback run ids, which can create duplicate assistant replies.
                                if (approvalPromise) {
                                    void approvalPromise
                                        .then(async () => {
                                            await autoResumeChain;
                                        })
                                        .catch((resumeError) => {
                                            console.warn('[MastraEntrypoint] Auto-approval resume chain failed after timeout handoff:', resumeError);
                                        })
                                        .finally(() => {
                                            clearAutoApprovalInFlight();
                                        });
                                    shouldCleanupInFlightOnExit = false;
                                    lastAutoApprovalError = undefined;
                                    if (autoApprovalDebugEnabled) {
                                        console.warn('[MastraEntrypoint][auto-approval] candidate handoff deferred after timeout', {
                                            taskId,
                                            toolName: event.toolName,
                                            toolCallId: event.toolCallId,
                                            candidateRunId,
                                        });
                                    }
                                }
                                break;
                            }
                        }
                    }
                    if (lastAutoApprovalError) {
                        throw lastAutoApprovalError;
                    }
                    if (toolCallId && toolCallId.length > 0) {
                        const completed = autoApprovalCompletedByTaskId.get(taskId) ?? new Set<string>();
                        completed.add(toolCallId);
                        autoApprovalCompletedByTaskId.set(taskId, completed);
                    }
                } catch (error) {
                    await emitDesktopEvent(taskId, {
                        type: 'error',
                        runId: event.runId ?? undefined,
                        message: error instanceof Error ? error.message : String(error),
                        turnId,
                    }, emit, turnId);
                    return;
                } finally {
                    if (shouldCleanupInFlightOnExit) {
                        clearAutoApprovalInFlight();
                    }
                }
                return;
            }
            const requestId = createId();
            if (hasMatchingPendingApproval({
                taskId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
            })) {
                return;
            }
            const requestPayload = {
                request: {
                    id: requestId,
                    timestamp: getNowIso(),
                    effectType: 'shell:write',
                    source: 'agent',
                    payload: {
                        description: `Mastra tool approval required: ${event.toolName}`,
                        command: JSON.stringify(event.args ?? {}),
                    },
                    context: {
                        taskId,
                        toolName: event.toolName,
                        traceId,
                        idempotencyKey: [
                            taskId,
                            turnId ?? 'no-turn',
                            event.toolCallId ?? `tool:${event.toolName ?? 'unknown'}`,
                        ].join(':'),
                    },
                },
                requiresUserConfirmation: true,
                riskLevel: 7,
            };
            emitHookEvent('PermissionRequest', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    requestId,
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                },
            });
            const checkpoint: TaskRuntimeCheckpoint = {
                id: `approval:${requestId}`,
                label: `Awaiting approval for ${event.toolName}`,
                at: getNowIso(),
                metadata: {
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                    reason: 'approval_required',
                },
            };
            pendingApprovals.set(requestId, {
                taskId,
                runId: effectiveApprovalRunId,
                toolCallId: event.toolCallId,
                toolName: event.toolName,
            });
            emit({
                type: 'EFFECT_REQUESTED',
                taskId,
                payload: requestPayload,
            });
            upsertTaskState(taskId, {
                status: 'suspended',
                suspended: true,
                suspensionReason: 'approval_required',
                checkpoint,
            });
            return;
        }
        if (event.type === 'complete') {
            if (suppressTerminalWhileAwaitingApproval({
                terminalType: 'complete',
                detail: event.finishReason,
            })) {
                return;
            }
            const hasAutoApprovalInFlight = (autoApprovalInFlightByTaskId.get(taskId)?.size ?? 0) > 0;
            if (!hasTaskTurnAssistantNarrative(turnEventStateKey) && hasAutoApprovalInFlight) {
                if (isAutoApprovalDebugEnabled()) {
                    console.warn('[MastraEntrypoint] Ignoring no-narrative complete during auto-approval resume', {
                        taskId,
                        runId: event.runId ?? null,
                        finishReason: event.finishReason ?? null,
                        turnId: turnId ?? null,
                    });
                }
                return;
            }
            if (!hasTaskTurnToolEvidenceRequirement(turnEventStateKey)) {
                const taskState = taskStates.get(taskId);
                const routeModeForTurn = getTaskTurnRouteMode(turnEventStateKey)
                    ?? taskState?.turnContract?.mode;
                if (routeModeForTurn === 'task') {
                    const fallbackMessage = typeof taskState?.lastUserMessage === 'string'
                        ? taskState.lastUserMessage
                        : '';
                    const fallbackRequiredCapabilities = fallbackMessage.trim().length > 0
                        ? deriveCompletionCapabilitiesFromMessage({
                            message: fallbackMessage,
                            workspacePath: taskState?.workspacePath,
                        })
                        : [];
                    if (fallbackRequiredCapabilities.length > 0) {
                        setTaskTurnCompletionRequirement({
                            key: turnEventStateKey,
                            requireToolEvidence: true,
                            requiredCompletionCapabilities: normalizeStringList(fallbackRequiredCapabilities),
                            turnContractHash: taskState?.turnContract?.hash,
                            turnContractDomain: taskState?.turnContract?.domain,
                            routeMode: 'task',
                            executionPath: taskState?.executionPath === 'direct'
                                ? 'direct'
                                : 'workflow',
                        });
                    }
                }
            }
            if (hasTaskTurnToolEvidenceRequirement(turnEventStateKey) && !hasTaskTurnSatisfiedCompletionEvidence(turnEventStateKey)) {
                emitMissingToolEvidenceFailure('complete');
                return;
            }
            if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'complete')) {
                return;
            }
            emitSupplementalTaskSummaryIfNeeded();
            markTaskTurnTerminalEvent(turnEventStateKey, 'complete');
            clearPendingApprovalsForTask(taskId);
            const retry = taskStates.get(taskId)?.retry;
            upsertTaskState(taskId, {
                status: 'finished',
                suspended: false,
                suspensionReason: undefined,
                checkpoint: undefined,
                retry: retry
                    ? {
                        ...retry,
                        lastError: undefined,
                    }
                    : undefined,
            });
            emitHookEvent('TaskCompleted', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    finishReason: event.finishReason ?? 'stop',
                },
            });
            emit({
                type: 'TASK_FINISHED',
                taskId,
                payload: {
                    summary: 'Task completed via Mastra runtime.',
                    finishReason: event.finishReason ?? 'stop',
                    traceId,
                    turnId,
                },
            });
            return;
        }
        if (event.type === 'error') {
            if (suppressTerminalWhileAwaitingApproval({
                terminalType: 'error',
                detail: event.message,
            })) {
                return;
            }
            const currentTaskRunId = latestRunIdByTaskId.get(taskId);
            if (
                !hasTaskTurnAssistantNarrative(turnEventStateKey)
                && isWorkflowSnapshotMissingError(event.message)
            ) {
                if (isAutoApprovalDebugEnabled()) {
                    console.warn('[MastraEntrypoint] Suppressing missing-snapshot error before narrative', {
                        taskId,
                        runId: event.runId ?? null,
                        message: event.message,
                        turnId: turnId ?? null,
                    });
                }
                return;
            }
            if (
                eventRunId.length > 0
                && typeof currentTaskRunId === 'string'
                && currentTaskRunId.length > 0
                && currentTaskRunId !== eventRunId
                && isRetryableRuntimeStreamError(event.message)
            ) {
                if (isAutoApprovalDebugEnabled()) {
                    console.warn('[MastraEntrypoint] Ignoring stale-run retryable error event', {
                        taskId,
                        runId: eventRunId,
                        currentTaskRunId,
                        message: event.message,
                        turnId: turnId ?? null,
                    });
                }
                return;
            }
            if (
                isStoreDisabledHistoryReferenceError(event.message)
                && hasTaskTurnAssistantNarrative(turnEventStateKey)
            ) {
                if (hasTaskTurnToolEvidenceRequirement(turnEventStateKey) && !hasTaskTurnSatisfiedCompletionEvidence(turnEventStateKey)) {
                    emitMissingToolEvidenceFailure('error');
                    return;
                }
                if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'complete')) {
                    return;
                }
                emitSupplementalTaskSummaryIfNeeded();
                markTaskTurnTerminalEvent(turnEventStateKey, 'complete');
                clearPendingApprovalsForTask(taskId);
                const retry = taskStates.get(taskId)?.retry;
                upsertTaskState(taskId, {
                    status: 'finished',
                    suspended: false,
                    suspensionReason: undefined,
                    checkpoint: undefined,
                    retry: retry
                        ? {
                            ...retry,
                            lastError: undefined,
                        }
                        : undefined,
                });
                emitHookEvent('TaskCompleted', {
                    taskId,
                    runId: event.runId,
                    traceId: typeof traceId === 'string' ? traceId : undefined,
                    payload: {
                        finishReason: 'assistant_text_store_disabled_history_recovered',
                    },
                });
                emit({
                    type: 'TASK_FINISHED',
                    taskId,
                    payload: {
                        summary: 'Task completed via Mastra runtime.',
                        finishReason: 'assistant_text_store_disabled_history_recovered',
                        traceId,
                        turnId,
                    },
                });
                return;
            }
            const hasAutoApprovalInFlight = (autoApprovalInFlightByTaskId.get(taskId)?.size ?? 0) > 0;
            if (
                !hasTaskTurnAssistantNarrative(turnEventStateKey)
                && hasAutoApprovalInFlight
                && isRetryableRuntimeStreamError(event.message)
            ) {
                if (isAutoApprovalDebugEnabled()) {
                    console.warn('[MastraEntrypoint] Ignoring retryable error during auto-approval resume', {
                        taskId,
                        runId: event.runId ?? null,
                        message: event.message,
                        turnId: turnId ?? null,
                    });
                }
                return;
            }
            const commandFailureInfo = getTaskTurnCommandFailureInfo(turnEventStateKey, taskId);
            const requiredCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
            if (
                commandFailureInfo
                && isRetryableRuntimeStreamError(event.message)
                && runMissingToolEvidenceAutoRetry
                && runMissingToolEvidenceAutoRetry({
                    taskId,
                    turnEventStateKey,
                    turnId,
                    traceId,
                    requiredCapabilities: requiredCapabilities.length > 0
                        ? requiredCapabilities
                        : [COMMAND_EXECUTION_CAPABILITY],
                    source: 'error',
                    runId: event.runId,
                })
            ) {
                return;
            }
            if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'error')) {
                return;
            }
            markTaskTurnTerminalEvent(turnEventStateKey, 'error');
            const classification = classifyRuntimeErrorMessage(event.message);
            const normalizedFailureMessage = normalizeTaskFailureMessage(
                event.message,
                classification,
                commandFailureInfo,
            );
            const failureSuggestion = commandFailureInfo
                ? `${classification.suggestion} Last failed step: retry only the failed command step instead of restarting the full task.`
                : classification.suggestion;
            if (
                commandFailureInfo
                && isRetryableRuntimeStreamError(event.message)
                && !hasTaskTurnCommandFailureNarrativeEmitted(turnEventStateKey)
            ) {
                const readableDelta = buildCommandFailureReadableDelta({
                    commandFailure: commandFailureInfo,
                });
                appendTranscript(taskId, 'assistant', readableDelta);
                markTaskTurnAssistantNarrative({
                    key: turnEventStateKey,
                    content: readableDelta,
                });
                markTaskTurnCommandFailureNarrativeEmitted(turnEventStateKey);
                emit({
                    type: 'TEXT_DELTA',
                    taskId,
                    payload: {
                        delta: readableDelta,
                        role: 'assistant',
                        traceId,
                        turnId,
                    },
                });
            }
            clearPendingApprovalsForTask(taskId);
            const existingRetry = taskStates.get(taskId)?.retry;
            upsertTaskState(taskId, {
                status: 'failed',
                suspended: false,
                suspensionReason: undefined,
                retry: existingRetry
                    ? {
                        ...existingRetry,
                        lastError: normalizedFailureMessage,
                    }
                    : undefined,
            });
            emitHookEvent('TaskFailed', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    message: normalizedFailureMessage,
                    errorCode: classification.errorCode,
                    recoverable: classification.recoverable,
                    failureClass: classification.failureClass,
                },
            });
            emit({
                type: 'TASK_FAILED',
                taskId,
                payload: {
                    error: normalizedFailureMessage,
                    errorCode: classification.errorCode,
                    recoverable: classification.recoverable,
                    suggestion: failureSuggestion,
                    failureClass: classification.failureClass,
                    traceId,
                    turnId,
                },
            });
            return;
        }
        if (event.type === 'tripwire') {
            if (suppressTerminalWhileAwaitingApproval({
                terminalType: 'tripwire',
                detail: event.reason,
            })) {
                return;
            }
            if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'tripwire')) {
                return;
            }
            markTaskTurnTerminalEvent(turnEventStateKey, 'tripwire');
            clearPendingApprovalsForTask(taskId);
            const existingRetry = taskStates.get(taskId)?.retry;
            upsertTaskState(taskId, {
                status: 'failed',
                suspended: false,
                suspensionReason: undefined,
                retry: existingRetry
                    ? {
                        ...existingRetry,
                        lastError: event.reason,
                    }
                    : undefined,
            });
            emitHookEvent('TaskFailed', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    reason: event.reason,
                    processorId: event.processorId,
                    retry: event.retry === true,
                },
            });
            emit({
                type: 'TASK_FAILED',
                taskId,
                payload: {
                    error: event.reason,
                    errorCode: 'MASTRA_TRIPWIRE_BLOCKED',
                    processorId: event.processorId ?? null,
                    retry: event.retry === true,
                    metadata: event.metadata ?? null,
                    traceId,
                    turnId,
                },
            });
            return;
        }
        if (event.type === 'suspended') {
            const currentState = taskStates.get(taskId);
            upsertTaskState(taskId, {
                status: 'suspended',
                suspended: true,
                suspensionReason: 'waiting_user_input',
                checkpoint: currentState?.checkpoint ?? {
                    id: 'checkpoint:waiting-user-input',
                    label: 'Waiting for user input',
                    at: getNowIso(),
                },
            });
            emit({
                type: 'TASK_STATUS',
                taskId,
                payload: {
                    status: 'idle',
                    blockingReason: 'Waiting for user input to resume Mastra task.',
                    traceId,
                    turnId,
                },
            });
            return;
        }
        if (event.type === 'rate_limited') {
            const existingRetry = taskStates.get(taskId)?.retry;
            const parsedAttempt = typeof event.attempt === 'number' && Number.isFinite(event.attempt)
                ? Math.max(1, Math.floor(event.attempt))
                : (existingRetry?.attempts ?? 0) + 1;
            const parsedMaxAttempts = typeof event.maxAttempts === 'number' && Number.isFinite(event.maxAttempts)
                ? Math.max(parsedAttempt, Math.floor(event.maxAttempts))
                : existingRetry?.maxAttempts;
            const retryMessage = typeof event.message === 'string' && event.message.trim().length > 0
                ? event.message
                : `Model response delayed. Retrying (${parsedAttempt}/${parsedMaxAttempts ?? '?'})...`;
            const timeoutStage = (
                event.stage === 'dns'
                || event.stage === 'connect'
                || event.stage === 'ttfb'
                || event.stage === 'first_token'
                || event.stage === 'last_token'
                || event.stage === 'unknown'
            )
                ? event.stage
                : null;
            const rawTimings = toOptionalRecord(event.timings);
            const timings = rawTimings
                ? {
                    elapsedMs: getOptionalFiniteNumber(rawTimings.elapsedMs),
                    dnsMs: getOptionalFiniteNumber(rawTimings.dnsMs),
                    connectMs: getOptionalFiniteNumber(rawTimings.connectMs),
                    ttfbMs: getOptionalFiniteNumber(rawTimings.ttfbMs),
                    firstTokenMs: getOptionalFiniteNumber(rawTimings.firstTokenMs),
                    lastTokenMs: getOptionalFiniteNumber(rawTimings.lastTokenMs),
                }
                : null;
            upsertTaskState(taskId, {
                status: 'running',
                suspended: false,
                suspensionReason: undefined,
                retry: {
                    attempts: parsedAttempt,
                    maxAttempts: parsedMaxAttempts,
                    lastRetryAt: getNowIso(),
                    lastError: typeof event.error === 'string' ? event.error : existingRetry?.lastError,
                },
            });
            emit({
                type: 'RATE_LIMITED',
                taskId,
                payload: {
                    message: retryMessage,
                    attempt: parsedAttempt,
                    maxRetries: parsedMaxAttempts,
                    retryAfterMs: typeof event.retryAfterMs === 'number' ? event.retryAfterMs : null,
                    error: typeof event.error === 'string' ? event.error : null,
                    stage: timeoutStage,
                    timings,
                    traceId,
                    turnId,
                },
            });
            return;
        }
        if (event.type === 'token_usage') {
            emit({
                type: 'TOKEN_USAGE',
                taskId,
                payload: {
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                    modelId: event.modelId ?? null,
                    provider: event.provider ?? null,
                    usage: event.usage,
                    traceId,
                },
            });
            return;
        }
        if (event.type === 'tool_call') {
            emitHookEvent('PreToolUse', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    toolName: event.toolName,
                    args: toRecord(event.args),
                },
            });
        }
        if (event.type === 'tool_result') {
            emitHookEvent('PostToolUse', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                    isError: event.isError === true,
                },
            });
        }
        upsertTaskState(taskId, {
            status: 'running',
            suspended: false,
            suspensionReason: undefined,
            checkpoint: undefined,
        });
        emit({
            type: 'TASK_EVENT',
            taskId,
            payload: {
                ...event,
                traceId,
            },
        });
        if (event.type === 'tool_call') {
            emit({
                type: 'TOOL_CALL',
                taskId,
                payload: {
                    name: event.toolName,
                    input: event.args ?? {},
                    traceId,
                    turnId,
                },
            });
            return;
        }
        if (event.type === 'tool_result') {
            const isError = event.isError === true;
            const finalSynthesisText = extractFinalSynthesisTextFromToolResult({
                toolName: event.toolName,
                isError,
                result: event.result,
            });
            emit({
                type: 'TOOL_RESULT',
                taskId,
                payload: {
                    name: event.toolName,
                    result: event.result,
                    isError,
                    toolCallId: event.toolCallId,
                    traceId,
                    turnId,
                },
            });
            if (finalSynthesisText.length > 0) {
                appendTranscript(taskId, 'assistant', finalSynthesisText);
                markTaskTurnAssistantNarrative({
                    key: turnEventStateKey,
                    content: finalSynthesisText,
                });
                const streamCorrelationId = (
                    turnId && turnId.trim().length > 0
                        ? `stream:${taskId}:${turnId.trim()}:assistant`
                        : (eventRunId.length > 0
                            ? `stream:${eventRunId}:assistant`
                            : undefined)
                );
                emit({
                    type: 'TEXT_DELTA',
                    taskId,
                    payload: {
                        delta: finalSynthesisText,
                        role: 'assistant',
                        messageId: streamCorrelationId,
                        correlationId: streamCorrelationId,
                        traceId,
                        turnId,
                    },
                });
            }
            emitSupplementalTaskSummaryIfNeeded();
        }
    };
    const processLegacySimpleCommand = async (
        command: ProtocolCommand,
        emit: (message: OutgoingMessage) => void,
    ): Promise<boolean> => {
        if (command.type === 'health_check') {
            emit({
                type: 'health',
                runtime: 'mastra',
                health: deps.getMastraHealth(),
            });
            return true;
        }
        if (command.type === 'user_message') {
            const message = getString((command as { message?: unknown }).message);
            const threadId = getString((command as { threadId?: unknown }).threadId);
            const resourceId = getString((command as { resourceId?: unknown }).resourceId);
            if (!message || !threadId || !resourceId) {
                emit({ type: 'error', message: 'invalid_command' });
                return true;
            }
            await deps.handleUserMessage(
                message,
                threadId,
                resourceId,
                (event) => emit(toRecord(event)),
            );
            return true;
        }
        if (command.type === 'approval_response') {
            const runId = getString((command as { runId?: unknown }).runId);
            const toolCallId = getString((command as { toolCallId?: unknown }).toolCallId);
            const approved = (command as { approved?: unknown }).approved;
            if (!runId || !toolCallId || typeof approved !== 'boolean') {
                emit({ type: 'error', message: 'invalid_command' });
                return true;
            }
            await deps.handleApprovalResponse(
                runId,
                toolCallId,
                approved,
                (event) => emit(toRecord(event)),
            );
            return true;
        }
        return false;
    };
    const rememberCompletedForwardResponseId = (responseId: string): void => {
        completedForwardResponseIds.add(responseId);
        if (completedForwardResponseIds.size > 1_000) {
            const oldest = completedForwardResponseIds.values().next().value;
            if (typeof oldest === 'string') {
                completedForwardResponseIds.delete(oldest);
            }
        }
    };
    const resolvePendingForwardResponse = (message: ProtocolCommand): PendingForwardResolution => {
        const messageId = getString(message.commandId);
        if (!messageId) {
            forwardBridgeStats.orphanResponses += 1;
            return 'orphan';
        }
        const pending = pendingForwardResponses.get(messageId);
        if (!pending) {
            if (completedForwardResponseIds.has(messageId)) {
                forwardBridgeStats.duplicateResponses += 1;
                return 'duplicate';
            }
            forwardBridgeStats.orphanResponses += 1;
            return 'orphan';
        }
        clearTimeout(pending.timeout);
        pendingForwardResponses.delete(messageId);
        rememberCompletedForwardResponseId(messageId);
        forwardBridgeStats.successfulResponses += 1;
        pending.resolve(message);
        return 'resolved';
    };
    const closePendingForwardResponses = (reason: string): void => {
        let rejected = 0;
        for (const [commandId, pending] of pendingForwardResponses.entries()) {
            clearTimeout(pending.timeout);
            pendingForwardResponses.delete(commandId);
            pending.reject(new Error(reason));
            rejected += 1;
        }
        if (rejected > 0) {
            forwardBridgeStats.transportClosedRejects += rejected;
        }
    };
    const forwardCommandAndWaitOnce = (
        type: string,
        payload: Record<string, unknown>,
        emit: (message: OutgoingMessage) => void,
        timeoutMs = policyGateResponseTimeoutMs,
    ): Promise<ProtocolCommand> => {
        if (transportClosed) {
            forwardBridgeStats.transportClosedRejects += 1;
            return Promise.reject(new Error('ipc_transport_closed'));
        }
        const internalCommandId = createId();
        forwardBridgeStats.forwardedRequests += 1;
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingForwardResponses.delete(internalCommandId);
                forwardBridgeStats.timeoutErrors += 1;
                reject(new Error(`IPC response timeout for ${type}`));
            }, timeoutMs);
            pendingForwardResponses.set(internalCommandId, {
                resolve,
                reject,
                timeout,
            });
            try {
                emit({
                    id: internalCommandId,
                    timestamp: getNowIso(),
                    type,
                    payload,
                });
            } catch (error) {
                clearTimeout(timeout);
                pendingForwardResponses.delete(internalCommandId);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    };
    const forwardCommandAndWait = async (
        type: string,
        payload: Record<string, unknown>,
        emit: (message: OutgoingMessage) => void,
        timeoutMs = policyGateResponseTimeoutMs,
    ): Promise<ProtocolCommand> => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= policyGateTimeoutRetryCount; attempt += 1) {
            try {
                return await forwardCommandAndWaitOnce(type, payload, emit, timeoutMs);
            } catch (error) {
                lastError = error;
                const shouldRetry =
                    !transportClosed
                    && attempt < policyGateTimeoutRetryCount
                    && isIpcTimeoutError(error);
                if (!shouldRetry) {
                    throw error;
                }
                forwardBridgeStats.retries += 1;
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    };
    return {
        emitDesktopEventForTask: async (
            taskId: string,
            event: DesktopEvent,
            emit: (message: OutgoingMessage) => void,
        ): Promise<void> => {
            await emitDesktopEvent(taskId, event, emit);
        },
        resolveResourceIdForTask: (taskId: string): string => {
            return taskStates.get(taskId)?.resourceId ?? resolveTaskResourceId(taskId, {});
        },
        close: (reason = 'ipc_transport_closed'): void => {
            transportClosed = true;
            closePendingForwardResponses(reason);
        },
        processMessage: async (
            raw: unknown,
            emit: (message: OutgoingMessage) => void,
        ): Promise<void> => {
            const parsedCommand = toProtocolCommand(raw);
            if (!parsedCommand || !parsedCommand.type) {
                emit({ type: 'error', message: 'invalid_command' });
                return;
            }
            const command = normalizeLegacyApprovalResultCommand(parsedCommand) as ProtocolCommand & { type: string };
            if (command.type.endsWith('_response')) {
                resolvePendingForwardResponse(command);
                return;
            }
            if (await processLegacySimpleCommand(command, emit)) {
                return;
            }
            const commandId = getString(command.id) ?? createId();
            const payload = toRecord(command.payload);
            const emitFor = (type: string, responsePayload: Record<string, unknown>): void => {
                emit(buildResponse(commandId, type, responsePayload, getNowIso));
            };
            const emitCurrent = (responsePayload: Record<string, unknown>): void => {
                emitFor(`${command.type}_response`, responsePayload);
            };
            const emitInvalidPayload = (
                type: string,
                extra: Record<string, unknown> = {},
            ): void => {
                emitFor(type, {
                    success: false,
                    ...extra,
                    error: 'invalid_payload',
                });
            };
            const emitCurrentInvalidPayload = (extra: Record<string, unknown> = {}): void => {
                emitInvalidPayload(`${command.type}_response`, extra);
            };
            const emitTaskStarted = (input: {
                taskId: string;
                title: string;
                message: string;
                workspacePath: string;
                mode: 'chat' | 'immediate_task' | 'scheduled_task';
                scheduled?: boolean;
                turnId?: string;
            }): void => {
                emit({
                    type: 'TASK_STARTED',
                    taskId: input.taskId,
                    payload: {
                        turnId: input.turnId,
                        title: input.title,
                        description: input.message,
                        context: {
                            workspacePath: input.workspacePath,
                            userQuery: input.message,
                            mode: input.mode,
                            ...(input.scheduled ? { scheduled: true } : {}),
                        },
                    },
                });
            };
            const emitTaskSummary = (input: {
                taskId: string;
                summary: string;
                finishReason: string;
                turnId?: string;
            }): void => {
                emit({
                    type: 'TEXT_DELTA',
                    taskId: input.taskId,
                    payload: {
                        delta: input.summary,
                        role: 'assistant',
                        turnId: input.turnId,
                    },
                });
                emit({
                    type: 'TASK_FINISHED',
                    taskId: input.taskId,
                    payload: {
                        summary: input.summary,
                        finishReason: input.finishReason,
                        turnId: input.turnId,
                    },
                });
            };
            const primeTaskTurnCompletionContract = (input: {
                taskId: string;
                turnId: string;
                message: string;
                workspacePath?: string;
                executionOptions?: UserMessageExecutionOptions;
                logContract?: boolean;
            }): {
                turnEventStateKey: string;
                requiredCompletionCapabilities: string[];
                requireToolEvidenceForCompletion: boolean;
            } => {
                const turnEventStateKey = buildTaskTurnEventStateKey({
                    taskId: input.taskId,
                    turnId: input.turnId,
                });
                const requiredCompletionCapabilities = resolveRequiredCompletionCapabilities({
                    message: input.message,
                    workspacePath: input.workspacePath,
                    executionOptions: input.executionOptions,
                });
                const requireToolEvidenceForCompletion = (
                    input.executionOptions?.requireToolEvidenceForCompletion === true
                    || requiredCompletionCapabilities.length > 0
                );
                setTaskTurnCompletionRequirement({
                    key: turnEventStateKey,
                    requireToolEvidence: requireToolEvidenceForCompletion,
                    requiredCompletionCapabilities,
                    turnContractHash: input.executionOptions?.turnContractHash,
                    turnContractDomain: input.executionOptions?.turnContractDomain,
                    routeMode: input.executionOptions?.forcedRouteMode,
                    executionPath: input.executionOptions?.executionPath === 'workflow'
                        ? 'workflow'
                        : 'direct',
                });
                if (input.logContract === true) {
                    console.info('[coworkany-task-turn-contract]', JSON.stringify({
                        taskId: input.taskId,
                        turnId: input.turnId,
                        routeMode: input.executionOptions?.forcedRouteMode ?? null,
                        executionPath: input.executionOptions?.executionPath ?? null,
                        domain: input.executionOptions?.turnContractDomain ?? null,
                        requiredCapabilities: requiredCompletionCapabilities,
                        contractHash: input.executionOptions?.turnContractHash ?? null,
                    }));
                }
                return {
                    turnEventStateKey,
                    requiredCompletionCapabilities,
                    requireToolEvidenceForCompletion,
                };
            };
            const runUserMessageWithThreadRecovery = async (input: {
                taskId: string;
                turnId: string;
                message: string;
                resourceId: string;
                preferredThreadId: string;
                workspacePath?: string;
                executionOptions?: UserMessageExecutionOptions;
            }): Promise<void> => {
                const isToolingProgressEvent = (event: DesktopEvent): boolean => (
                    event.type === 'tool_call'
                    || event.type === 'approval_required'
                    || event.type === 'tool_result'
                    || event.type === 'suspended'
                );
                const {
                    turnEventStateKey,
                    requiredCompletionCapabilities,
                } = primeTaskTurnCompletionContract({
                    taskId: input.taskId,
                    turnId: input.turnId,
                    message: input.message,
                    workspacePath: input.workspacePath,
                    executionOptions: input.executionOptions,
                });
                const useChatLatencyProfile = input.executionOptions?.forcePostAssistantCompletion === true
                    && input.executionOptions?.forcedRouteMode !== 'task';
                const useTaskLatencyProfile = input.executionOptions?.forcedRouteMode === 'task'
                    && input.executionOptions?.executionPath !== 'workflow';
                const sharedExecutionDeadlineOptions: Pick<
                    UserMessageExecutionOptions,
                    'chatTurnDeadlineAtMs' | 'chatStartupDeadlineAtMs'
                > = {};
                if (useChatLatencyProfile || useTaskLatencyProfile) {
                    const now = Date.now();
                    const configuredTurnDeadlineAtMs = getOptionalFiniteNumber(input.executionOptions?.chatTurnDeadlineAtMs);
                    const configuredStartupDeadlineAtMs = getOptionalFiniteNumber(input.executionOptions?.chatStartupDeadlineAtMs);
                    const isCommandOnlyTask = (
                        useTaskLatencyProfile
                        && requiredCompletionCapabilities.length === 1
                        && requiredCompletionCapabilities[0] === COMMAND_EXECUTION_CAPABILITY
                    );
                    const defaultTurnTimeoutMs = useTaskLatencyProfile
                        ? (
                            isCommandOnlyTask
                                ? Math.min(resolveTaskTurnTimeoutMs(), resolveCommandOnlyTaskTurnTimeoutMs())
                                : resolveTaskTurnTimeoutMs()
                        )
                        : resolveChatTurnTimeoutMs();
                    const defaultStartupBudgetMs = useTaskLatencyProfile
                        ? resolveTaskStartupBudgetMs()
                        : resolveChatStartupBudgetMs();
                    const turnDeadlineAtMs = configuredTurnDeadlineAtMs
                        ?? (now + defaultTurnTimeoutMs);
                    const startupDeadlineAtMs = Math.min(
                        configuredStartupDeadlineAtMs ?? (now + defaultStartupBudgetMs),
                        turnDeadlineAtMs,
                    );
                    sharedExecutionDeadlineOptions.chatTurnDeadlineAtMs = turnDeadlineAtMs;
                    sharedExecutionDeadlineOptions.chatStartupDeadlineAtMs = startupDeadlineAtMs;
                }
                const isAssistantNarrativeEvent = (event: DesktopEvent): boolean => (
                    event.type === 'text_delta'
                    && event.role !== 'thinking'
                    && typeof event.content === 'string'
                    && event.content.trim().length > 0
                );
                const emitFalseCompletionFailure = (event: Extract<DesktopEvent, { type: 'complete' }>): void => {
                    if (hasPendingApprovalForTask(input.taskId)) {
                        return;
                    }
                    if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'error')) {
                        return;
                    }
                    markTaskTurnTerminalEvent(turnEventStateKey, 'error');
                    clearPendingApprovalsForTask(input.taskId);
                    const existingRetry = taskStates.get(input.taskId)?.retry;
                    upsertTaskState(input.taskId, {
                        status: 'failed',
                        suspended: false,
                        suspensionReason: undefined,
                        checkpoint: undefined,
                        retry: existingRetry
                            ? {
                                ...existingRetry,
                                lastError: 'false_completion_no_assistant_narrative',
                            }
                            : undefined,
                    });
                    emitHookEvent('TaskFailed', {
                        taskId: input.taskId,
                        runId: event.runId,
                        payload: {
                            message: 'Mastra completed without assistant narrative.',
                            errorCode: 'E_PROTOCOL_FALSE_COMPLETION',
                            finishReason: event.finishReason ?? 'stop',
                        },
                    });
                    emit({
                        type: 'TASK_FAILED',
                        taskId: input.taskId,
                        payload: {
                            error: 'Mastra completed without assistant narrative.',
                            errorCode: 'E_PROTOCOL_FALSE_COMPLETION',
                            recoverable: false,
                            suggestion: 'Retry the chat turn only after assistant text is emitted before terminal completion.',
                            finishReason: event.finishReason ?? 'stop',
                            turnId: input.turnId,
                        },
                    });
                };
                const emitMissingTerminalFailure = async (reason: string): Promise<void> => {
                    if (hasPendingApprovalForTask(input.taskId)) {
                        return;
                    }
                    if (tryScheduleCommandFailureStepRetry(latestRunIdByTaskId.get(input.taskId))) {
                        return;
                    }
                    const requiredCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
                    const missingCapabilities = getTaskTurnMissingRequiredCompletionCapabilities(turnEventStateKey);
                    if (
                        runMissingToolEvidenceAutoRetry
                        && missingCapabilities.length > 0
                        && runMissingToolEvidenceAutoRetry({
                            taskId: input.taskId,
                            turnEventStateKey,
                            turnId: input.turnId,
                            traceId: null,
                            requiredCapabilities: missingCapabilities,
                            source: 'error',
                            runId: latestRunIdByTaskId.get(input.taskId),
                        })
                    ) {
                        return;
                    }
                    if (requiredCapabilities.length === 0 || missingCapabilities.length === 0) {
                        if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'complete')) {
                            return;
                        }
                        const finishReason = `degraded_${reason}`;
                        const degradedSummary = buildMissingTerminalRecoverySummary({
                            evidenceSatisfied: missingCapabilities.length === 0,
                        });
                        markTaskTurnTerminalEvent(turnEventStateKey, 'complete');
                        appendTranscript(input.taskId, 'assistant', degradedSummary);
                        clearPendingApprovalsForTask(input.taskId);
                        const existingRetry = taskStates.get(input.taskId)?.retry;
                        upsertTaskState(input.taskId, {
                            status: 'finished',
                            suspended: false,
                            suspensionReason: undefined,
                            checkpoint: undefined,
                            retry: existingRetry
                                ? {
                                    ...existingRetry,
                                    lastError: undefined,
                                }
                                : undefined,
                        });
                        emitHookEvent('TaskCompleted', {
                            taskId: input.taskId,
                            payload: {
                                finishReason,
                                reason,
                                degraded: true,
                            },
                        });
                        emit({
                            type: 'TEXT_DELTA',
                            taskId: input.taskId,
                            payload: {
                                delta: degradedSummary,
                                turnId: input.turnId,
                            },
                        });
                        emit({
                            type: 'TASK_FINISHED',
                            taskId: input.taskId,
                            payload: {
                                summary: degradedSummary,
                                finishReason,
                                reason,
                                traceId: null,
                                turnId: input.turnId,
                            },
                        });
                        return;
                    }
                    if (shouldSuppressTaskTurnTerminalEvent(turnEventStateKey, 'error')) {
                        return;
                    }
                    markTaskTurnTerminalEvent(turnEventStateKey, 'error');
                    clearPendingApprovalsForTask(input.taskId);
                    const existingRetry = taskStates.get(input.taskId)?.retry;
                    upsertTaskState(input.taskId, {
                        status: 'failed',
                        suspended: false,
                        suspensionReason: undefined,
                        checkpoint: undefined,
                        retry: existingRetry
                            ? {
                                ...existingRetry,
                                lastError: reason,
                            }
                            : undefined,
                    });
                    emitHookEvent('TaskFailed', {
                        taskId: input.taskId,
                        payload: {
                            message: 'Mastra stream ended without a terminal completion event.',
                            errorCode: 'E_PROTOCOL_MISSING_TERMINAL_EVENT',
                            reason,
                        },
                    });
                    emit({
                        type: 'TASK_FAILED',
                        taskId: input.taskId,
                        payload: {
                            error: 'Mastra stream ended without a terminal completion event.',
                            errorCode: 'E_PROTOCOL_MISSING_TERMINAL_EVENT',
                            recoverable: true,
                            suggestion: 'Retry this turn. If it repeats, lower delegation complexity or disable guardrails.',
                            reason,
                            turnId: input.turnId,
                        },
                    });
                };
                const hasAutoApprovalInFlightForTask = (): boolean => (
                    (autoApprovalInFlightByTaskId.get(input.taskId)?.size ?? 0) > 0
                );
                const executeAttempt = async (
                    threadId: string,
                    onEvent: (event: DesktopEvent) => void,
                    executionOptionOverrides?: Partial<UserMessageExecutionOptions>,
                ): Promise<void> => {
                    const attemptResult = await deps.handleUserMessage(
                        input.message,
                        threadId,
                        input.resourceId,
                        onEvent,
                        {
                            ...input.executionOptions,
                            ...executionOptionOverrides,
                            ...sharedExecutionDeadlineOptions,
                            taskId: input.taskId,
                            turnId: input.turnId,
                            workspacePath: input.workspacePath,
                            onPreCompact: (compactPayload) => {
                                emitHookEvent('PreCompact', {
                                    taskId: input.taskId,
                                    payload: {
                                        threadId: compactPayload.threadId,
                                        resourceId: compactPayload.resourceId,
                                        workspacePath: compactPayload.workspacePath,
                                        microSummary: compactPayload.microSummary,
                                        structuredSummary: compactPayload.structuredSummary,
                                        recalledMemoryFiles: compactPayload.recalledMemoryFiles,
                                    },
                                });
                            },
                            onPostCompact: (compactPayload) => {
                                emitHookEvent('PostCompact', {
                                    taskId: input.taskId,
                                    payload: {
                                        threadId: compactPayload.threadId,
                                        resourceId: compactPayload.resourceId,
                                        workspacePath: compactPayload.workspacePath,
                                        microSummary: compactPayload.microSummary,
                                        structuredSummary: compactPayload.structuredSummary,
                                        recalledMemoryFiles: compactPayload.recalledMemoryFiles,
                                    },
                                });
                            },
                        },
                    );
                    const attemptRunId = typeof attemptResult?.runId === 'string'
                        ? attemptResult.runId.trim()
                        : '';
                    if (attemptRunId.length > 0) {
                        latestRunIdByTaskId.set(input.taskId, attemptRunId);
                    }
                };

                let hasRecoverableHistoryError = false;
                let hasToolingProgress = false;
                let hasAssistantNarrative = false;
                let recoveredStoreHistoryErrorAfterNarrative = false;
                let suppressRecoverableAttempt = false;
                let noNarrativeTerminalFailure = false;
                let pendingNoNarrativeCompleteEvent: Extract<DesktopEvent, { type: 'complete' }> | null = null;
                let pendingNoNarrativeCompleteHadProgress = false;
                let awaitingUserApproval = false;
                let sawAutoApprovalRequired = false;
                let sawRetryableNoNarrativeErrorDuringAutoApproval = false;
                let sawRetryableNoNarrativeErrorAfterToolingProgress = false;
                let autoApprovalRecoveryAttempted = false;
                let autoApprovalIdleTerminalTimeoutReached = false;
                const suppressedRecoverableEvents: DesktopEvent[] = [];

                let pendingEmitChain: Promise<void> = Promise.resolve();
                let pendingEmitError: unknown;
                const hasToolingEvidenceForTurn = (): boolean => (
                    hasToolingProgress
                    || getTaskTurnObservedToolNames(turnEventStateKey).length > 0
                );
                const tryScheduleCommandFailureStepRetry = (runId?: string): boolean => {
                    if (!runMissingToolEvidenceAutoRetry) {
                        return false;
                    }
                    const commandFailureInfo = getTaskTurnCommandFailureInfo(turnEventStateKey, input.taskId);
                    if (!commandFailureInfo) {
                        return false;
                    }
                    const requiredCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
                    return runMissingToolEvidenceAutoRetry({
                        taskId: input.taskId,
                        turnEventStateKey,
                        turnId: input.turnId,
                        traceId: null,
                        requiredCapabilities: requiredCapabilities.length > 0
                            ? requiredCapabilities
                            : [COMMAND_EXECUTION_CAPABILITY],
                        source: 'error',
                        runId,
                    });
                };
                const enqueueEmitDesktopEvent = (event: DesktopEvent): void => {
                    pendingEmitChain = pendingEmitChain
                        .then(async () => {
                            await emitDesktopEvent(input.taskId, event, emit, input.turnId);
                        })
                        .catch((error) => {
                            pendingEmitError = pendingEmitError ?? error;
                        });
                };
                const lateApprovalGraceMs = resolveLateApprovalGraceMs();
                const requiredCompletionCapabilitiesForTurn = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey)
                    .map((value) => value.toLowerCase());
                const isWebResearchTurn = requiredCompletionCapabilitiesForTurn.includes(WEB_RESEARCH_CAPABILITY);
                const rawTaskProgressIdleTerminalMs = isWebResearchTurn
                    ? TASK_PROGRESS_IDLE_TERMINAL_WEB_MS
                    : TASK_PROGRESS_IDLE_TERMINAL_NON_WEB_MS;
                const isTestRuntime = process.env.NODE_ENV === 'test'
                    || process.env.BUN_ENV === 'test'
                    || process.env.BUN_TEST === '1';
                const taskProgressIdleTerminalMs = isTestRuntime
                    ? Math.min(rawTaskProgressIdleTerminalMs, 1_500)
                    : rawTaskProgressIdleTerminalMs;
                const waitForAutoApprovalInFlightToSettle = async (): Promise<void> => {
                    if (!hasAutoApprovalInFlightForTask() || lateApprovalGraceMs <= 0) {
                        return;
                    }
                    const settleDeadlineAt = Date.now() + lateApprovalGraceMs;
                    while (hasAutoApprovalInFlightForTask() && Date.now() < settleDeadlineAt) {
                        await new Promise<void>((resolve) => {
                            setTimeout(resolve, LATE_APPROVAL_POLL_INTERVAL_MS);
                        });
                        await pendingEmitChain;
                        if (pendingEmitError) {
                            throw pendingEmitError;
                        }
                        if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                            return;
                        }
                    }
                };
                const waitForAutoApprovalIdleTerminalWatchdog = async (): Promise<void> => {
                    if (!hasAutoApprovalInFlightForTask() || taskProgressIdleTerminalMs <= 0) {
                        return;
                    }
                    const deadlineAt = Date.now() + taskProgressIdleTerminalMs;
                    while (
                        hasAutoApprovalInFlightForTask()
                        && !hasTaskTurnTerminalEvent(turnEventStateKey)
                        && !hasTaskTurnAssistantNarrative(turnEventStateKey)
                        && Date.now() < deadlineAt
                    ) {
                        await new Promise<void>((resolve) => {
                            setTimeout(resolve, LATE_APPROVAL_POLL_INTERVAL_MS);
                        });
                        await pendingEmitChain;
                        if (pendingEmitError) {
                            throw pendingEmitError;
                        }
                    }
                    autoApprovalIdleTerminalTimeoutReached = (
                        hasAutoApprovalInFlightForTask()
                        && !hasTaskTurnTerminalEvent(turnEventStateKey)
                        && !hasTaskTurnAssistantNarrative(turnEventStateKey)
                    );
                };
                const attemptAutoApprovalNoNarrativeRecovery = async (): Promise<boolean> => {
                    if (autoApprovalRecoveryAttempted) {
                        return false;
                    }
                    autoApprovalRecoveryAttempted = true;
                    const recoveryForcedRouteMode: 'chat' | 'task' = (
                        input.executionOptions?.forcedRouteMode === 'task'
                    )
                        ? 'task'
                        : 'chat';
                    const recoveryThreadId = `${input.taskId}-auto-approval-recovery-${createId()}`;
                    upsertTaskState(input.taskId, {
                        conversationThreadId: recoveryThreadId,
                    });
                    pendingEmitChain = Promise.resolve();
                    pendingEmitError = undefined;
                    await executeAttempt(
                        recoveryThreadId,
                        (event) => {
                            enqueueEmitDesktopEvent(event);
                        },
                        {
                            forcedRouteMode: recoveryForcedRouteMode,
                            useDirectChatResponder: recoveryForcedRouteMode === 'chat'
                                ? true
                                : undefined,
                            requireToolApproval: false,
                            autoResumeSuspendedTools: true,
                            forcePostAssistantCompletion: true,
                            maxSteps: Math.max(4, Math.min(input.executionOptions?.maxSteps ?? 8, 8)),
                        },
                    );
                    await pendingEmitChain;
                    if (pendingEmitError) {
                        throw pendingEmitError;
                    }
                    return hasTaskTurnTerminalEvent(turnEventStateKey);
                };
                const emitNoNarrativeDegradedCompletion = async (reason: string): Promise<void> => {
                    if (hasPendingApprovalForTask(input.taskId)) {
                        return;
                    }
                    if (tryScheduleCommandFailureStepRetry(latestRunIdByTaskId.get(input.taskId))) {
                        return;
                    }
                    const clippedOriginalRequest = input.message.trim().slice(0, 2400);
                    const commandFailureInfo = getTaskTurnCommandFailureInfo(turnEventStateKey, input.taskId);
                    const degradedLines = [
                        '上游检索流在输出正文前中断，暂未产出完整分析结果。',
                        '为避免界面继续卡住，我先结束本轮；你可以直接点击重试，或把请求拆成单标的重试。',
                        `原始请求：${clippedOriginalRequest}`,
                    ];
                    if (commandFailureInfo) {
                        degradedLines.push('检测到失败步骤：命令执行阶段报错。');
                        if (commandFailureInfo.failedCommand) {
                            degradedLines.push(`失败命令：${commandFailureInfo.failedCommand}`);
                        }
                        if (typeof commandFailureInfo.exitCode === 'number') {
                            degradedLines.push(`退出码：${commandFailureInfo.exitCode}`);
                        }
                        if (commandFailureInfo.stderrSnippet) {
                            degradedLines.push(`错误信息：${commandFailureInfo.stderrSnippet}`);
                        }
                        degradedLines.push('建议：仅重试当前失败步骤（无需重跑整个任务）。');
                    }
                    const degradedSummary = degradedLines.join('\n');
                    const syntheticRunId = `synthetic-degraded-${createId()}`;
                    enqueueEmitDesktopEvent({
                        type: 'text_delta',
                        runId: syntheticRunId,
                        role: 'assistant',
                        content: degradedSummary,
                        turnId: input.turnId,
                    });
                    enqueueEmitDesktopEvent({
                        type: 'complete',
                        runId: syntheticRunId,
                        finishReason: `degraded_${reason}`,
                        turnId: input.turnId,
                    });
                    await pendingEmitChain;
                    if (pendingEmitError) {
                        throw pendingEmitError;
                    }
                };
                latestRunIdByTaskId.delete(input.taskId);
                autoApprovalInFlightByTaskId.delete(input.taskId);
                autoApprovalCompletedByTaskId.delete(input.taskId);
                let taskExecutionHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
                const stopTaskExecutionHeartbeat = (): void => {
                    if (taskExecutionHeartbeatTimer) {
                        clearInterval(taskExecutionHeartbeatTimer);
                        taskExecutionHeartbeatTimer = null;
                    }
                };
                const startTaskExecutionHeartbeat = (): void => {
                    if (TASK_EXECUTION_HEARTBEAT_INTERVAL_MS <= 0) {
                        return;
                    }
                    stopTaskExecutionHeartbeat();
                    taskExecutionHeartbeatTimer = setInterval(() => {
                        if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                            stopTaskExecutionHeartbeat();
                            return;
                        }
                        emit({
                            type: 'TASK_EVENT',
                            taskId: input.taskId,
                            payload: {
                                type: 'heartbeat',
                                turnId: input.turnId,
                                at: getNowIso(),
                            },
                        });
                    }, TASK_EXECUTION_HEARTBEAT_INTERVAL_MS);
                };
                startTaskExecutionHeartbeat();

                try {
                    await executeAttempt(input.preferredThreadId, (event) => {
                        if (noNarrativeTerminalFailure) {
                            return;
                        }
                        const lateNonTerminalAfterZeroProgressCompletion = (
                            pendingNoNarrativeCompleteEvent
                            && !pendingNoNarrativeCompleteHadProgress
                            && event.type !== 'complete'
                        );
                        if (lateNonTerminalAfterZeroProgressCompletion && !isToolingProgressEvent(event)) {
                            // Keep ignoring stale low-signal events, but allow tooling progress
                            // to recover from complete-before-approval races.
                            return;
                        }
                        if (isToolingProgressEvent(event)) {
                            hasToolingProgress = true;
                            if (pendingNoNarrativeCompleteEvent) {
                                pendingNoNarrativeCompleteHadProgress = true;
                            }
                        }
                        if (isAssistantNarrativeEvent(event)) {
                            hasAssistantNarrative = true;
                        }
                        if (event.type === 'approval_required') {
                            const requiredCompletionCapabilities = getTaskTurnRequiredCompletionCapabilities(turnEventStateKey);
                            const autoApproval = shouldAutoApproveTool({
                                event,
                                requiredCompletionCapabilities,
                            });
                            // Both manual approval and auto-approval require waiting for a resume stream.
                            // The initial stream can legitimately end with stream_exhausted before narrative.
                            if (autoApproval) {
                                sawAutoApprovalRequired = true;
                            } else {
                                awaitingUserApproval = true;
                            }
                            if (pendingNoNarrativeCompleteEvent && pendingNoNarrativeCompleteHadProgress) {
                                const pendingFinishReason = String(pendingNoNarrativeCompleteEvent.finishReason ?? '')
                                    .trim()
                                    .toLowerCase();
                                if (pendingFinishReason === 'stream_exhausted') {
                                    // Late approval events can arrive after an early stream_exhausted marker.
                                    // Treat that marker as provisional and cancel false-completion escalation.
                                    pendingNoNarrativeCompleteEvent = null;
                                    pendingNoNarrativeCompleteHadProgress = false;
                                }
                            }
                        }
                        if (event.type === 'error' && isRetryableRuntimeStreamError(event.message)) {
                            const hasRecoverableStreamProgress = (
                                hasToolingEvidenceForTurn()
                                || (!hasAssistantNarrative && (sawAutoApprovalRequired || hasAutoApprovalInFlightForTask()))
                            );
                            if (!hasRecoverableStreamProgress) {
                                enqueueEmitDesktopEvent(event);
                                return;
                            }
                            if (hasToolingEvidenceForTurn()) {
                                sawRetryableNoNarrativeErrorAfterToolingProgress = true;
                            }
                            if (!hasAssistantNarrative && (sawAutoApprovalRequired || hasAutoApprovalInFlightForTask())) {
                                sawRetryableNoNarrativeErrorDuringAutoApproval = true;
                            }
                            // Retryable stream errors are recoverable. Suppress immediate terminal failure
                            // and let post-attempt recovery synthesize completion/retry decisions.
                            return;
                        }
                        if (
                            hasAssistantNarrative
                            && event.type === 'error'
                            && isStoreDisabledHistoryReferenceError(event.message)
                        ) {
                            recoveredStoreHistoryErrorAfterNarrative = true;
                            enqueueEmitDesktopEvent({
                                type: 'complete',
                                runId: event.runId,
                                finishReason: 'assistant_text_store_disabled_history_recovered',
                            });
                            return;
                        }
                        if (
                            recoveredStoreHistoryErrorAfterNarrative
                            && (event.type === 'error' || event.type === 'complete')
                        ) {
                            return;
                        }
                        if (suppressRecoverableAttempt && !hasAssistantNarrative) {
                            suppressedRecoverableEvents.push(event);
                            return;
                        }
                        if (suppressRecoverableAttempt && hasAssistantNarrative) {
                            suppressRecoverableAttempt = false;
                            for (const suppressedEvent of suppressedRecoverableEvents) {
                                enqueueEmitDesktopEvent(suppressedEvent);
                            }
                            suppressedRecoverableEvents.length = 0;
                        }
                        if (
                            !hasAssistantNarrative
                            && event.type === 'error'
                            && isStoreDisabledHistoryReferenceError(event.message)
                        ) {
                            hasRecoverableHistoryError = true;
                            suppressRecoverableAttempt = true;
                            suppressedRecoverableEvents.push(event);
                            return;
                        }
                        if (!hasAssistantNarrative && event.type === 'complete') {
                            if (awaitingUserApproval) {
                                // Completion before approval can be provisional regardless of finish reason.
                                // Wait for report_effect_result / resume before deciding terminal outcome.
                                pendingNoNarrativeCompleteEvent = event;
                                pendingNoNarrativeCompleteHadProgress = hasToolingProgress;
                                return;
                            }
                            pendingNoNarrativeCompleteEvent = event;
                            pendingNoNarrativeCompleteHadProgress = hasToolingProgress;
                            return;
                        }
                        enqueueEmitDesktopEvent(event);
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const retryableStreamError = isRetryableRuntimeStreamError(message);
                    const hasRecoverableToolingProgress = (
                        !hasAssistantNarrative
                        && hasToolingEvidenceForTurn()
                    );
                    const hasRecoverableAutoApprovalProgress = (
                        !hasAssistantNarrative
                        && (sawAutoApprovalRequired || hasAutoApprovalInFlightForTask())
                    );
                    if (!retryableStreamError || (!hasRecoverableToolingProgress && !hasRecoverableAutoApprovalProgress)) {
                        throw error;
                    }
                    if (hasRecoverableToolingProgress) {
                        sawRetryableNoNarrativeErrorAfterToolingProgress = true;
                    }
                    if (hasRecoverableAutoApprovalProgress) {
                        sawRetryableNoNarrativeErrorDuringAutoApproval = true;
                    }
                } finally {
                    stopTaskExecutionHeartbeat();
                }
                await pendingEmitChain;
                if (pendingEmitError) {
                    throw pendingEmitError;
                }
                if (
                    pendingNoNarrativeCompleteEvent
                    && hasTaskTurnTerminalEvent(turnEventStateKey)
                ) {
                    pendingNoNarrativeCompleteEvent = null;
                    pendingNoNarrativeCompleteHadProgress = false;
                }
                if (
                    pendingNoNarrativeCompleteEvent
                    && !hasAssistantNarrative
                    && pendingNoNarrativeCompleteHadProgress
                    && !(awaitingUserApproval && hasPendingApprovalForTask(input.taskId))
                    && !hasTaskTurnTerminalEvent(turnEventStateKey)
                    && lateApprovalGraceMs > 0
                ) {
                    const graceDeadlineAt = Date.now() + lateApprovalGraceMs;
                    while (pendingNoNarrativeCompleteEvent && !hasAssistantNarrative && Date.now() < graceDeadlineAt) {
                        await new Promise<void>((resolve) => {
                            setTimeout(resolve, LATE_APPROVAL_POLL_INTERVAL_MS);
                        });
                        await pendingEmitChain;
                        if (pendingEmitError) {
                            throw pendingEmitError;
                        }
                        if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                            pendingNoNarrativeCompleteEvent = null;
                            pendingNoNarrativeCompleteHadProgress = false;
                            break;
                        }
                    }
                }
                if (pendingNoNarrativeCompleteEvent && !hasAssistantNarrative) {
                    if (awaitingUserApproval && hasPendingApprovalForTask(input.taskId)) {
                        return;
                    }
                    if (sawAutoApprovalRequired && !awaitingUserApproval && hasAutoApprovalInFlightForTask()) {
                        await waitForAutoApprovalInFlightToSettle();
                        if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                            return;
                        }
                        if (hasTaskTurnAssistantNarrative(turnEventStateKey)) {
                            hasAssistantNarrative = true;
                            pendingNoNarrativeCompleteEvent = null;
                            pendingNoNarrativeCompleteHadProgress = false;
                        } else if (hasAutoApprovalInFlightForTask()) {
                            autoApprovalInFlightByTaskId.delete(input.taskId);
                            if (await attemptAutoApprovalNoNarrativeRecovery()) {
                                pendingNoNarrativeCompleteEvent = null;
                                pendingNoNarrativeCompleteHadProgress = false;
                                return;
                            }
                            await emitNoNarrativeDegradedCompletion('auto_approval_resume_stalled_without_terminal_event');
                            pendingNoNarrativeCompleteEvent = null;
                            pendingNoNarrativeCompleteHadProgress = false;
                            return;
                        }
                    }
                    if (pendingNoNarrativeCompleteHadProgress) {
                        if (sawRetryableNoNarrativeErrorAfterToolingProgress) {
                            if (tryScheduleCommandFailureStepRetry(latestRunIdByTaskId.get(input.taskId))) {
                                pendingNoNarrativeCompleteEvent = null;
                                pendingNoNarrativeCompleteHadProgress = false;
                                return;
                            }
                            await emitNoNarrativeDegradedCompletion('missing_terminal_after_late_tooling_progress');
                            pendingNoNarrativeCompleteEvent = null;
                            pendingNoNarrativeCompleteHadProgress = false;
                            return;
                        }
                        await emitMissingTerminalFailure('missing_terminal_after_late_tooling_progress');
                        pendingNoNarrativeCompleteEvent = null;
                        pendingNoNarrativeCompleteHadProgress = false;
                        return;
                    }
                    const noNarrativeCompleteEvent = pendingNoNarrativeCompleteEvent;
                    if (!noNarrativeCompleteEvent) {
                        return;
                    }
                    noNarrativeTerminalFailure = true;
                    emitFalseCompletionFailure(noNarrativeCompleteEvent);
                    pendingNoNarrativeCompleteEvent = null;
                    pendingNoNarrativeCompleteHadProgress = false;
                    return;
                }

                if (hasRecoverableHistoryError && !hasAssistantNarrative) {
                    const recoveryThreadId = `${input.taskId}-recovery-${createId()}`;
                    upsertTaskState(input.taskId, {
                        conversationThreadId: recoveryThreadId,
                    });
                    pendingEmitChain = Promise.resolve();
                    pendingEmitError = undefined;
                    await executeAttempt(recoveryThreadId, (event) => {
                        enqueueEmitDesktopEvent(event);
                    });
                    await pendingEmitChain;
                    if (pendingEmitError) {
                        throw pendingEmitError;
                    }
                    return;
                }

                if (suppressedRecoverableEvents.length > 0) {
                    for (const event of suppressedRecoverableEvents) {
                        enqueueEmitDesktopEvent(event);
                    }
                    await pendingEmitChain;
                    if (pendingEmitError) {
                        throw pendingEmitError;
                    }
                }
                const hasTerminalEvent = hasTaskTurnTerminalEvent(turnEventStateKey);
                const assistantNarrativeSeen = hasAssistantNarrative || hasTaskTurnAssistantNarrative(turnEventStateKey);
                const hasPendingApproval = hasPendingApprovalForTask(input.taskId);
                if (!hasTerminalEvent && assistantNarrativeSeen && !(awaitingUserApproval && hasPendingApproval)) {
                    enqueueEmitDesktopEvent({
                        type: 'complete',
                        runId: `synthetic-complete-${createId()}`,
                        finishReason: 'synthetic_terminal_after_assistant_text',
                        turnId: input.turnId,
                    });
                    await pendingEmitChain;
                    if (pendingEmitError) {
                        throw pendingEmitError;
                    }
                    return;
                }
                if (!hasTerminalEvent && !assistantNarrativeSeen && hasToolingEvidenceForTurn() && !(awaitingUserApproval && hasPendingApproval)) {
                    if (sawAutoApprovalRequired && !awaitingUserApproval) {
                        if (hasAutoApprovalInFlightForTask()) {
                            if (!sawRetryableNoNarrativeErrorDuringAutoApproval) {
                                await waitForAutoApprovalIdleTerminalWatchdog();
                                if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                                    return;
                                }
                                if (hasTaskTurnAssistantNarrative(turnEventStateKey)) {
                                    enqueueEmitDesktopEvent({
                                        type: 'complete',
                                        runId: `synthetic-complete-${createId()}`,
                                        finishReason: 'synthetic_terminal_after_assistant_text',
                                        turnId: input.turnId,
                                    });
                                    await pendingEmitChain;
                                    if (pendingEmitError) {
                                        throw pendingEmitError;
                                    }
                                    return;
                                }
                                if (!autoApprovalIdleTerminalTimeoutReached) {
                                    return;
                                }
                                autoApprovalInFlightByTaskId.delete(input.taskId);
                                if (await attemptAutoApprovalNoNarrativeRecovery()) {
                                    return;
                                }
                                await emitNoNarrativeDegradedCompletion('auto_approval_idle_timeout_without_terminal_event');
                                return;
                            }
                            await waitForAutoApprovalInFlightToSettle();
                            if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                                return;
                            }
                            if (hasTaskTurnAssistantNarrative(turnEventStateKey)) {
                                enqueueEmitDesktopEvent({
                                    type: 'complete',
                                    runId: `synthetic-complete-${createId()}`,
                                    finishReason: 'synthetic_terminal_after_assistant_text',
                                    turnId: input.turnId,
                                });
                                await pendingEmitChain;
                                if (pendingEmitError) {
                                    throw pendingEmitError;
                                }
                                return;
                            }
                            if (hasAutoApprovalInFlightForTask()) {
                                autoApprovalInFlightByTaskId.delete(input.taskId);
                                if (await attemptAutoApprovalNoNarrativeRecovery()) {
                                    return;
                                }
                                await emitNoNarrativeDegradedCompletion('auto_approval_resume_stalled_without_terminal_event');
                                return;
                            }
                        }
                        if (await attemptAutoApprovalNoNarrativeRecovery()) {
                            return;
                        }
                        await emitNoNarrativeDegradedCompletion('missing_terminal_after_auto_approval_resume');
                        return;
                    }
                    if (hasAutoApprovalInFlightForTask()) {
                        if (sawRetryableNoNarrativeErrorDuringAutoApproval) {
                            await waitForAutoApprovalInFlightToSettle();
                            if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                                return;
                            }
                            if (hasTaskTurnAssistantNarrative(turnEventStateKey)) {
                                enqueueEmitDesktopEvent({
                                    type: 'complete',
                                    runId: `synthetic-complete-${createId()}`,
                                    finishReason: 'synthetic_terminal_after_assistant_text',
                                    turnId: input.turnId,
                                });
                                await pendingEmitChain;
                                if (pendingEmitError) {
                                    throw pendingEmitError;
                                }
                                return;
                            }
                            if (hasAutoApprovalInFlightForTask()) {
                                autoApprovalInFlightByTaskId.delete(input.taskId);
                                if (await attemptAutoApprovalNoNarrativeRecovery()) {
                                    return;
                                }
                                await emitNoNarrativeDegradedCompletion('auto_approval_resume_stalled_without_terminal_event');
                                return;
                            }
                            await emitMissingTerminalFailure('missing_terminal_after_tooling_progress');
                            return;
                        }
                        await waitForAutoApprovalIdleTerminalWatchdog();
                        if (hasTaskTurnTerminalEvent(turnEventStateKey)) {
                            return;
                        }
                        if (hasTaskTurnAssistantNarrative(turnEventStateKey)) {
                            enqueueEmitDesktopEvent({
                                type: 'complete',
                                runId: `synthetic-complete-${createId()}`,
                                finishReason: 'synthetic_terminal_after_assistant_text',
                                turnId: input.turnId,
                            });
                            await pendingEmitChain;
                            if (pendingEmitError) {
                                throw pendingEmitError;
                            }
                            return;
                        }
                        if (!autoApprovalIdleTerminalTimeoutReached) {
                            return;
                        }
                        autoApprovalInFlightByTaskId.delete(input.taskId);
                        if (await attemptAutoApprovalNoNarrativeRecovery()) {
                            return;
                        }
                        await emitNoNarrativeDegradedCompletion('auto_approval_idle_timeout_without_terminal_event');
                        return;
                    }
                    if (sawRetryableNoNarrativeErrorAfterToolingProgress) {
                        if (tryScheduleCommandFailureStepRetry(latestRunIdByTaskId.get(input.taskId))) {
                            return;
                        }
                        await emitNoNarrativeDegradedCompletion('missing_terminal_after_tooling_progress');
                        return;
                    }
                    await emitMissingTerminalFailure('missing_terminal_after_tooling_progress');
                    return;
                }
            };
            const executeTaskMessage = async (input: {
                taskId: string;
                turnId: string;
                message: string;
                resourceId: string;
                preferredThreadId: string;
                workspacePath?: string;
                executionOptions?: UserMessageExecutionOptions;
            }): Promise<TaskRuntimeExecutionPath> => {
                primeTaskTurnCompletionContract({
                    taskId: input.taskId,
                    turnId: input.turnId,
                    message: input.message,
                    workspacePath: input.workspacePath,
                    executionOptions: input.executionOptions,
                    logContract: true,
                });
                const shouldFailUnsupportedDatabaseRequest = DATABASE_OPERATION_PATTERN.test(input.message);
                if (shouldFailUnsupportedDatabaseRequest) {
                    await emitDesktopEvent(input.taskId, {
                        type: 'error',
                        runId: `db-preflight-${createId()}`,
                        message: 'database_access_unavailable: remote/private-network database access is not available in this runtime.',
                        turnId: input.turnId,
                    }, emit, input.turnId);
                    return input.executionOptions?.executionPath === 'workflow'
                        ? 'workflow'
                        : 'direct';
                }
                const shouldRequestHostControlPreflight = (
                    input.executionOptions?.forcedRouteMode === 'task'
                    || input.executionOptions?.executionPath === 'direct'
                ) && HOST_CONTROL_APPROVAL_PATTERN.test(input.message);
                if (shouldRequestHostControlPreflight) {
                    const requestId = createId();
                    const command = deriveHostControlShellCommand(input.message);
                    const requestPayload = {
                        request: {
                            id: requestId,
                            timestamp: getNowIso(),
                            effectType: 'shell:write',
                            source: 'agent',
                            payload: {
                                description: `Host control command approval required: ${command}`,
                                command,
                            },
                            context: {
                                taskId: input.taskId,
                                toolName: 'run_command',
                            },
                        },
                        requiresUserConfirmation: true,
                        riskLevel: 9,
                        toolName: 'run_command',
                    };
                    emitHookEvent('PermissionRequest', {
                        taskId: input.taskId,
                        payload: {
                            requestId,
                            toolName: 'run_command',
                            command,
                            preflight: true,
                        },
                    });
                    try {
                        await forwardCommandAndWait(
                            'request_effect',
                            requestPayload,
                            emit,
                            Math.min(REQUEST_EFFECT_TIMEOUT_MS, 800),
                        );
                    } catch {
                        // Best-effort preflight approval signal; continue task execution path.
                    }
                }
                const executionOptionsWithCompactionHooks: UserMessageExecutionOptions = {
                    ...input.executionOptions,
                    onPreCompact: (compactPayload) => {
                        emitHookEvent('PreCompact', {
                            taskId: input.taskId,
                            payload: {
                                threadId: compactPayload.threadId,
                                resourceId: compactPayload.resourceId,
                                workspacePath: compactPayload.workspacePath,
                                microSummary: compactPayload.microSummary,
                                structuredSummary: compactPayload.structuredSummary,
                                recalledMemoryFiles: compactPayload.recalledMemoryFiles,
                            },
                        });
                    },
                    onPostCompact: (compactPayload) => {
                        emitHookEvent('PostCompact', {
                            taskId: input.taskId,
                            payload: {
                                threadId: compactPayload.threadId,
                                resourceId: compactPayload.resourceId,
                                workspacePath: compactPayload.workspacePath,
                                microSummary: compactPayload.microSummary,
                                structuredSummary: compactPayload.structuredSummary,
                                recalledMemoryFiles: compactPayload.recalledMemoryFiles,
                            },
                        });
                    },
                };
                const mode = input.executionOptions?.executionPath === 'direct'
                    ? 'direct'
                    : 'workflow';
                const runDirect = async (): Promise<void> => {
                    await runUserMessageWithThreadRecovery(input);
                };
                if (!deps.executeTaskMessage) {
                    await runDirect();
                    return 'direct';
                }
                const delegateResult = await deps.executeTaskMessage({
                    taskId: input.taskId,
                    turnId: input.turnId,
                    message: input.message,
                    resourceId: input.resourceId,
                    preferredThreadId: input.preferredThreadId,
                    workspacePath: input.workspacePath,
                    executionOptions: executionOptionsWithCompactionHooks,
                    runDirect,
                    emitDesktopEvent: async (event: DesktopEvent) => {
                        await emitDesktopEvent(input.taskId, event, emit, input.turnId);
                    },
                });
                const executionPath = delegateResult?.executionPath;
                if (
                    executionPath === 'workflow'
                    || executionPath === 'workflow_fallback'
                    || executionPath === 'direct'
                ) {
                    return executionPath;
                }
                return mode;
            };
            runMissingToolEvidenceAutoRetry = (retryInput) => {
                const turnRetryKey = `${retryInput.turnEventStateKey}:missing-tool-evidence`;
                if (missingToolEvidenceAutoRetryByTurnKey.has(turnRetryKey)) {
                    return true;
                }
                const existingState = taskStates.get(retryInput.taskId);
                if (!existingState) {
                    return false;
                }
                const baseRetryMessage = typeof existingState.lastUserMessage === 'string'
                    ? existingState.lastUserMessage.trim()
                    : '';
                if (baseRetryMessage.length === 0) {
                    return false;
                }
                const envMaxAttempts = resolveMissingToolEvidenceAutoRetryMaxAttempts();
                const currentAttempts = Math.max(0, existingState.retry?.attempts ?? 0);
                // Only apply implicit retry floor for "complete-without-evidence" class.
                // Protocol error paths (for example missing terminal events) should fail fast
                // unless an explicit retry budget is configured.
                const hasActionableProgressSignal = hasTaskTurnAssistantNarrative(retryInput.turnEventStateKey)
                    || getTaskTurnObservedToolNames(retryInput.turnEventStateKey).length > 0;
                const missingCapabilitiesForTurn = getTaskTurnMissingRequiredCompletionCapabilities(
                    retryInput.turnEventStateKey,
                );
                const requiredCapabilitiesForTurn = getTaskTurnRequiredCompletionCapabilities(
                    retryInput.turnEventStateKey,
                );
                const commandRecoveryHint = getTaskTurnCommandRecoveryHint(
                    retryInput.turnEventStateKey,
                    retryInput.taskId,
                );
                const commandFailureInfo = getTaskTurnCommandFailureInfo(
                    retryInput.turnEventStateKey,
                    retryInput.taskId,
                );
                const retryFloorCapabilities = missingCapabilitiesForTurn.length > 0
                    ? missingCapabilitiesForTurn
                    : retryInput.requiredCapabilities;
                const attemptedCapabilitiesForTurn = getTaskTurnResultAttemptedCompletionCapabilities(
                    retryInput.turnEventStateKey,
                );
                const attemptedRetryFloorCapability = attemptedCapabilitiesForTurn.some((capability) => (
                    retryFloorCapabilities.includes(capability)
                ));
                const hasAnyRequiredCapability = requiredCapabilitiesForTurn.length > 0;
                const canApplyProtocolSafetyFloor = retryInput.source === 'complete'
                    && hasActionableProgressSignal
                    && hasAnyRequiredCapability
                    && !attemptedRetryFloorCapability;
                const hasCommandFailureSignal = Boolean(commandFailureInfo || commandRecoveryHint);
                const canApplyErrorRecoveryFloor = retryInput.source === 'error'
                    && retryInput.requiredCapabilities.includes(COMMAND_EXECUTION_CAPABILITY)
                    && hasCommandFailureSignal;
                const implicitRetryFloor = canApplyProtocolSafetyFloor
                    ? resolveMissingToolEvidenceRetryFloor(retryFloorCapabilities)
                    : (canApplyErrorRecoveryFloor ? 1 : 0);
                const configuredRetryCapFromState = existingState.retry?.maxAttempts;
                const configuredMaxAttempts = configuredRetryCapFromState === 0
                    ? implicitRetryFloor
                    : Math.max(
                        0,
                        configuredRetryCapFromState ?? envMaxAttempts,
                        implicitRetryFloor,
                    );
                const maxAttempts = resolveAdaptiveMissingToolEvidenceRetryMaxAttempts({
                    configuredMaxAttempts,
                    currentAttempts,
                    lastError: existingState.retry?.lastError,
                    requiredCapabilities: retryInput.requiredCapabilities,
                });
                const nextAttempts = currentAttempts + 1;
                if (maxAttempts <= 0 || nextAttempts > maxAttempts) {
                    return false;
                }
                const retryDelayMs = resolveMissingToolEvidenceAutoRetryDelayMs();
                const retryMessage = buildMissingToolEvidenceRetryMessage({
                    message: baseRetryMessage,
                    requiredCapabilities: retryInput.requiredCapabilities,
                    source: retryInput.source,
                    commandRecoveryHint,
                });
                const retryReason = retryInput.source === 'error'
                    ? 'retryable_command_failure'
                    : 'complete_without_required_tool_evidence';
                const retryStatusMessage = retryInput.source === 'error'
                    ? `命令步骤失败，正在仅重试失败步骤 (${nextAttempts}/${maxAttempts})...`
                    : `缺少工具证据，正在自动重试 (${nextAttempts}/${maxAttempts})...`;
                const updatedState = upsertTaskState(retryInput.taskId, {
                    status: 'retrying',
                    suspended: false,
                    suspensionReason: undefined,
                    checkpoint: undefined,
                    retry: {
                        attempts: nextAttempts,
                        maxAttempts,
                        lastRetryAt: getNowIso(),
                        lastError: retryReason,
                    },
                });
                resetTaskTurnAttemptStreamState(retryInput.turnEventStateKey);
                clearPendingApprovalsForTask(retryInput.taskId);
                missingToolEvidenceAutoRetryByTurnKey.add(turnRetryKey);
                emit({
                    type: 'RATE_LIMITED',
                    taskId: retryInput.taskId,
                    payload: {
                        message: retryStatusMessage,
                        attempt: nextAttempts,
                        maxRetries: maxAttempts,
                        retryAfterMs: retryDelayMs,
                        error: retryReason,
                        stage: 'unknown',
                        requiredCapabilities: retryInput.requiredCapabilities,
                        source: retryInput.source,
                        traceId: retryInput.traceId ?? null,
                        turnId: retryInput.turnId,
                    },
                });
                const executionOptions = buildRetryExecutionOptionsFromTaskState(updatedState);
                const retryTurnId = retryInput.turnId ?? `auto-retry:${createId()}`;
                const queueExecution = enqueueTaskExecution({
                    taskId: retryInput.taskId,
                    turnId: retryTurnId,
                    run: async () => {
                        missingToolEvidenceAutoRetryByTurnKey.delete(turnRetryKey);
                        if (retryDelayMs > 0) {
                            await new Promise<void>((resolve) => {
                                setTimeout(resolve, retryDelayMs);
                            });
                        }
                        return await executeTaskMessage({
                            taskId: retryInput.taskId,
                            turnId: retryTurnId,
                            message: retryMessage,
                            resourceId: updatedState.resourceId,
                            preferredThreadId: updatedState.conversationThreadId,
                            workspacePath: updatedState.workspacePath,
                            executionOptions,
                        });
                    },
                });
                void queueExecution.completion
                    .then((executionPath) => {
                        if (executionPath !== updatedState.executionPath) {
                            upsertTaskState(retryInput.taskId, {
                                executionPath,
                            });
                        }
                    })
                    .catch((error) => {
                        const message = error instanceof Error ? error.message : String(error);
                        const classification = classifyRuntimeErrorMessage(message);
                        const adaptiveMaxAttempts = resolveAdaptiveMissingToolEvidenceRetryMaxAttempts({
                            configuredMaxAttempts: maxAttempts,
                            currentAttempts: nextAttempts,
                            lastError: message,
                            requiredCapabilities: retryInput.requiredCapabilities,
                        });
                        if (!hasTaskTurnTerminalEvent(retryInput.turnEventStateKey)) {
                            markTaskTurnTerminalEvent(retryInput.turnEventStateKey, 'error');
                            upsertTaskState(retryInput.taskId, {
                                status: 'failed',
                                suspended: false,
                                suspensionReason: undefined,
                                checkpoint: undefined,
                                retry: {
                                    attempts: nextAttempts,
                                    maxAttempts: adaptiveMaxAttempts,
                                    lastRetryAt: getNowIso(),
                                    lastError: message,
                                },
                            });
                            emit({
                                type: 'TASK_FAILED',
                                taskId: retryInput.taskId,
                                payload: {
                                    error: message,
                                    errorCode: classification.errorCode,
                                    recoverable: classification.recoverable,
                                    suggestion: classification.suggestion,
                                    failureClass: classification.failureClass,
                                    traceId: retryInput.traceId ?? null,
                                    turnId: retryInput.turnId,
                                },
                            });
                        }
                    })
                    .finally(() => {
                        missingToolEvidenceAutoRetryByTurnKey.delete(turnRetryKey);
                    });
                return true;
            };
            if (command.type === 'bootstrap_runtime_context') {
                bootstrapRuntimeContext = toRecord(payload.runtimeContext);
                hydrateLegacyRuntimeRecordsFromBootstrap(bootstrapRuntimeContext);
                emitFor('bootstrap_runtime_context_response', {
                    success: true,
                });
                return;
            }
            if (command.type === 'get_runtime_snapshot') {
                try {
                    emitFor('get_runtime_snapshot_response', {
                        success: true,
                        snapshot: collectRuntimeSnapshot(),
                    });
                } catch (error) {
                    emitFor('get_runtime_snapshot_response', {
                        success: false,
                        snapshot: {
                            generatedAt: getNowIso(),
                            tasks: [],
                            count: 0,
                        },
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return;
            }
            if (command.type === 'warmup_chat_runtime') {
                if (!deps.warmupChatRuntime) {
                    emitFor('warmup_chat_runtime_response', {
                        success: true,
                        warmup: {
                            mcpServerCount: 0,
                            mcpToolCount: 0,
                            durationMs: 0,
                            skipped: true,
                        },
                    });
                    return;
                }
                try {
                    const warmup = await deps.warmupChatRuntime();
                    emitFor('warmup_chat_runtime_response', {
                        success: true,
                        warmup,
                    });
                } catch (error) {
                    emitFor('warmup_chat_runtime_response', {
                        success: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return;
            }
            if (command.type === 'doctor_preflight') {
                const runtimeConfig = buildRuntimeConfigDoctorSummary();
                emitFor('doctor_preflight_response', {
                    success: true,
                    report: {
                        runtime: 'mastra',
                        status: 'ok',
                        hasRuntimeContext: Boolean(bootstrapRuntimeContext),
                        runtimeConfig,
                    },
                    markdown: [
                        '# Doctor Preflight',
                        '',
                        'Mastra runtime is healthy.',
                        '',
                        `- Runtime config: ${runtimeConfig.loadedFromPath ?? 'not found'}`,
                        `- Search provider: ${runtimeConfig.search.provider.value} (${runtimeConfig.search.provider.source})`,
                        `- Search credentials: serper=${runtimeConfig.search.credentials.serperApiKeyConfigured ? 'on' : 'off'}, exa=${runtimeConfig.search.credentials.exaApiKeyConfigured ? 'on' : 'off'}, tavily=${runtimeConfig.search.credentials.tavilyApiKeyConfigured ? 'on' : 'off'}, brave=${runtimeConfig.search.credentials.braveApiKeyConfigured ? 'on' : 'off'}`,
                        ...(runtimeConfig.conflicts.length > 0
                            ? ['', `- Conflicts: ${runtimeConfig.conflicts.join(' | ')}`]
                            : []),
                    ].join('\n'),
                });
                return;
            }
            if (command.type === 'get_tasks') {
                const workspacePath = getString(payload.workspacePath);
                if (!workspacePath) {
                    emitInvalidPayload('get_tasks_response', { tasks: [], count: 0 });
                    return;
                }
                const statusFilter = Array.isArray(payload.status)
                    ? new Set(payload.status.filter((value): value is string => typeof value === 'string'))
                    : null;
                const limit = typeof payload.limit === 'number' && payload.limit > 0
                    ? Math.floor(payload.limit)
                    : null;
                const all = Array.from(taskStates.values())
                    .filter((task) => task.workspacePath === workspacePath)
                    .filter((task) => {
                        if (!statusFilter || statusFilter.size === 0) {
                            return true;
                        }
                        return statusFilter.has(task.status);
                    })
                    .map((task) => ({
                        id: task.taskId,
                        taskId: task.taskId,
                        title: task.title,
                        workspacePath: task.workspacePath,
                        status: task.status,
                        createdAt: task.createdAt,
                        modelId: task.modelId ?? null,
                        executionPath: task.executionPath ?? 'workflow',
                    }));
                const tasks = limit ? all.slice(0, limit) : all;
                emitFor('get_tasks_response', {
                    success: true,
                    tasks,
                    count: tasks.length,
                });
                return;
            }
            if (command.type === 'get_task_runtime_state') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('get_task_runtime_state_response', {
                        taskId,
                        state: null,
                    });
                    return;
                }
                const state = taskStates.get(taskId);
                emitFor('get_task_runtime_state_response', {
                    success: Boolean(state),
                    taskId,
                    state: state
                        ? {
                            taskId: state.taskId,
                            threadId: state.conversationThreadId,
                            title: state.title,
                            workspacePath: state.workspacePath,
                            createdAt: state.createdAt,
                            status: state.status,
                            suspended: state.suspended ?? false,
                            suspensionReason: state.suspensionReason ?? null,
                            lastUserMessage: state.lastUserMessage ?? null,
                            lastTraceId: state.lastTraceId ?? null,
                            enabledSkills: state.enabledSkills ?? [],
                            modelId: state.modelId ?? null,
                            resourceId: state.resourceId,
                            checkpoint: state.checkpoint ?? null,
                            checkpointVersion: state.checkpointVersion ?? resolveTaskCheckpointVersion(state),
                            retry: state.retry ?? null,
                            agentTasks: state.agentTasks ?? [],
                            agentTaskProgress: state.agentTaskProgress ?? null,
                            operationLog: state.operationLog ?? [],
                            executionPath: state.executionPath ?? 'workflow',
                        }
                        : null,
                    error: state ? null : 'task_not_found',
                });
                return;
            }
            if (await handleRemoteSessionCommands({
                commandType: command.type,
                commandId,
                payload,
                taskStates,
                getString,
                toRecord,
                toOptionalRecord,
                getNowIso,
                createId,
                listRemoteSessions,
                parseRemoteSessionScope,
                withRemoteSessionScopeMetadata,
                evaluateManagedTenantCommandGovernance,
                evaluateRemoteSessionGovernance,
                resolveTaskIdForExternalEvent,
                resolveRemoteSessionState,
                resolveTaskIdForRemoteSessionId: (remoteSessionId) => remoteSessionToTaskId.get(remoteSessionId),
                upsertRemoteSessionRecord,
                bindRemoteSessionToTask,
                unbindRemoteSession,
                heartbeatRemoteSessionRecord,
                closeRemoteSessionRecord,
                enqueueChannelDeliveryEvent,
                listChannelDeliveryEvents,
                ackChannelDeliveryEvent,
                getChannelDeliveryEvent,
                markChannelDeliveryDelivered,
                upsertTaskState,
                resolveTaskResourceId,
                appendTranscript,
                emitHookEvent,
                applyPolicyDecision,
                emitInvalidPayload,
                emitFor,
                emitTaskEvent: (taskId, taskEventPayload) => {
                    emit({
                        type: 'TASK_EVENT',
                        taskId,
                        payload: taskEventPayload,
                    });
                },
            })) {
                return;
            }
            if (command.type === 'get_policy_decision_log') {
                const taskId = getString(payload.taskId) ?? undefined;
                const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
                    ? Math.min(1000, Math.floor(payload.limit))
                    : undefined;
                const entries = deps.policyDecisionLog
                    ? deps.policyDecisionLog.list({ taskId, limit })
                    : [];
                emitFor('get_policy_decision_log_response', {
                    success: true,
                    taskId: taskId ?? null,
                    entries,
                    count: entries.length,
                });
                return;
            }
            if (command.type === 'get_hook_events') {
                const taskId = getString(payload.taskId) ?? undefined;
                const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
                    ? Math.min(1000, Math.floor(payload.limit))
                    : undefined;
                const type = parseHookRuntimeEventType(payload.type);
                const entries = deps.hookRuntime
                    ? deps.hookRuntime.list({
                        taskId,
                        limit,
                        type,
                    })
                    : [];
                emitFor('get_hook_events_response', {
                    success: true,
                    taskId: taskId ?? null,
                    type: type ?? null,
                    entries,
                    count: entries.length,
                });
                return;
            }
            if (command.type === 'get_task_transcript') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('get_task_transcript_response', { taskId, entries: [], count: 0 });
                    return;
                }
                const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
                    ? Math.floor(payload.limit)
                    : undefined;
                const entries = deps.taskTranscriptStore
                    ? deps.taskTranscriptStore.list(taskId, limit).map((entry) => ({
                        id: entry.id,
                        role: entry.role,
                        content: entry.content,
                        at: entry.at,
                    }))
                    : [];
                emitFor('get_task_transcript_response', {
                    success: true,
                    taskId,
                    entries,
                    count: entries.length,
                });
                return;
            }
            if (command.type === 'rewind_task') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('rewind_task_response', { taskId });
                    return;
                }
                const rewindGuard = await runGuardPipeline<undefined>([
                    () => {
                        const rewindDecision = applyPolicyDecision({
                            requestId: commandId,
                            action: 'task_command',
                            commandType: command.type,
                            taskId,
                            source: 'rewind_task',
                            payload,
                        });
                        if (!rewindDecision.allowed) {
                            return failGuard(`policy_denied:${rewindDecision.reason}`, undefined);
                        }
                        return passGuard();
                    },
                ]);
                if (!rewindGuard.ok) {
                    emitFor('rewind_task_response', {
                        success: false,
                        taskId,
                        error: rewindGuard.error,
                    });
                    return;
                }
                const userTurns = typeof payload.userTurns === 'number' && Number.isFinite(payload.userTurns) && payload.userTurns > 0
                    ? Math.min(20, Math.floor(payload.userTurns))
                    : 1;
                const rewound = deps.taskTranscriptStore
                    ? deps.taskTranscriptStore.rewindByUserTurns(taskId, userTurns)
                    : {
                        success: false,
                        removedEntries: 0,
                        removedUserTurns: 0,
                        remainingEntries: 0,
                        latestUserMessage: undefined,
                    };
                if (!rewound.success) {
                    emitFor('rewind_task_response', {
                        success: false,
                        taskId,
                        error: 'rewind_unavailable_or_no_history',
                        removedEntries: rewound.removedEntries,
                        removedUserTurns: rewound.removedUserTurns,
                    });
                    return;
                }
                const newThreadId = `${taskId}-rewind-${createId()}`;
                const updatedState = upsertTaskState(taskId, {
                    conversationThreadId: newThreadId,
                    status: 'idle',
                    suspended: false,
                    suspensionReason: undefined,
                    checkpoint: undefined,
                    lastUserMessage: rewound.latestUserMessage,
                });
                const contextRewind = deps.rewindTaskContext
                    ? deps.rewindTaskContext({ taskId, userTurns: rewound.removedUserTurns })
                    : { success: false, removedTurns: 0, remainingTurns: 0 };
                appendTranscript(taskId, 'system', `Rewound last ${rewound.removedUserTurns} user turn(s).`);
                emitHookEvent('TaskRewound', {
                    taskId,
                    payload: {
                        removedUserTurns: rewound.removedUserTurns,
                        removedEntries: rewound.removedEntries,
                        newThreadId: updatedState.conversationThreadId,
                    },
                });
                emitFor('rewind_task_response', {
                    success: true,
                    taskId,
                    removedEntries: rewound.removedEntries,
                    removedUserTurns: rewound.removedUserTurns,
                    remainingEntries: rewound.remainingEntries,
                    latestUserMessage: rewound.latestUserMessage ?? null,
                    newThreadId: updatedState.conversationThreadId,
                    contextRewind,
                });
                emit({
                    type: 'TASK_STATUS',
                    taskId,
                    payload: {
                        status: 'idle',
                        blockingReason: `Task rewound by ${rewound.removedUserTurns} user turn(s).`,
                    },
                });
                return;
            }
            if (command.type === 'get_voice_state') {
                emitFor('get_voice_state_response', {
                    success: true,
                    state: toRecord(getVoicePlaybackState()),
                });
                return;
            }
            if (command.type === 'stop_voice') {
                const stopped = await stopVoicePlayback('user_requested');
                emitFor('stop_voice_response', {
                    success: true,
                    stopped,
                    state: toRecord(getVoicePlaybackState()),
                });
                return;
            }
            if (command.type === 'get_voice_provider_status') {
                const effectiveProviderMode = parseVoiceProviderMode(payload.providerMode);
                emitFor('get_voice_provider_status_response', {
                    success: true,
                    ...toRecord(getVoiceProviderStatus(effectiveProviderMode)),
                });
                return;
            }
            if (command.type === 'transcribe_voice') {
                const audioBase64 = getString(payload.audioBase64) ?? '';
                if (!audioBase64) {
                    emitInvalidPayload('transcribe_voice_response');
                    return;
                }
                const effectiveProviderMode = parseVoiceProviderMode(payload.providerMode);
                emitFor('transcribe_voice_response', await transcribeWithCustomAsr({
                    audioBase64,
                    mimeType: getString(payload.mimeType) ?? undefined,
                    language: getString(payload.language) ?? undefined,
                    providerMode: effectiveProviderMode,
                }));
                return;
            }
            const unsupportedAutonomous = buildUnsupportedAutonomousResponse(command.type, payload);
            if (unsupportedAutonomous) {
                emitFor(unsupportedAutonomous.type, unsupportedAutonomous.payload);
                return;
            }
            if (command.type === 'time_travel_workflow_run') {
                if (!deps.replayWorkflowRunTimeTravel) {
                    emitCurrent({
                        success: false,
                        error: 'unsupported_in_mastra_runtime',
                    });
                    return;
                }
                const workflowId = getString(payload.workflowId) ?? getString(payload.workflow) ?? '';
                const runId = getString(payload.runId) ?? '';
                const steps = Array.isArray(payload.steps)
                    ? payload.steps.filter((value): value is string => typeof value === 'string' && value.length > 0)
                    : [];
                const singleStep = getString(payload.step);
                const replaySteps = steps.length > 0
                    ? steps
                    : (singleStep ? [singleStep] : []);
                if (!workflowId || !runId || replaySteps.length === 0) {
                    emitCurrentInvalidPayload({
                        workflowId,
                        runId,
                    });
                    return;
                }
                try {
                    const replay = await deps.replayWorkflowRunTimeTravel({
                        workflowId,
                        runId,
                        steps: replaySteps,
                        taskId: getString(payload.taskId) ?? undefined,
                        resourceId: getString(payload.resourceId) ?? undefined,
                        threadId: getString(payload.threadId) ?? undefined,
                        workspacePath: getString(payload.workspacePath) ?? getString(toRecord(payload.context).workspacePath) ?? undefined,
                        inputData: Object.prototype.hasOwnProperty.call(payload, 'inputData') ? payload.inputData : undefined,
                        resumeData: Object.prototype.hasOwnProperty.call(payload, 'resumeData') ? payload.resumeData : undefined,
                        perStep: typeof payload.perStep === 'boolean' ? payload.perStep : undefined,
                    });
                    emitCurrent({
                        success: replay.success,
                        workflowId: replay.workflowId,
                        runId: replay.runId,
                        status: replay.status,
                        steps: replay.steps,
                        traceId: replay.traceId,
                        sampled: replay.sampled,
                        result: replay.result ?? null,
                        error: replay.error ?? null,
                    });
                } catch (error) {
                    emitCurrent({
                        success: false,
                        workflowId,
                        runId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return;
            }
            let startOrSendCommandType = command.type;
            let startOrSendPayload = payload;
            if (command.type === 'send_subagent_message') {
                const subagentFollowup = resolveSubagentFollowupMessage({
                    payload,
                    taskStates,
                });
                if (!subagentFollowup.ok) {
                    emitFor('send_subagent_message_response', {
                        success: false,
                        taskId: subagentFollowup.taskId,
                        accepted: false,
                        error: subagentFollowup.error,
                        details: subagentFollowup.details ?? null,
                        availableSubagentTaskIds: subagentFollowup.availableSubagentTaskIds ?? [],
                    });
                    return;
                }
                startOrSendPayload = {
                    ...payload,
                    taskId: subagentFollowup.taskId,
                    content: subagentFollowup.content,
                    subagentTaskId: subagentFollowup.subagentTaskId,
                };
            }
            if (command.type === 'send_task_message') {
                const followupTaskId = getString(payload.taskId);
                const followupMessage = getString(payload.content);
                if (followupTaskId && followupMessage) {
                    const previousState = taskStates.get(followupTaskId);
                    const previousTargets = legacyDeliverablesByTaskId.get(followupTaskId) ?? [];
                    const previousTarget = previousTargets[0]
                        ?? extractSaveTargetFromMessage(previousState?.lastUserMessage);
                    const requestedTarget = extractSaveTargetFromMessage(followupMessage);
                    const correctionHint = /\b(instead|actually|correct(?:ed|ion)?|update)\b/i.test(followupMessage)
                        || /改成|改为|改到|换成|修正/u.test(followupMessage);
                    if (
                        previousState?.status === 'finished'
                        && correctionHint
                        && previousTarget
                        && requestedTarget
                        && previousTarget !== requestedTarget
                    ) {
                        legacyDeliverablesByTaskId.set(followupTaskId, [requestedTarget]);
                        emit({
                            type: 'TASK_CONTRACT_REOPENED',
                            taskId: followupTaskId,
                            payload: {
                                trigger: 'contradictory_evidence',
                                reason: 'User corrected the previous contract deliverable target.',
                                diff: {
                                    changedFields: ['deliverables'],
                                    deliverablesChanged: {
                                        before: [previousTarget],
                                        after: [requestedTarget],
                                    },
                                },
                            },
                        });
                        emit({
                            type: 'TASK_RESEARCH_UPDATED',
                            taskId: followupTaskId,
                            payload: {
                                trigger: 'contradictory_evidence',
                                summary: 'Follow-up correction detected and deliverable research refreshed.',
                            },
                        });
                        emit({
                            type: 'TASK_PLAN_READY',
                            taskId: followupTaskId,
                            payload: {
                                trigger: 'contradictory_evidence',
                                summary: `Updated deliverable target: ${requestedTarget}`,
                                deliverables: [requestedTarget],
                            },
                        });
                        const workspacePath = previousState.workspacePath || process.cwd();
                        upsertTaskState(followupTaskId, {
                            status: 'idle',
                            suspended: false,
                            suspensionReason: undefined,
                            lastUserMessage: followupMessage,
                            executionPath: 'direct',
                            turnContract: buildTaskTurnContract({
                                message: followupMessage,
                                workspacePath,
                                mode: 'task',
                                route: 'direct',
                                requiredCapabilities: [],
                                createdAt: getNowIso(),
                            }),
                        });
                        emitFor('send_task_message_response', {
                            success: true,
                            taskId: followupTaskId,
                            accepted: true,
                            queuePosition: 0,
                            turnId: commandId,
                        });
                        return;
                    }
                }
            }
            if (await handleStartOrSendTaskCommand({
                commandType: startOrSendCommandType,
                commandId,
                payload: startOrSendPayload,
                taskStates,
                getString,
                toRecord,
                pickStringConfigValue,
                pickStringArrayConfigValue,
                pickTaskRuntimeRetryConfig,
                pickBooleanConfigValue,
                pickPositiveIntegerConfigValue,
                pickTaskExecutionPath,
                toUserMessageExecutionPath,
                resolveSkillPrompt: deps.resolveSkillPrompt,
                listRuntimeCapabilities: deps.listRuntimeCapabilities,
                listRuntimeToolsets: deps.listRuntimeToolsets,
                isRuntimeMcpEnabled: deps.isRuntimeMcpEnabled,
                getRuntimeMcpSnapshot: deps.getRuntimeMcpSnapshot,
                resolveTaskResourceId,
                upsertTaskState,
                appendTranscript,
                listTaskTranscriptEntries: (taskId, limit) => (
                    deps.taskTranscriptStore?.list(taskId, limit).map((entry) => ({
                        role: entry.role,
                        content: entry.content,
                    })) ?? []
                ),
                applyPolicyDecision,
                emitCurrentInvalidPayload,
                emitCurrent,
                emitFor,
                emitHookEvent,
                emitTaskStarted,
                emitTaskSummary,
                enqueueTaskExecution,
                executeTaskMessage,
                isScheduledCancellationRequest,
                scheduleTaskIfNeeded: deps.scheduleTaskIfNeeded,
                cancelScheduledTasksForSourceTask: deps.cancelScheduledTasksForSourceTask,
                claimTaskMessageDispatch,
                completeTaskMessageDispatch,
            })) {
                return;
            }
            if (await handleRecoveryAndCheckpointCommands({
                commandType: command.type,
                commandId,
                payload,
                taskStates,
                getString,
                toRecord,
                getNowIso,
                createId,
                resolveTaskResourceId,
                resolveTaskCheckpointVersion,
                resolveTaskOperationId,
                resolveExpectedCheckpointVersion,
                findTaskOperationRecord,
                appendTaskOperationRecord,
                upsertTaskState,
                appendTranscript,
                applyPolicyDecision,
                emitInvalidPayload,
                emitFor,
                emitTaskEvent: (taskId, taskEventPayload) => {
                    emit({
                        type: 'TASK_EVENT',
                        taskId,
                        payload: taskEventPayload,
                    });
                },
                executeTaskMessage,
                claimTaskMessageDispatch,
                completeTaskMessageDispatch,
            })) {
                return;
            }
            if (await handleTaskControlCommands({
                commandType: command.type,
                commandId,
                payload,
                getString,
                pendingApprovals,
                clearPendingApprovalsForTask,
                cancelScheduledTasksForSourceTask: deps.cancelScheduledTasksForSourceTask,
                taskStates,
                upsertTaskState,
                appendTranscript,
                applyPolicyDecision,
                handleApprovalResponse: async (input) => {
                    await deps.handleApprovalResponse(
                        input.runId,
                        input.toolCallId,
                        input.approved,
                        (event) => emitDesktopEvent(input.taskId, event, emit),
                        {
                            taskId: input.taskId,
                        },
                    );
                },
                emitInvalidPayload,
                emitFor,
                emitCurrent,
                emitTaskEvent: (taskId, type, payload) => {
                    emit({
                        type,
                        taskId,
                        payload,
                    });
                },
            })) {
                return;
            }
            if (forwardedCommandTypes.has(command.type)) {
                const forwardedCommandGuard = await runGuardPipeline<undefined>([
                    () => {
                        const forwardedCommandDecision = applyPolicyDecision({
                            requestId: commandId,
                            action: 'forward_command',
                            commandType: command.type,
                            taskId: getString(payload.taskId) ?? undefined,
                            source: 'policy_gate_forward',
                            payload,
                        });
                        if (!forwardedCommandDecision.allowed) {
                            return failGuard(`policy_denied:${forwardedCommandDecision.reason}`, undefined);
                        }
                        return passGuard();
                    },
                ]);
                if (!forwardedCommandGuard.ok) {
                    emitCurrent({
                        success: false,
                        error: forwardedCommandGuard.error,
                    });
                    return;
                }
                try {
                    const forwarded = await forwardCommandAndWait(
                        command.type,
                        payload,
                        emit,
                        command.type === 'request_effect' ? REQUEST_EFFECT_TIMEOUT_MS : policyGateResponseTimeoutMs,
                    );
                    const expectedType = `${command.type}_response`;
                    if (forwarded.type === expectedType) {
                        emitFor(expectedType, toRecord(forwarded.payload));
                        return;
                    }
                    forwardBridgeStats.invalidResponses += 1;
                    emitFor(expectedType, {
                        success: false,
                        error: `policy_gate_invalid_response:${forwarded.type}`,
                    });
                    return;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (command.type === 'apply_patch') {
                        emitFor('apply_patch_response', {
                            patchId: getString(payload.patchId) ?? createId(),
                            success: false,
                            error: `policy_gate_unavailable:${errorMessage}`,
                            errorCode: 'io_error',
                        });
                        return;
                    }
                    emitCurrent({
                        success: false,
                        error: `policy_gate_unavailable:${errorMessage}`,
                    });
                    return;
                }
            }
            if (deps.handleAdditionalCommand) {
                const delegated = await deps.handleAdditionalCommand(command);
                if (delegated) {
                    emit(delegated);
                    return;
                }
            }
            emitCurrent({
                success: false,
                error: 'unsupported_in_mastra_runtime',
            });
        },
    };
}
