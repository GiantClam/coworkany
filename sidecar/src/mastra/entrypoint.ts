import { randomUUID } from 'crypto';
import type { DesktopEvent } from '../ipc/bridge';
import { deriveDefaultResourceId } from './runtimeIdentity';
import type { HookRuntime } from './hookRuntime';
import type { PolicyEngine, PolicyDecisionAction } from './policyEngine';
import type { PolicyDecisionLogStore } from './policyDecisionLog';
import type { RemoteSessionConflictStrategy, RemoteSessionGovernancePolicy } from './remoteSessionGovernance';
import {
    recoverTaskRuntimeStateAfterRestart,
    type TaskRuntimeCheckpoint,
    type TaskRuntimeOperationAction,
    type TaskRuntimeOperationRecord,
    type TaskRuntimeRetryState,
    type TaskRuntimeState,
} from './taskRuntimeState';
type OutgoingMessage = Record<string, unknown>;
type UserMessageExecutionOptions = {
    taskId?: string;
    workspacePath?: string;
    enabledSkills?: string[];
    skillPrompt?: string;
    requireToolApproval?: boolean;
    autoResumeSuspendedTools?: boolean;
    toolCallConcurrency?: number;
    maxSteps?: number;
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
};
const DEFAULT_POLICY_GATE_TIMEOUT_MS = 30_000;
const REQUEST_EFFECT_TIMEOUT_MS = 300_000;
const DEFAULT_POLICY_GATE_TIMEOUT_RETRY_COUNT = 1;
const DEFAULT_REMOTE_SESSION_STALE_AFTER_MS = 5 * 60 * 1000;
const MAX_TASK_OPERATION_LOG = 64;
const REMOTE_SESSION_SCOPE_METADATA_KEY = '__remoteSessionScope';
function isIpcTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('IPC response timeout');
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
function getNonNegativeInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return Math.floor(value);
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
    return normalized.includes('item with id')
        && normalized.includes('not found')
        && normalized.includes('store')
        && normalized.includes('false');
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
    const maxRetries = pickPositiveIntegerConfigValue(config, 'maxRetries', 1, 10);
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

function isRetryableTaskStatus(status: TaskRuntimeState['status']): boolean {
    return status === 'failed' || status === 'interrupted' || status === 'suspended';
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
    const clearPendingApprovalsForTask = (taskId: string): void => {
        for (const [requestId, pending] of pendingApprovals.entries()) {
            if (pending.taskId === taskId) {
                pendingApprovals.delete(requestId);
            }
        }
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
        const hasCheckpoint = Object.prototype.hasOwnProperty.call(patch, 'checkpoint');
        const hasCheckpointVersion = Object.prototype.hasOwnProperty.call(patch, 'checkpointVersion');
        const hasRetry = Object.prototype.hasOwnProperty.call(patch, 'retry');
        const hasOperationLog = Object.prototype.hasOwnProperty.call(patch, 'operationLog');
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
            resourceId: patch.resourceId ?? existing?.resourceId ?? resolveResourceId(taskId),
            checkpoint: hasCheckpoint ? patch.checkpoint : existing?.checkpoint,
            checkpointVersion: hasCheckpointVersion
                ? patch.checkpointVersion
                : fallbackCheckpointVersion,
            retry: hasRetry ? patch.retry : existing?.retry,
            operationLog: hasOperationLog ? patch.operationLog : existing?.operationLog,
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
            resourceId: task.resourceId,
            checkpoint: task.checkpoint,
            checkpointVersion: task.checkpointVersion ?? resolveTaskCheckpointVersion(task),
            retry: task.retry,
            operationLog: task.operationLog ?? [],
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
    const emitDesktopEvent = async (
        taskId: string,
        event: DesktopEvent,
        emit: (message: OutgoingMessage) => void,
    ): Promise<void> => {
        const traceId = event.traceId ?? null;
        if (typeof event.traceId === 'string' && event.traceId.length > 0) {
            upsertTaskState(taskId, {
                lastTraceId: event.traceId,
            });
        }
        if (event.type === 'text_delta') {
            if (event.role !== 'thinking' && typeof event.content === 'string') {
                appendTranscript(taskId, 'assistant', event.content);
            }
            emit({
                type: 'TEXT_DELTA',
                taskId,
                payload: {
                    delta: event.content,
                    role: event.role ?? 'assistant',
                    traceId,
                },
            });
            return;
        }
        if (event.type === 'approval_required') {
            // Auto-approve safe tools without requiring user confirmation
            if (AUTO_APPROVE_TOOLS.has(event.toolName)) {
                await deps.handleApprovalResponse(
                    event.runId ?? '',
                    event.toolCallId,
                    true,
                    (event) => emit(toRecord(event)),
                );
                return;
            }
            const requestId = createId();
            const checkpoint: TaskRuntimeCheckpoint = {
                id: `approval:${requestId}`,
                label: `Awaiting approval for ${event.toolName}`,
                at: getNowIso(),
                metadata: {
                    toolName: event.toolName,
                    toolCallId: event.toolCallId,
                },
            };
            pendingApprovals.set(requestId, {
                taskId,
                runId: event.runId ?? '',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
            });
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
            emit({
                type: 'EFFECT_REQUESTED',
                taskId,
                payload: {
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
                        },
                    },
                    requiresUserConfirmation: true,
                    riskLevel: 7,
                },
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
                },
            });
            return;
        }
        if (event.type === 'error') {
            clearPendingApprovalsForTask(taskId);
            const existingRetry = taskStates.get(taskId)?.retry;
            upsertTaskState(taskId, {
                status: 'failed',
                suspended: false,
                suspensionReason: undefined,
                retry: existingRetry
                    ? {
                        ...existingRetry,
                        lastError: event.message,
                    }
                    : undefined,
            });
            emitHookEvent('TaskFailed', {
                taskId,
                runId: event.runId,
                traceId: typeof traceId === 'string' ? traceId : undefined,
                payload: {
                    message: event.message,
                },
            });
            emit({
                type: 'TASK_FAILED',
                taskId,
                payload: {
                    error: event.message,
                    errorCode: 'MASTRA_RUNTIME_ERROR',
                    traceId,
                },
            });
            return;
        }
        if (event.type === 'tripwire') {
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
            const command = toProtocolCommand(raw);
            if (!command || !command.type) {
                emit({ type: 'error', message: 'invalid_command' });
                return;
            }
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
                scheduled?: boolean;
            }): void => {
                emit({
                    type: 'TASK_STARTED',
                    taskId: input.taskId,
                    payload: {
                        title: input.title,
                        description: input.message,
                        context: {
                            workspacePath: input.workspacePath,
                            userQuery: input.message,
                            ...(input.scheduled ? { scheduled: true } : {}),
                        },
                    },
                });
            };
            const emitTaskSummary = (input: {
                taskId: string;
                summary: string;
                finishReason: string;
            }): void => {
                emit({
                    type: 'TEXT_DELTA',
                    taskId: input.taskId,
                    payload: {
                        delta: input.summary,
                        role: 'assistant',
                    },
                });
                emit({
                    type: 'TASK_FINISHED',
                    taskId: input.taskId,
                    payload: {
                        summary: input.summary,
                        finishReason: input.finishReason,
                    },
                });
            };
            const runUserMessageWithThreadRecovery = async (input: {
                taskId: string;
                message: string;
                resourceId: string;
                preferredThreadId: string;
                workspacePath?: string;
                executionOptions?: UserMessageExecutionOptions;
            }): Promise<void> => {
                const isAssistantProgressEvent = (event: DesktopEvent): boolean => (
                    event.type === 'text_delta'
                    || event.type === 'tool_call'
                    || event.type === 'approval_required'
                    || event.type === 'tool_result'
                );
                const executeAttempt = async (
                    threadId: string,
                    onEvent: (event: DesktopEvent) => void,
                ): Promise<void> => {
                    await deps.handleUserMessage(
                        input.message,
                        threadId,
                        input.resourceId,
                        onEvent,
                        {
                            ...input.executionOptions,
                            taskId: input.taskId,
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
                };

                let hasRecoverableHistoryError = false;
                let hasAssistantProgress = false;
                let suppressRecoverableAttempt = false;
                const suppressedRecoverableEvents: DesktopEvent[] = [];

                await executeAttempt(input.preferredThreadId, (event) => {
                    const isProgressEvent = isAssistantProgressEvent(event);
                    if (isProgressEvent) {
                        hasAssistantProgress = true;
                    }
                    if (suppressRecoverableAttempt && !hasAssistantProgress) {
                        suppressedRecoverableEvents.push(event);
                        return;
                    }
                    if (suppressRecoverableAttempt && hasAssistantProgress) {
                        suppressRecoverableAttempt = false;
                        for (const suppressedEvent of suppressedRecoverableEvents) {
                            emitDesktopEvent(input.taskId, suppressedEvent, emit);
                        }
                        suppressedRecoverableEvents.length = 0;
                    }
                    if (
                        !hasAssistantProgress
                        && event.type === 'error'
                        && isStoreDisabledHistoryReferenceError(event.message)
                    ) {
                        hasRecoverableHistoryError = true;
                        suppressRecoverableAttempt = true;
                        suppressedRecoverableEvents.push(event);
                        return;
                    }
                    emitDesktopEvent(input.taskId, event, emit);
                });

                if (hasRecoverableHistoryError && !hasAssistantProgress) {
                    const recoveryThreadId = `${input.taskId}-recovery-${createId()}`;
                    upsertTaskState(input.taskId, {
                        conversationThreadId: recoveryThreadId,
                    });
                    await executeAttempt(recoveryThreadId, (event) => {
                        emitDesktopEvent(input.taskId, event, emit);
                    });
                    return;
                }

                if (suppressedRecoverableEvents.length > 0) {
                    for (const event of suppressedRecoverableEvents) {
                        emitDesktopEvent(input.taskId, event, emit);
                    }
                }
            };
            if (command.type === 'bootstrap_runtime_context') {
                bootstrapRuntimeContext = toRecord(payload.runtimeContext);
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
            if (command.type === 'doctor_preflight') {
                emitFor('doctor_preflight_response', {
                    success: true,
                    report: {
                        runtime: 'mastra',
                        status: 'ok',
                        hasRuntimeContext: Boolean(bootstrapRuntimeContext),
                    },
                    markdown: '# Doctor Preflight\n\nMastra runtime is healthy.',
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
                            resourceId: state.resourceId,
                            checkpoint: state.checkpoint ?? null,
                            checkpointVersion: state.checkpointVersion ?? resolveTaskCheckpointVersion(state),
                            retry: state.retry ?? null,
                            operationLog: state.operationLog ?? [],
                        }
                        : null,
                    error: state ? null : 'task_not_found',
                });
                return;
            }
            if (command.type === 'list_remote_sessions') {
                const taskId = getString(payload.taskId) ?? undefined;
                const statusRaw = getString(payload.status);
                const status = statusRaw === 'active' || statusRaw === 'closed'
                    ? statusRaw
                    : undefined;
                const sessions = deps.remoteSessionStore
                    ? deps.remoteSessionStore.list({ taskId, status })
                    : Array.from(remoteSessionToTaskId.entries()).map(([remoteSessionId, mappedTaskId]) => ({
                        remoteSessionId,
                        taskId: mappedTaskId,
                        status: 'active' as const,
                        linkedAt: getNowIso(),
                        lastSeenAt: getNowIso(),
                    }));
                emitFor('list_remote_sessions_response', {
                    success: true,
                    sessions,
                    count: sessions.length,
                    taskId: taskId ?? null,
                    status: status ?? null,
                });
                return;
            }
            if (command.type === 'open_remote_session') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('open_remote_session_response', { taskId });
                    return;
                }
                const remoteSessionId = getString(payload.remoteSessionId) ?? `remote-${createId()}`;
                const metadata = toOptionalRecord(payload.metadata);
                const scope = parseRemoteSessionScope(payload, metadata);
                const scopedMetadata = withRemoteSessionScopeMetadata(metadata, scope);
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('open_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                const policyDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId,
                    source: 'remote_session_open',
                    payload,
                });
                if (!policyDecision.allowed) {
                    emitFor('open_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: `policy_denied:${policyDecision.reason}`,
                    });
                    return;
                }
                const governance = evaluateRemoteSessionGovernance({
                    remoteSessionId,
                    targetTaskId: taskId,
                    scope,
                    metadata: scopedMetadata,
                });
                if (!governance.allowed) {
                    emitFor('open_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: governance.error ?? 'remote_session_governance_denied',
                        remoteSession: governance.existingState ?? null,
                    });
                    return;
                }
                const arbitration = governance.arbitration ?? { action: 'none' as const };
                if (
                    arbitration.action !== 'none'
                    && governance.existingState
                    && governance.existingState.taskId !== taskId
                ) {
                    closeRemoteSessionRecord(remoteSessionId);
                    unbindRemoteSession(remoteSessionId);
                }
                const upserted = upsertRemoteSessionRecord({
                    remoteSessionId,
                    taskId,
                    channel: getString(payload.channel) ?? undefined,
                    metadata: scopedMetadata,
                });
                if (!upserted.success) {
                    emitFor('open_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: upserted.conflict ? 'remote_session_task_conflict' : 'remote_session_open_failed',
                        remoteSession: upserted.state ?? null,
                        arbitration,
                    });
                    return;
                }
                bindRemoteSessionToTask(taskId, remoteSessionId);
                appendTranscript(taskId, 'system', `Remote session opened: ${remoteSessionId}`);
                emitHookEvent('RemoteSessionLinked', {
                    taskId,
                    payload: {
                        remoteSessionId,
                        channel: getString(payload.channel) ?? null,
                        source: 'open_remote_session',
                    },
                });
                emit({
                    type: 'TASK_EVENT',
                    taskId,
                    payload: {
                        type: 'remote_session',
                        action: arbitration.action === 'none' ? 'opened' : 'rebound',
                        remoteSessionId,
                        channel: getString(payload.channel) ?? null,
                        scope,
                        arbitration,
                        at: getNowIso(),
                    },
                });
                emitFor('open_remote_session_response', {
                    success: true,
                    taskId,
                    remoteSessionId,
                    remoteSession: upserted.state ?? null,
                    scope,
                    arbitration,
                });
                return;
            }
            if (command.type === 'heartbeat_remote_session') {
                const remoteSessionId = getString(payload.remoteSessionId) ?? '';
                if (!remoteSessionId) {
                    emitInvalidPayload('heartbeat_remote_session_response', { remoteSessionId });
                    return;
                }
                const state = deps.remoteSessionStore?.get(remoteSessionId);
                const taskId = getString(payload.taskId)
                    ?? state?.taskId
                    ?? remoteSessionToTaskId.get(remoteSessionId)
                    ?? '';
                if (!taskId) {
                    emitFor('heartbeat_remote_session_response', {
                        success: false,
                        remoteSessionId,
                        error: 'remote_session_not_found',
                    });
                    return;
                }
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('heartbeat_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                const policyDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId,
                    source: 'remote_session_heartbeat',
                    payload,
                });
                if (!policyDecision.allowed) {
                    emitFor('heartbeat_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: `policy_denied:${policyDecision.reason}`,
                    });
                    return;
                }
                const heartbeated = heartbeatRemoteSessionRecord(remoteSessionId, toOptionalRecord(payload.metadata));
                if (!heartbeated.success) {
                    emitFor('heartbeat_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: 'remote_session_not_found',
                    });
                    return;
                }
                bindRemoteSessionToTask(taskId, remoteSessionId);
                emitFor('heartbeat_remote_session_response', {
                    success: true,
                    taskId,
                    remoteSessionId,
                    remoteSession: heartbeated.state ?? null,
                });
                return;
            }
            if (command.type === 'sync_remote_session') {
                const remoteSessionId = getString(payload.remoteSessionId) ?? '';
                if (!remoteSessionId) {
                    emitInvalidPayload('sync_remote_session_response', { remoteSessionId });
                    return;
                }
                const existingRemoteState = resolveRemoteSessionState(remoteSessionId);
                const taskId = getString(payload.taskId)
                    ?? existingRemoteState?.taskId
                    ?? remoteSessionToTaskId.get(remoteSessionId)
                    ?? '';
                if (!taskId) {
                    emitFor('sync_remote_session_response', {
                        success: false,
                        remoteSessionId,
                        error: 'remote_session_not_found',
                    });
                    return;
                }
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('sync_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                const policyDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId,
                    source: 'remote_session_sync',
                    payload,
                });
                if (!policyDecision.allowed) {
                    emitFor('sync_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: `policy_denied:${policyDecision.reason}`,
                    });
                    return;
                }
                const syncMetadata = toOptionalRecord(payload.metadata);
                const scope = parseRemoteSessionScope(payload, syncMetadata);
                const scopedMetadata = withRemoteSessionScopeMetadata(syncMetadata, scope);
                const governance = evaluateRemoteSessionGovernance({
                    remoteSessionId,
                    targetTaskId: taskId,
                    scope,
                    metadata: scopedMetadata,
                });
                if (!governance.allowed) {
                    emitFor('sync_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: governance.error ?? 'remote_session_governance_denied',
                        remoteSession: governance.existingState ?? null,
                    });
                    return;
                }
                const arbitration = governance.arbitration ?? { action: 'none' as const };
                if (
                    arbitration.action !== 'none'
                    && governance.existingState
                    && governance.existingState.taskId !== taskId
                ) {
                    closeRemoteSessionRecord(remoteSessionId);
                    unbindRemoteSession(remoteSessionId);
                }
                const syncChannel = getString(payload.channel) ?? existingRemoteState?.channel;
                const upserted = upsertRemoteSessionRecord({
                    remoteSessionId,
                    taskId,
                    channel: syncChannel ?? undefined,
                    metadata: scopedMetadata,
                });
                if (!upserted.success) {
                    emitFor('sync_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: upserted.conflict ? 'remote_session_task_conflict' : 'remote_session_sync_failed',
                        remoteSession: upserted.state ?? null,
                        arbitration,
                    });
                    return;
                }
                bindRemoteSessionToTask(taskId, remoteSessionId);
                const heartbeated = heartbeatRemoteSessionRecord(remoteSessionId, scopedMetadata);
                const replayPending = payload.replayPending !== false;
                const onlyRemoteSessionPending = payload.onlyRemoteSessionPending === true;
                const ackReplayed = payload.ackReplayed === true;
                const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
                    ? Math.min(200, Math.floor(payload.limit))
                    : 50;
                const allPending = replayPending
                    ? listChannelDeliveryEvents({
                        taskId,
                        status: 'pending',
                        limit,
                    })
                    : [];
                const pendingEvents = onlyRemoteSessionPending
                    ? allPending.filter((event) => event.remoteSessionId === remoteSessionId)
                    : allPending;
                const replayedEventIds: string[] = [];
                let ackedCount = 0;
                if (replayPending) {
                    for (const event of pendingEvents) {
                        const delivered = markChannelDeliveryDelivered({
                            eventId: event.id,
                            taskId: event.taskId,
                            remoteSessionId: event.remoteSessionId ?? remoteSessionId,
                        });
                        const replayEvent = delivered.event ?? event;
                        replayedEventIds.push(replayEvent.id);
                        emit({
                            type: 'TASK_EVENT',
                            taskId: replayEvent.taskId,
                            payload: {
                                type: 'channel_event',
                                action: 'replayed_on_sync',
                                deliveryId: replayEvent.id,
                                channel: replayEvent.channel,
                                eventType: replayEvent.eventType,
                                content: replayEvent.content ?? '',
                                remoteSessionId: replayEvent.remoteSessionId ?? null,
                                metadata: replayEvent.metadata ?? {},
                                deliveryAttempts: replayEvent.deliveryAttempts ?? 0,
                                replayedAt: getNowIso(),
                            },
                        });
                        if (ackReplayed) {
                            const acked = ackChannelDeliveryEvent({
                                eventId: replayEvent.id,
                                taskId: replayEvent.taskId,
                                remoteSessionId: replayEvent.remoteSessionId,
                                metadata: {
                                    source: 'sync_remote_session',
                                    remoteSessionId,
                                },
                            });
                            if (acked.success) {
                                ackedCount += 1;
                            }
                        }
                    }
                }
                emit({
                    type: 'TASK_EVENT',
                    taskId,
                    payload: {
                        type: 'remote_session',
                        action: 'synced',
                        remoteSessionId,
                        channel: syncChannel ?? null,
                        scope,
                        arbitration,
                        pendingCount: pendingEvents.length,
                        replayedCount: replayedEventIds.length,
                        ackedCount,
                        at: getNowIso(),
                    },
                });
                emitFor('sync_remote_session_response', {
                    success: true,
                    taskId,
                    remoteSessionId,
                    remoteSession: heartbeated.state ?? upserted.state ?? null,
                    replayPending,
                    onlyRemoteSessionPending,
                    ackReplayed,
                    pendingCount: pendingEvents.length,
                    replayedCount: replayedEventIds.length,
                    replayedEventIds,
                    ackedCount,
                    scope,
                    arbitration,
                });
                return;
            }
            if (command.type === 'close_remote_session') {
                const remoteSessionId = getString(payload.remoteSessionId) ?? '';
                if (!remoteSessionId) {
                    emitInvalidPayload('close_remote_session_response', { remoteSessionId });
                    return;
                }
                const state = deps.remoteSessionStore?.get(remoteSessionId);
                const taskId = getString(payload.taskId)
                    ?? state?.taskId
                    ?? remoteSessionToTaskId.get(remoteSessionId)
                    ?? '';
                if (!taskId) {
                    emitFor('close_remote_session_response', {
                        success: false,
                        remoteSessionId,
                        error: 'remote_session_not_found',
                    });
                    return;
                }
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('close_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                const policyDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId,
                    source: 'remote_session_close',
                    payload,
                });
                if (!policyDecision.allowed) {
                    emitFor('close_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: `policy_denied:${policyDecision.reason}`,
                    });
                    return;
                }
                const closed = closeRemoteSessionRecord(remoteSessionId);
                if (!closed.success) {
                    emitFor('close_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: 'remote_session_not_found',
                    });
                    return;
                }
                unbindRemoteSession(remoteSessionId);
                appendTranscript(taskId, 'system', `Remote session closed: ${remoteSessionId}`);
                emit({
                    type: 'TASK_EVENT',
                    taskId,
                    payload: {
                        type: 'remote_session',
                        action: 'closed',
                        remoteSessionId,
                        at: getNowIso(),
                    },
                });
                emitFor('close_remote_session_response', {
                    success: true,
                    taskId,
                    remoteSessionId,
                    remoteSession: closed.state ?? null,
                });
                return;
            }
            if (command.type === 'bind_remote_session') {
                const taskId = getString(payload.taskId) ?? '';
                const remoteSessionId = getString(payload.remoteSessionId) ?? '';
                if (!taskId || !remoteSessionId) {
                    emitInvalidPayload('bind_remote_session_response', { taskId, remoteSessionId });
                    return;
                }
                const metadata = toOptionalRecord(payload.metadata);
                const scope = parseRemoteSessionScope(payload, metadata);
                const scopedMetadata = withRemoteSessionScopeMetadata(metadata, scope);
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('bind_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                const policyDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId,
                    source: 'remote_session_bind',
                    payload,
                });
                if (!policyDecision.allowed) {
                    emitFor('bind_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: `policy_denied:${policyDecision.reason}`,
                    });
                    return;
                }
                const governance = evaluateRemoteSessionGovernance({
                    remoteSessionId,
                    targetTaskId: taskId,
                    scope,
                    metadata: scopedMetadata,
                });
                if (!governance.allowed) {
                    emitFor('bind_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: governance.error ?? 'remote_session_governance_denied',
                        remoteSession: governance.existingState ?? null,
                    });
                    return;
                }
                const arbitration = governance.arbitration ?? { action: 'none' as const };
                if (
                    arbitration.action !== 'none'
                    && governance.existingState
                    && governance.existingState.taskId !== taskId
                ) {
                    closeRemoteSessionRecord(remoteSessionId);
                    unbindRemoteSession(remoteSessionId);
                }
                const existing = taskStates.get(taskId);
                upsertTaskState(taskId, {
                    title: getString(payload.title) ?? existing?.title ?? 'Task',
                    workspacePath: getString(payload.workspacePath) ?? existing?.workspacePath ?? process.cwd(),
                    status: existing?.status ?? 'idle',
                    suspended: existing?.suspended,
                    suspensionReason: existing?.suspensionReason,
                    resourceId: resolveTaskResourceId(taskId, payload, existing?.resourceId),
                });
                const upserted = upsertRemoteSessionRecord({
                    remoteSessionId,
                    taskId,
                    channel: getString(payload.channel) ?? undefined,
                    metadata: scopedMetadata,
                });
                if (!upserted.success) {
                    emitFor('bind_remote_session_response', {
                        success: false,
                        taskId,
                        remoteSessionId,
                        error: upserted.conflict ? 'remote_session_task_conflict' : 'remote_session_bind_failed',
                        remoteSession: upserted.state ?? null,
                        arbitration,
                    });
                    return;
                }
                bindRemoteSessionToTask(taskId, remoteSessionId);
                appendTranscript(taskId, 'system', `Remote session linked: ${remoteSessionId}`);
                emitHookEvent('RemoteSessionLinked', {
                    taskId,
                    payload: {
                        remoteSessionId,
                        channel: getString(payload.channel) ?? null,
                        source: 'bind_remote_session',
                        scope,
                        arbitration,
                    },
                });
                emitFor('bind_remote_session_response', {
                    success: true,
                    taskId,
                    remoteSessionId,
                    remoteSession: upserted.state ?? null,
                    scope,
                    arbitration,
                });
                return;
            }
            if (command.type === 'inject_channel_event') {
                const resolvedTaskId = resolveTaskIdForExternalEvent(payload);
                const channel = getString(payload.channel) ?? '';
                if (!resolvedTaskId || !channel) {
                    emitInvalidPayload('inject_channel_event_response', {
                        taskId: resolvedTaskId ?? '',
                        channel,
                    });
                    return;
                }
                const policyDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId: resolvedTaskId,
                    source: 'channel_injection',
                    payload,
                });
                if (!policyDecision.allowed) {
                    emitFor('inject_channel_event_response', {
                        success: false,
                        taskId: resolvedTaskId,
                        channel,
                        error: `policy_denied:${policyDecision.reason}`,
                    });
                    return;
                }
                const existing = taskStates.get(resolvedTaskId);
                upsertTaskState(resolvedTaskId, {
                    title: existing?.title ?? 'Task',
                    workspacePath: existing?.workspacePath ?? process.cwd(),
                    status: existing?.status ?? 'idle',
                    suspended: existing?.suspended,
                    suspensionReason: existing?.suspensionReason,
                    resourceId: existing?.resourceId ?? resolveTaskResourceId(resolvedTaskId, payload, undefined),
                });
                const eventType = getString(payload.eventType) ?? 'message';
                const content = getString(payload.content) ?? '';
                const remoteSessionId = getString(payload.remoteSessionId) ?? undefined;
                const metadata = toOptionalRecord(payload.metadata);
                const remoteScope = parseRemoteSessionScope(payload, metadata);
                const scopedMetadata = withRemoteSessionScopeMetadata(metadata, remoteScope);
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('inject_channel_event_response', {
                        success: false,
                        taskId: resolvedTaskId,
                        channel,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                const eventId = getString(payload.eventId) ?? getString(payload.deliveryId) ?? undefined;
                const forceRequeue = payload.forceRequeue === true;
                const delivery = enqueueChannelDeliveryEvent({
                    taskId: resolvedTaskId,
                    remoteSessionId,
                    channel,
                    eventType,
                    content,
                    metadata: scopedMetadata,
                    eventId,
                    forceRequeue,
                });
                if (remoteSessionId) {
                    const upserted = upsertRemoteSessionRecord({
                        remoteSessionId,
                        taskId: resolvedTaskId,
                        channel,
                        metadata: scopedMetadata,
                    });
                    if (upserted.success) {
                        bindRemoteSessionToTask(resolvedTaskId, remoteSessionId);
                        heartbeatRemoteSessionRecord(remoteSessionId, scopedMetadata);
                    }
                }
                if (!delivery.deduplicated || forceRequeue) {
                    appendTranscript(
                        resolvedTaskId,
                        'system',
                        `[Channel:${channel}] ${eventType}${content ? ` — ${content}` : ''}`,
                    );
                    emitHookEvent('ChannelEventInjected', {
                        taskId: resolvedTaskId,
                        payload: {
                            channel,
                            eventType,
                            content,
                            remoteSessionId,
                            metadata: scopedMetadata ?? {},
                            deliveryId: delivery.event.id,
                        },
                    });
                    emit({
                        type: 'TASK_EVENT',
                        taskId: resolvedTaskId,
                        payload: {
                            type: 'channel_event',
                            action: delivery.requeued ? 'requeued' : 'injected',
                            deduplicated: false,
                            deliveryId: delivery.event.id,
                            channel,
                            eventType,
                            content,
                            remoteSessionId: remoteSessionId ?? null,
                            metadata: scopedMetadata ?? {},
                            injectedAt: getNowIso(),
                        },
                    });
                }
                emitFor('inject_channel_event_response', {
                    success: true,
                    taskId: resolvedTaskId,
                    channel,
                    eventType,
                    deduplicated: delivery.deduplicated,
                    requeued: delivery.requeued,
                    delivery: delivery.event,
                });
                return;
            }
            if (command.type === 'list_channel_delivery_events') {
                const taskId = getString(payload.taskId) ?? undefined;
                const remoteSessionId = getString(payload.remoteSessionId) ?? undefined;
                const statusRaw = getString(payload.status);
                const status = statusRaw === 'pending' || statusRaw === 'acked'
                    ? statusRaw
                    : undefined;
                const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
                    ? Math.min(1000, Math.floor(payload.limit))
                    : undefined;
                const resolvedTaskId = taskId
                    ?? (remoteSessionId ? remoteSessionToTaskId.get(remoteSessionId) : undefined);
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('list_channel_delivery_events_response', {
                        success: false,
                        taskId: resolvedTaskId ?? taskId ?? null,
                        remoteSessionId: remoteSessionId ?? null,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                if (resolvedTaskId) {
                    const policyDecision = applyPolicyDecision({
                        requestId: commandId,
                        action: 'task_command',
                        commandType: command.type,
                        taskId: resolvedTaskId,
                        source: 'channel_delivery_list',
                        payload,
                    });
                    if (!policyDecision.allowed) {
                        emitFor('list_channel_delivery_events_response', {
                            success: false,
                            taskId: resolvedTaskId,
                            remoteSessionId: remoteSessionId ?? null,
                            error: `policy_denied:${policyDecision.reason}`,
                        });
                        return;
                    }
                }
                const events = listChannelDeliveryEvents({
                    taskId: resolvedTaskId ?? taskId,
                    remoteSessionId,
                    status,
                    limit,
                });
                emitFor('list_channel_delivery_events_response', {
                    success: true,
                    taskId: resolvedTaskId ?? taskId ?? null,
                    remoteSessionId: remoteSessionId ?? null,
                    status: status ?? null,
                    events,
                    count: events.length,
                });
                return;
            }
            if (command.type === 'ack_channel_delivery_event') {
                const eventId = getString(payload.eventId) ?? '';
                if (!eventId) {
                    emitInvalidPayload('ack_channel_delivery_event_response', { eventId });
                    return;
                }
                const taskId = getString(payload.taskId) ?? undefined;
                const remoteSessionId = getString(payload.remoteSessionId) ?? undefined;
                const existingEvent = getChannelDeliveryEvent(eventId);
                const governanceRemoteSessionId = remoteSessionId ?? existingEvent?.remoteSessionId;
                const resolvedTaskId = taskId
                    ?? existingEvent?.taskId
                    ?? (remoteSessionId ? remoteSessionToTaskId.get(remoteSessionId) : undefined);
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, governanceRemoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('ack_channel_delivery_event_response', {
                        success: false,
                        taskId: resolvedTaskId ?? taskId ?? null,
                        remoteSessionId: governanceRemoteSessionId ?? null,
                        eventId,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                if (resolvedTaskId) {
                    const policyDecision = applyPolicyDecision({
                        requestId: commandId,
                        action: 'task_command',
                        commandType: command.type,
                        taskId: resolvedTaskId,
                        source: 'channel_delivery_ack',
                        payload,
                    });
                    if (!policyDecision.allowed) {
                        emitFor('ack_channel_delivery_event_response', {
                            success: false,
                            taskId: resolvedTaskId,
                            remoteSessionId: remoteSessionId ?? null,
                            eventId,
                            error: `policy_denied:${policyDecision.reason}`,
                        });
                        return;
                    }
                }
                const acked = ackChannelDeliveryEvent({
                    eventId,
                    taskId: resolvedTaskId ?? taskId,
                    remoteSessionId: remoteSessionId ?? existingEvent?.remoteSessionId,
                    metadata: toRecord(payload.metadata),
                });
                if (!acked.success) {
                    emitFor('ack_channel_delivery_event_response', {
                        success: false,
                        taskId: resolvedTaskId ?? taskId ?? null,
                        remoteSessionId: remoteSessionId ?? null,
                        eventId,
                        error: 'channel_delivery_event_not_found',
                    });
                    return;
                }
                if (acked.event?.taskId) {
                    emit({
                        type: 'TASK_EVENT',
                        taskId: acked.event.taskId,
                        payload: {
                            type: 'channel_event_delivery',
                            action: 'acked',
                            deliveryId: acked.event.id,
                            remoteSessionId: acked.event.remoteSessionId ?? null,
                            ackedAt: acked.event.ackedAt ?? getNowIso(),
                        },
                    });
                }
                emitFor('ack_channel_delivery_event_response', {
                    success: true,
                    taskId: acked.event?.taskId ?? resolvedTaskId ?? null,
                    remoteSessionId: acked.event?.remoteSessionId ?? remoteSessionId ?? null,
                    event: acked.event ?? null,
                });
                return;
            }
            if (command.type === 'replay_channel_delivery_events') {
                const taskId = getString(payload.taskId) ?? undefined;
                const remoteSessionId = getString(payload.remoteSessionId) ?? undefined;
                const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
                    ? Math.min(100, Math.floor(payload.limit))
                    : 20;
                const ackOnReplay = payload.ackOnReplay === true;
                const resolvedTaskId = taskId
                    ?? (remoteSessionId ? remoteSessionToTaskId.get(remoteSessionId) : undefined);
                const tenantGovernance = evaluateManagedTenantCommandGovernance(payload, remoteSessionId);
                if (!tenantGovernance.allowed) {
                    emitFor('replay_channel_delivery_events_response', {
                        success: false,
                        taskId: resolvedTaskId ?? taskId ?? null,
                        remoteSessionId: remoteSessionId ?? null,
                        error: tenantGovernance.error,
                        remoteSession: tenantGovernance.remoteSession,
                    });
                    return;
                }
                if (!resolvedTaskId) {
                    emitInvalidPayload('replay_channel_delivery_events_response', {
                        taskId: taskId ?? '',
                        remoteSessionId: remoteSessionId ?? '',
                    });
                    return;
                }
                const policyDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId: resolvedTaskId,
                    source: 'channel_delivery_replay',
                    payload,
                });
                if (!policyDecision.allowed) {
                    emitFor('replay_channel_delivery_events_response', {
                        success: false,
                        taskId: resolvedTaskId,
                        remoteSessionId: remoteSessionId ?? null,
                        error: `policy_denied:${policyDecision.reason}`,
                    });
                    return;
                }
                const events = listChannelDeliveryEvents({
                    taskId: resolvedTaskId,
                    remoteSessionId,
                    status: 'pending',
                    limit,
                });
                let ackedCount = 0;
                for (const event of events) {
                    const delivered = markChannelDeliveryDelivered({
                        eventId: event.id,
                        taskId: event.taskId,
                        remoteSessionId: event.remoteSessionId ?? remoteSessionId,
                    });
                    const replayEvent = delivered.event ?? event;
                    emit({
                        type: 'TASK_EVENT',
                        taskId: event.taskId,
                        payload: {
                            type: 'channel_event',
                            action: 'replayed',
                            deliveryId: replayEvent.id,
                            channel: replayEvent.channel,
                            eventType: replayEvent.eventType,
                            content: replayEvent.content ?? '',
                            remoteSessionId: replayEvent.remoteSessionId ?? null,
                            metadata: replayEvent.metadata ?? {},
                            deliveryAttempts: replayEvent.deliveryAttempts ?? 0,
                            replayedAt: getNowIso(),
                        },
                    });
                    if (ackOnReplay) {
                        const acked = ackChannelDeliveryEvent({
                            eventId: replayEvent.id,
                            taskId: replayEvent.taskId,
                            remoteSessionId: replayEvent.remoteSessionId,
                            metadata: {
                                source: 'replay_channel_delivery_events',
                            },
                        });
                        if (acked.success) {
                            ackedCount += 1;
                        }
                    }
                }
                emitFor('replay_channel_delivery_events_response', {
                    success: true,
                    taskId: resolvedTaskId,
                    remoteSessionId: remoteSessionId ?? null,
                    replayedCount: events.length,
                    replayedEventIds: events.map((event) => event.id),
                    ackedCount,
                });
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
            if (command.type === 'start_task' || command.type === 'send_task_message') {
                const taskId = getString(payload.taskId) ?? '';
                const message = command.type === 'start_task'
                    ? getString(payload.userQuery)
                    : getString(payload.content);
                if (!taskId || !message) {
                    emitCurrentInvalidPayload({ taskId });
                    return;
                }
                const taskCommandDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'task_command',
                    commandType: command.type,
                    taskId,
                    source: 'entrypoint',
                    payload,
                });
                if (!taskCommandDecision.allowed) {
                    emitCurrent({
                        success: false,
                        taskId,
                        error: `policy_denied:${taskCommandDecision.reason}`,
                    });
                    return;
                }
                appendTranscript(taskId, 'user', message);
                const workspacePath = getString(toRecord(payload.context).workspacePath) ?? process.cwd();
                const commandConfig = toRecord(payload.config);
                const explicitEnabledSkills = pickStringArrayConfigValue(commandConfig, 'enabledSkills');
                const retryConfig = pickTaskRuntimeRetryConfig(commandConfig);
                const resolvedSkillPrompt = deps.resolveSkillPrompt
                    ? deps.resolveSkillPrompt({
                        message,
                        workspacePath,
                        explicitEnabledSkills,
                    })
                    : {
                        prompt: undefined,
                        enabledSkillIds: explicitEnabledSkills ?? [],
                    };
                const executionOptions: UserMessageExecutionOptions = {
                    enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                    skillPrompt: resolvedSkillPrompt.prompt,
                    requireToolApproval: pickBooleanConfigValue(commandConfig, 'requireToolApproval'),
                    autoResumeSuspendedTools: pickBooleanConfigValue(commandConfig, 'autoResumeSuspendedTools'),
                    toolCallConcurrency: pickPositiveIntegerConfigValue(commandConfig, 'toolCallConcurrency', 1, 32),
                    maxSteps: pickPositiveIntegerConfigValue(commandConfig, 'maxSteps', 1, 128),
                };
                const previousState = taskStates.get(taskId);
                const resourceId = resolveTaskResourceId(taskId, payload, previousState?.resourceId);
                const nextRetryState: TaskRuntimeRetryState | undefined = retryConfig
                    ? retryConfig
                    : (previousState?.retry
                        ? {
                            ...previousState.retry,
                            attempts: 0,
                            lastRetryAt: undefined,
                            lastError: undefined,
                        }
                        : undefined);
                if (
                    command.type === 'send_task_message'
                    && deps.cancelScheduledTasksForSourceTask
                    && isScheduledCancellationRequest(message)
                ) {
                    const cancelled = await deps.cancelScheduledTasksForSourceTask({
                        sourceTaskId: taskId,
                        userMessage: message,
                    });
                    upsertTaskState(taskId, {
                        title: getString(payload.title) ?? previousState?.title ?? 'Task',
                        workspacePath,
                        status: 'idle',
                        suspended: false,
                        suspensionReason: undefined,
                        lastUserMessage: message,
                        enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                        resourceId,
                        checkpoint: undefined,
                        retry: nextRetryState,
                    });
                    emitFor('send_task_message_response', {
                        success: true,
                        taskId,
                    });
                    const cancellationSummary = cancelled.cancelledCount > 0
                        ? `已取消 ${cancelled.cancelledCount} 个定时任务。`
                        : '没有可取消的定时任务。';
                    emitTaskSummary({
                        taskId,
                        summary: cancellationSummary,
                        finishReason: 'scheduled_cancel',
                    });
                    return;
                }
                if (deps.scheduleTaskIfNeeded) {
                    const scheduleDecision = await deps.scheduleTaskIfNeeded({
                        sourceTaskId: taskId,
                        title: getString(payload.title) ?? undefined,
                        message,
                        workspacePath,
                        config: toRecord(payload.config),
                    });
                    if (scheduleDecision.error) {
                        emitCurrent({
                            success: false,
                            taskId,
                            error: scheduleDecision.error,
                        });
                        return;
                    }
                    if (scheduleDecision.scheduled) {
                        upsertTaskState(taskId, {
                            title: getString(payload.title) ?? previousState?.title ?? 'Task',
                            workspacePath,
                            status: 'scheduled',
                            suspended: false,
                            suspensionReason: undefined,
                            lastUserMessage: message,
                            enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                            resourceId,
                            checkpoint: undefined,
                            retry: nextRetryState,
                        });
                        if (command.type === 'start_task') {
                            emitTaskStarted({
                                taskId,
                                title: getString(payload.title) ?? 'Task',
                                message,
                                workspacePath,
                                scheduled: true,
                            });
                        }
                        emitCurrent({
                            success: true,
                            taskId,
                        });
                        const summary = scheduleDecision.summary ?? '已安排定时任务。';
                        emitTaskSummary({
                            taskId,
                            summary,
                            finishReason: 'scheduled',
                        });
                        return;
                    }
                }
                const state = upsertTaskState(taskId, {
                    title: getString(payload.title) ?? taskStates.get(taskId)?.title ?? 'Task',
                    workspacePath,
                    status: 'running',
                    suspended: false,
                    suspensionReason: undefined,
                    lastUserMessage: message,
                    enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                    resourceId,
                    checkpoint: undefined,
                    retry: nextRetryState,
                });
                if (command.type === 'start_task') {
                    emitHookEvent('SessionStart', {
                        taskId,
                        payload: {
                            threadId: state.conversationThreadId,
                            workspacePath: state.workspacePath,
                            resourceId: state.resourceId,
                        },
                    });
                    emitHookEvent('TaskCreated', {
                        taskId,
                        payload: {
                            title: state.title,
                            workspacePath: state.workspacePath,
                            enabledSkills: state.enabledSkills ?? [],
                        },
                    });
                    emitTaskStarted({
                        taskId,
                        title: getString(payload.title) ?? 'Task',
                        message,
                        workspacePath,
                    });
                }
                emitCurrent({
                    success: true,
                    taskId,
                });
                await runUserMessageWithThreadRecovery({
                    taskId,
                    message,
                    resourceId,
                    preferredThreadId: state.conversationThreadId,
                    workspacePath: state.workspacePath,
                    executionOptions,
                });
                return;
            }
            if (command.type === 'resume_interrupted_task') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('resume_interrupted_task_response', { taskId });
                    return;
                }
                const operationId = resolveTaskOperationId(payload, `resume:${commandId}:${taskId}`);
                const existing = taskStates.get(taskId);
                const currentCheckpointVersion = resolveTaskCheckpointVersion(existing);
                const dedupedOperation = findTaskOperationRecord(existing, operationId, ['resume', 'recover_resume']);
                if (dedupedOperation) {
                    emitFor('resume_interrupted_task_response', {
                        success: true,
                        taskId,
                        operationId,
                        deduplicated: true,
                        checkpointVersion: currentCheckpointVersion,
                        status: existing?.status ?? null,
                    });
                    return;
                }
                const expectedCheckpointVersion = resolveExpectedCheckpointVersion(payload);
                if (
                    typeof expectedCheckpointVersion === 'number'
                    && expectedCheckpointVersion !== currentCheckpointVersion
                ) {
                    emitFor('resume_interrupted_task_response', {
                        success: false,
                        taskId,
                        operationId,
                        error: 'checkpoint_version_conflict',
                        expectedCheckpointVersion,
                        currentCheckpointVersion,
                    });
                    return;
                }
                if (
                    typeof expectedCheckpointVersion === 'number'
                    && !existing?.checkpoint
                ) {
                    emitFor('resume_interrupted_task_response', {
                        success: false,
                        taskId,
                        operationId,
                        error: 'checkpoint_not_available',
                        expectedCheckpointVersion,
                        currentCheckpointVersion,
                    });
                    return;
                }
                const operationRecord: TaskRuntimeOperationRecord = {
                    operationId,
                    action: 'resume',
                    at: getNowIso(),
                    result: 'applied',
                    checkpointVersion: currentCheckpointVersion,
                };
                const state = upsertTaskState(taskId, {
                    status: 'running',
                    suspended: false,
                    suspensionReason: undefined,
                    checkpoint: undefined,
                    checkpointVersion: currentCheckpointVersion,
                    operationLog: appendTaskOperationRecord(existing, operationRecord),
                    resourceId: resolveTaskResourceId(taskId, payload, taskStates.get(taskId)?.resourceId),
                });
                const resumeMessage = state.lastUserMessage ?? 'Continue from the saved task context.';
                emitFor('resume_interrupted_task_response', {
                    success: true,
                    taskId,
                    operationId,
                    deduplicated: false,
                    checkpointVersion: currentCheckpointVersion,
                });
                appendTranscript(taskId, 'system', 'Task resumed after interruption.');
                await runUserMessageWithThreadRecovery({
                    taskId,
                    message: resumeMessage,
                    resourceId: state.resourceId,
                    preferredThreadId: state.conversationThreadId,
                    workspacePath: state.workspacePath,
                    executionOptions: {
                        enabledSkills: state.enabledSkills,
                    },
                });
                return;
            }
            if (command.type === 'set_task_checkpoint') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('set_task_checkpoint_response', { taskId });
                    return;
                }
                const operationId = resolveTaskOperationId(payload, `set_checkpoint:${commandId}:${taskId}`);
                const existing = taskStates.get(taskId);
                const dedupedOperation = findTaskOperationRecord(existing, operationId, ['set_checkpoint']);
                if (dedupedOperation) {
                    emitFor('set_task_checkpoint_response', {
                        success: true,
                        taskId,
                        operationId,
                        deduplicated: true,
                        state: existing
                            ? {
                                taskId: existing.taskId,
                                status: existing.status,
                                suspended: existing.suspended,
                                suspensionReason: existing.suspensionReason,
                                checkpoint: existing.checkpoint ?? null,
                                checkpointVersion: resolveTaskCheckpointVersion(existing),
                            }
                            : null,
                    });
                    return;
                }
                const currentCheckpointVersion = resolveTaskCheckpointVersion(existing);
                const expectedCheckpointVersion = resolveExpectedCheckpointVersion(payload);
                if (
                    typeof expectedCheckpointVersion === 'number'
                    && expectedCheckpointVersion !== currentCheckpointVersion
                ) {
                    emitFor('set_task_checkpoint_response', {
                        success: false,
                        taskId,
                        operationId,
                        error: 'checkpoint_version_conflict',
                        expectedCheckpointVersion,
                        currentCheckpointVersion,
                    });
                    return;
                }
                const nextCheckpointVersion = currentCheckpointVersion + 1;
                const checkpointId = getString(payload.checkpointId) ?? `checkpoint:${createId()}`;
                const checkpointLabel = getString(payload.label) ?? 'Manual checkpoint';
                const checkpoint: TaskRuntimeCheckpoint = {
                    id: checkpointId,
                    label: checkpointLabel,
                    at: getNowIso(),
                    version: nextCheckpointVersion,
                    metadata: toRecord(payload.metadata),
                };
                const operationRecord: TaskRuntimeOperationRecord = {
                    operationId,
                    action: 'set_checkpoint',
                    at: getNowIso(),
                    result: 'applied',
                    checkpointVersion: nextCheckpointVersion,
                };
                const state = upsertTaskState(taskId, {
                    title: getString(payload.title) ?? taskStates.get(taskId)?.title ?? 'Task',
                    workspacePath: getString(payload.workspacePath) ?? taskStates.get(taskId)?.workspacePath ?? process.cwd(),
                    status: 'suspended',
                    suspended: true,
                    suspensionReason: getString(payload.reason) ?? 'checkpoint',
                    checkpoint,
                    checkpointVersion: nextCheckpointVersion,
                    operationLog: appendTaskOperationRecord(existing, operationRecord),
                    resourceId: resolveTaskResourceId(taskId, payload, taskStates.get(taskId)?.resourceId),
                });
                appendTranscript(taskId, 'system', `Checkpoint set: ${checkpoint.label}`);
                emit({
                    type: 'TASK_EVENT',
                    taskId,
                    payload: {
                        type: 'checkpoint',
                        action: 'set',
                        checkpoint,
                    },
                });
                emitFor('set_task_checkpoint_response', {
                    success: true,
                    taskId,
                    operationId,
                    deduplicated: false,
                    state: {
                        taskId: state.taskId,
                        status: state.status,
                        suspended: state.suspended,
                        suspensionReason: state.suspensionReason,
                        checkpoint: state.checkpoint ?? null,
                        checkpointVersion: state.checkpointVersion ?? resolveTaskCheckpointVersion(state),
                    },
                });
                return;
            }
            if (command.type === 'retry_task') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('retry_task_response', { taskId });
                    return;
                }
                const existing = taskStates.get(taskId);
                if (!existing) {
                    emitFor('retry_task_response', {
                        success: false,
                        taskId,
                        operationId: resolveTaskOperationId(payload, `retry:${commandId}:${taskId}`),
                        error: 'task_not_found',
                    });
                    return;
                }
                const operationId = resolveTaskOperationId(payload, `retry:${commandId}:${taskId}`);
                const dedupedOperation = findTaskOperationRecord(existing, operationId, ['retry', 'recover_retry']);
                if (dedupedOperation) {
                    emitFor('retry_task_response', {
                        success: true,
                        taskId,
                        operationId,
                        deduplicated: true,
                        checkpointVersion: resolveTaskCheckpointVersion(existing),
                        attempt: existing.retry?.attempts ?? 0,
                        retry: existing.retry ?? null,
                    });
                    return;
                }
                const currentCheckpointVersion = resolveTaskCheckpointVersion(existing);
                const expectedCheckpointVersion = resolveExpectedCheckpointVersion(payload);
                if (
                    typeof expectedCheckpointVersion === 'number'
                    && expectedCheckpointVersion !== currentCheckpointVersion
                ) {
                    emitFor('retry_task_response', {
                        success: false,
                        taskId,
                        operationId,
                        error: 'checkpoint_version_conflict',
                        expectedCheckpointVersion,
                        currentCheckpointVersion,
                    });
                    return;
                }
                if (
                    typeof expectedCheckpointVersion === 'number'
                    && !existing.checkpoint
                ) {
                    emitFor('retry_task_response', {
                        success: false,
                        taskId,
                        operationId,
                        error: 'checkpoint_not_available',
                        expectedCheckpointVersion,
                        currentCheckpointVersion,
                    });
                    return;
                }
                if (!isRetryableTaskStatus(existing.status)) {
                    emitFor('retry_task_response', {
                        success: false,
                        taskId,
                        operationId,
                        error: 'task_status_not_retryable',
                        status: existing.status,
                    });
                    return;
                }
                const retry = existing.retry ?? { attempts: 0 };
                const nextAttempts = retry.attempts + 1;
                if (typeof retry.maxAttempts === 'number' && nextAttempts > retry.maxAttempts) {
                    emitFor('retry_task_response', {
                        success: false,
                        taskId,
                        operationId,
                        error: 'retry_limit_reached',
                        retry: retry,
                    });
                    return;
                }
                const retryMessage = getString(payload.message) ?? existing.lastUserMessage ?? 'Retry the last task context.';
                const operationRecord: TaskRuntimeOperationRecord = {
                    operationId,
                    action: 'retry',
                    at: getNowIso(),
                    result: 'applied',
                    checkpointVersion: currentCheckpointVersion,
                    retryAttempts: nextAttempts,
                };
                const updated = upsertTaskState(taskId, {
                    status: 'retrying',
                    suspended: false,
                    suspensionReason: undefined,
                    checkpoint: undefined,
                    checkpointVersion: currentCheckpointVersion,
                    lastUserMessage: retryMessage,
                    retry: {
                        attempts: nextAttempts,
                        maxAttempts: retry.maxAttempts,
                        lastRetryAt: getNowIso(),
                        lastError: undefined,
                    },
                    operationLog: appendTaskOperationRecord(existing, operationRecord),
                });
                appendTranscript(taskId, 'system', `Retry requested (attempt ${nextAttempts}).`);
                emit({
                    type: 'TASK_EVENT',
                    taskId,
                    payload: {
                        type: 'retry',
                        attempt: nextAttempts,
                        maxAttempts: updated.retry?.maxAttempts ?? null,
                        message: retryMessage,
                    },
                });
                emitFor('retry_task_response', {
                    success: true,
                    taskId,
                    operationId,
                    deduplicated: false,
                    checkpointVersion: currentCheckpointVersion,
                    attempt: nextAttempts,
                    retry: updated.retry ?? null,
                });
                await runUserMessageWithThreadRecovery({
                    taskId,
                    message: retryMessage,
                    resourceId: updated.resourceId,
                    preferredThreadId: updated.conversationThreadId,
                    workspacePath: updated.workspacePath,
                    executionOptions: {
                        enabledSkills: updated.enabledSkills,
                    },
                });
                return;
            }
            if (command.type === 'recover_tasks') {
                const taskIdFilter = getString(payload.taskId) ?? undefined;
                const workspacePathFilter = getString(payload.workspacePath) ?? undefined;
                const recoveryOperationId = resolveTaskOperationId(payload, `recover:${commandId}`);
                const mode = payload.mode === 'resume' || payload.mode === 'retry' || payload.mode === 'auto'
                    ? payload.mode
                    : 'auto';
                const dryRun = payload.dryRun === true;
                const limit = typeof payload.limit === 'number' && Number.isFinite(payload.limit) && payload.limit > 0
                    ? Math.min(100, Math.floor(payload.limit))
                    : 20;
                const statusFilterSet = Array.isArray(payload.statuses)
                    ? new Set(
                        payload.statuses
                            .filter((item): item is string => typeof item === 'string')
                            .filter((item) =>
                                item === 'interrupted'
                                || item === 'suspended'
                                || item === 'failed'
                                || item === 'retrying',
                            ),
                    )
                    : new Set(['interrupted', 'suspended', 'failed', 'retrying']);
                const candidates = Array
                    .from(taskStates.values())
                    .filter((state) => !taskIdFilter || state.taskId === taskIdFilter)
                    .filter((state) => !workspacePathFilter || state.workspacePath === workspacePathFilter)
                    .filter((state) => statusFilterSet.has(state.status))
                    .slice(0, limit);
                if (candidates.length === 0) {
                    emitFor('recover_tasks_response', {
                        success: true,
                        operationId: recoveryOperationId,
                        mode,
                        dryRun,
                        count: 0,
                        recoveredCount: 0,
                        skippedCount: 0,
                        items: [],
                    });
                    return;
                }
                const primaryTaskForPolicy = candidates[0]?.taskId;
                if (primaryTaskForPolicy) {
                    const policyDecision = applyPolicyDecision({
                        requestId: commandId,
                        action: 'task_command',
                        commandType: command.type,
                        taskId: primaryTaskForPolicy,
                        source: 'recover_tasks',
                        payload,
                    });
                    if (!policyDecision.allowed) {
                        emitFor('recover_tasks_response', {
                            success: false,
                            operationId: recoveryOperationId,
                            mode,
                            dryRun,
                            error: `policy_denied:${policyDecision.reason}`,
                        });
                        return;
                    }
                }
                const results: Array<Record<string, unknown>> = [];
                let recoveredCount = 0;
                for (const state of candidates) {
                    const latestState = taskStates.get(state.taskId) ?? state;
                    const checkpoint = state.checkpoint;
                    const retry = state.retry ?? { attempts: 0 };
                    const canRetry =
                        state.status === 'failed'
                        || state.status === 'retrying'
                        || state.status === 'interrupted'
                        || state.status === 'suspended';
                    const retryLimitReached = typeof retry.maxAttempts === 'number'
                        && retry.attempts >= retry.maxAttempts;
                    const shouldSkipSuspendedApproval =
                        state.status === 'suspended' && state.suspensionReason === 'approval_required';

                    let action: 'resume' | 'retry' | 'skip' = 'skip';
                    let reason = 'no_recovery_action';
                    if (mode === 'resume') {
                        if (state.status === 'interrupted' || state.status === 'suspended') {
                            if (shouldSkipSuspendedApproval) {
                                reason = 'awaiting_manual_approval';
                            } else {
                                action = 'resume';
                                reason = 'resume_mode';
                            }
                        } else {
                            reason = 'status_not_resumable';
                        }
                    } else if (mode === 'retry') {
                        if (!canRetry) {
                            reason = 'status_not_retryable';
                        } else if (retryLimitReached) {
                            reason = 'retry_limit_reached';
                        } else {
                            action = 'retry';
                            reason = 'retry_mode';
                        }
                    } else {
                        if (state.status === 'failed' || state.status === 'retrying') {
                            if (retryLimitReached) {
                                reason = 'retry_limit_reached';
                            } else {
                                action = 'retry';
                                reason = 'auto_retry_failed';
                            }
                        } else if (state.status === 'interrupted' || state.status === 'suspended') {
                            if (shouldSkipSuspendedApproval) {
                                reason = 'awaiting_manual_approval';
                            } else {
                                action = 'resume';
                                reason = 'auto_resume_interrupted';
                            }
                        } else {
                            reason = 'status_not_recoverable';
                        }
                    }

                    const result: Record<string, unknown> = {
                        taskId: state.taskId,
                        statusBefore: state.status,
                        action,
                        reason,
                        dryRun,
                        checkpoint: checkpoint ?? null,
                        checkpointVersion: resolveTaskCheckpointVersion(latestState),
                    };
                    const recoverAction: TaskRuntimeOperationAction | null = action === 'resume'
                        ? 'recover_resume'
                        : (action === 'retry' ? 'recover_retry' : null);
                    const taskOperationId = recoverAction
                        ? `${recoveryOperationId}:${state.taskId}:${recoverAction}`
                        : null;
                    if (taskOperationId && recoverAction) {
                        result.operationId = taskOperationId;
                        const dedupedOperation = findTaskOperationRecord(latestState, taskOperationId, [recoverAction]);
                        if (dedupedOperation) {
                            result.action = 'skip';
                            result.reason = 'duplicate_operation';
                            result.deduplicated = true;
                            result.statusAfter = latestState.status;
                            results.push(result);
                            continue;
                        }
                    }
                    if (action === 'skip' || dryRun) {
                        results.push(result);
                        continue;
                    }

                    try {
                        if (action === 'resume') {
                            const resumeState = taskStates.get(state.taskId) ?? state;
                            const checkpointVersion = resolveTaskCheckpointVersion(resumeState);
                            const operationRecord: TaskRuntimeOperationRecord = {
                                operationId: taskOperationId ?? `${recoveryOperationId}:${state.taskId}:recover_resume`,
                                action: 'recover_resume',
                                at: getNowIso(),
                                result: 'applied',
                                checkpointVersion,
                            };
                            const resumed = upsertTaskState(state.taskId, {
                                status: 'running',
                                suspended: false,
                                suspensionReason: undefined,
                                checkpoint: undefined,
                                checkpointVersion,
                                operationLog: appendTaskOperationRecord(resumeState, operationRecord),
                            });
                            const resumeMessage = resumed.lastUserMessage ?? 'Continue from the saved task context.';
                            appendTranscript(state.taskId, 'system', `Task auto-recovered by resume (${mode}).`);
                            await runUserMessageWithThreadRecovery({
                                taskId: state.taskId,
                                message: resumeMessage,
                                resourceId: resumed.resourceId,
                                preferredThreadId: resumed.conversationThreadId,
                                workspacePath: resumed.workspacePath,
                                executionOptions: {
                                    enabledSkills: resumed.enabledSkills,
                                },
                            });
                            result.statusAfter = taskStates.get(state.taskId)?.status ?? resumed.status;
                            result.deduplicated = false;
                            recoveredCount += 1;
                            results.push(result);
                            continue;
                        }
                        const nextAttempts = retry.attempts + 1;
                        const retryMessage = state.lastUserMessage ?? 'Retry the last task context.';
                        const retryState = taskStates.get(state.taskId) ?? state;
                        const checkpointVersion = resolveTaskCheckpointVersion(retryState);
                        const operationRecord: TaskRuntimeOperationRecord = {
                            operationId: taskOperationId ?? `${recoveryOperationId}:${state.taskId}:recover_retry`,
                            action: 'recover_retry',
                            at: getNowIso(),
                            result: 'applied',
                            checkpointVersion,
                            retryAttempts: nextAttempts,
                        };
                        const retried = upsertTaskState(state.taskId, {
                            status: 'retrying',
                            suspended: false,
                            suspensionReason: undefined,
                            checkpoint: undefined,
                            checkpointVersion,
                            lastUserMessage: retryMessage,
                            retry: {
                                attempts: nextAttempts,
                                maxAttempts: retry.maxAttempts,
                                lastRetryAt: getNowIso(),
                                lastError: undefined,
                            },
                            operationLog: appendTaskOperationRecord(retryState, operationRecord),
                        });
                        appendTranscript(state.taskId, 'system', `Task auto-recovered by retry (${mode}), attempt ${nextAttempts}.`);
                        emit({
                            type: 'TASK_EVENT',
                            taskId: state.taskId,
                            payload: {
                                type: 'retry',
                                attempt: nextAttempts,
                                maxAttempts: retried.retry?.maxAttempts ?? null,
                                message: retryMessage,
                                source: 'recover_tasks',
                            },
                        });
                        await runUserMessageWithThreadRecovery({
                            taskId: state.taskId,
                            message: retryMessage,
                            resourceId: retried.resourceId,
                            preferredThreadId: retried.conversationThreadId,
                            workspacePath: retried.workspacePath,
                            executionOptions: {
                                enabledSkills: retried.enabledSkills,
                            },
                        });
                        result.attempt = nextAttempts;
                        result.statusAfter = taskStates.get(state.taskId)?.status ?? retried.status;
                        result.deduplicated = false;
                        recoveredCount += 1;
                        results.push(result);
                    } catch (error) {
                        result.error = error instanceof Error ? error.message : String(error);
                        result.statusAfter = taskStates.get(state.taskId)?.status ?? state.status;
                        results.push(result);
                    }
                }
                emitFor('recover_tasks_response', {
                    success: true,
                    operationId: recoveryOperationId,
                    mode,
                    dryRun,
                    count: results.length,
                    recoveredCount,
                    skippedCount: results.length - recoveredCount,
                    items: results,
                });
                return;
            }
            if (command.type === 'report_effect_result') {
                const requestId = getString(payload.requestId);
                const success = payload.success;
                if (!requestId || typeof success !== 'boolean') {
                    emitInvalidPayload('report_effect_result_response');
                    return;
                }
                const pending = pendingApprovals.get(requestId);
                if (!pending || !pending.runId) {
                    emitFor('report_effect_result_response', {
                        success: false,
                        requestId,
                        error: 'approval_request_not_found',
                    });
                    return;
                }
                pendingApprovals.delete(requestId);
                const approvalDecision = applyPolicyDecision({
                    requestId,
                    action: 'approval_result',
                    commandType: command.type,
                    taskId: pending.taskId,
                    source: 'effect_result',
                    payload: {
                        ...payload,
                        toolName: pending.toolName,
                        toolCallId: pending.toolCallId,
                    },
                    approved: success,
                });
                const approvedForRuntime = success && approvalDecision.allowed;
                if (success && !approvedForRuntime) {
                    appendTranscript(
                        pending.taskId,
                        'system',
                        `Approval denied by policy (${approvalDecision.reason}) for ${pending.toolName}.`,
                    );
                }
                await deps.handleApprovalResponse(
                    pending.runId,
                    pending.toolCallId,
                    approvedForRuntime,
                    (event) => emitDesktopEvent(pending.taskId, event, emit),
                );
                emitFor('report_effect_result_response', {
                    success: true,
                    requestId,
                    appliedApproval: approvedForRuntime,
                    policyDecision: {
                        allowed: approvalDecision.allowed,
                        reason: approvalDecision.reason,
                        ruleId: approvalDecision.ruleId,
                    },
                });
                return;
            }
            if (command.type === 'clear_task_history' || command.type === 'cancel_task') {
                const taskId = getString(payload.taskId) ?? '';
                let cancelledScheduledCount = 0;
                if (taskId) {
                    clearPendingApprovalsForTask(taskId);
                    if (command.type === 'cancel_task') {
                        if (deps.cancelScheduledTasksForSourceTask) {
                            const cancelled = await deps.cancelScheduledTasksForSourceTask({
                                sourceTaskId: taskId,
                                userMessage: 'cancel_task',
                            });
                            cancelledScheduledCount = cancelled.cancelledCount;
                        }
                        upsertTaskState(taskId, {
                            status: 'idle',
                            suspended: false,
                            suspensionReason: undefined,
                            checkpoint: undefined,
                        });
                    } else {
                        const existingRetry = taskStates.get(taskId)?.retry;
                        upsertTaskState(taskId, {
                            status: 'idle',
                            suspended: false,
                            suspensionReason: undefined,
                            checkpoint: undefined,
                            lastUserMessage: undefined,
                            retry: existingRetry
                                ? {
                                    ...existingRetry,
                                    attempts: 0,
                                    lastRetryAt: undefined,
                                    lastError: undefined,
                                }
                                : undefined,
                        });
                    }
                }
                const responsePayload: Record<string, unknown> = {
                    success: true,
                    taskId,
                };
                if (command.type === 'cancel_task') {
                    responsePayload.cancelledScheduledCount = cancelledScheduledCount;
                }
                emitCurrent(responsePayload);
                return;
            }
            if (forwardedCommandTypes.has(command.type)) {
                const forwardedCommandDecision = applyPolicyDecision({
                    requestId: commandId,
                    action: 'forward_command',
                    commandType: command.type,
                    taskId: getString(payload.taskId) ?? undefined,
                    source: 'policy_gate_forward',
                    payload,
                });
                if (!forwardedCommandDecision.allowed) {
                    emitCurrent({
                        success: false,
                        error: `policy_denied:${forwardedCommandDecision.reason}`,
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
