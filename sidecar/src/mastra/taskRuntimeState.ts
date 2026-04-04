export type TaskRuntimeStatus =
    | 'running'
    | 'retrying'
    | 'idle'
    | 'finished'
    | 'failed'
    | 'interrupted'
    | 'suspended'
    | 'scheduled';

export type TaskRuntimeExecutionPath = 'direct' | 'workflow' | 'workflow_fallback';

export type TaskRuntimeCheckpoint = {
    id: string;
    label: string;
    at: string;
    version?: number;
    metadata?: Record<string, unknown>;
};

export type TaskRuntimeRetryState = {
    attempts: number;
    maxAttempts?: number;
    lastRetryAt?: string;
    lastError?: string;
};

export type TaskRuntimeOperationAction =
    | 'set_checkpoint'
    | 'resume'
    | 'retry'
    | 'recover_resume'
    | 'recover_retry';

export type TaskRuntimeOperationResult = 'applied' | 'deduplicated' | 'skipped' | 'failed';

export type TaskRuntimeOperationRecord = {
    operationId: string;
    action: TaskRuntimeOperationAction;
    at: string;
    result: TaskRuntimeOperationResult;
    checkpointVersion?: number;
    retryAttempts?: number;
    reason?: string;
};

export type TaskRuntimeState = {
    taskId: string;
    conversationThreadId: string;
    title: string;
    workspacePath: string;
    createdAt: string;
    status: TaskRuntimeStatus;
    suspended?: boolean;
    suspensionReason?: string;
    lastUserMessage?: string;
    lastTraceId?: string;
    enabledSkills?: string[];
    resourceId: string;
    checkpoint?: TaskRuntimeCheckpoint;
    checkpointVersion?: number;
    retry?: TaskRuntimeRetryState;
    operationLog?: TaskRuntimeOperationRecord[];
    executionPath?: TaskRuntimeExecutionPath;
};

const VALID_STATUSES = new Set<TaskRuntimeStatus>([
    'running',
    'retrying',
    'idle',
    'finished',
    'failed',
    'interrupted',
    'suspended',
    'scheduled',
]);

const VALID_OPERATION_ACTIONS = new Set<TaskRuntimeOperationAction>([
    'set_checkpoint',
    'resume',
    'retry',
    'recover_resume',
    'recover_retry',
]);

const VALID_OPERATION_RESULTS = new Set<TaskRuntimeOperationResult>([
    'applied',
    'deduplicated',
    'skipped',
    'failed',
]);

const VALID_EXECUTION_PATHS = new Set<TaskRuntimeExecutionPath>([
    'direct',
    'workflow',
    'workflow_fallback',
]);

function pickNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function pickRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return undefined;
    }
    return Math.floor(value);
}

function normalizeCheckpoint(value: unknown): TaskRuntimeCheckpoint | undefined {
    const raw = pickRecord(value);
    if (!raw) {
        return undefined;
    }
    const id = pickNonEmptyString(raw.id);
    const label = pickNonEmptyString(raw.label);
    const at = pickNonEmptyString(raw.at);
    if (!id || !label || !at) {
        return undefined;
    }
    return {
        id,
        label,
        at,
        version: normalizeNonNegativeInteger(raw.version),
        metadata: pickRecord(raw.metadata),
    };
}

function normalizeRetry(value: unknown): TaskRuntimeRetryState | undefined {
    const raw = pickRecord(value);
    if (!raw) {
        return undefined;
    }
    const attemptsRaw = raw.attempts;
    if (typeof attemptsRaw !== 'number' || !Number.isFinite(attemptsRaw) || attemptsRaw < 0) {
        return undefined;
    }
    const attempts = Math.floor(attemptsRaw);
    const maxAttemptsRaw = raw.maxAttempts;
    const maxAttempts = typeof maxAttemptsRaw === 'number' && Number.isFinite(maxAttemptsRaw) && maxAttemptsRaw > 0
        ? Math.floor(maxAttemptsRaw)
        : undefined;
    return {
        attempts,
        maxAttempts,
        lastRetryAt: pickNonEmptyString(raw.lastRetryAt),
        lastError: pickNonEmptyString(raw.lastError),
    };
}

function normalizeOperationRecord(value: unknown): TaskRuntimeOperationRecord | undefined {
    const raw = pickRecord(value);
    if (!raw) {
        return undefined;
    }
    const operationId = pickNonEmptyString(raw.operationId);
    const actionRaw = pickNonEmptyString(raw.action);
    const at = pickNonEmptyString(raw.at);
    const resultRaw = pickNonEmptyString(raw.result);
    if (!operationId || !actionRaw || !at || !resultRaw) {
        return undefined;
    }
    if (
        !VALID_OPERATION_ACTIONS.has(actionRaw as TaskRuntimeOperationAction)
        || !VALID_OPERATION_RESULTS.has(resultRaw as TaskRuntimeOperationResult)
    ) {
        return undefined;
    }
    return {
        operationId,
        action: actionRaw as TaskRuntimeOperationAction,
        at,
        result: resultRaw as TaskRuntimeOperationResult,
        checkpointVersion: normalizeNonNegativeInteger(raw.checkpointVersion),
        retryAttempts: normalizeNonNegativeInteger(raw.retryAttempts),
        reason: pickNonEmptyString(raw.reason),
    };
}

function normalizeOperationLog(value: unknown): TaskRuntimeOperationRecord[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const records = value
        .map((item) => normalizeOperationRecord(item))
        .filter((item): item is TaskRuntimeOperationRecord => Boolean(item));
    return records.length > 0 ? records : undefined;
}

export function toTaskRuntimeState(value: unknown): TaskRuntimeState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    const raw = value as Record<string, unknown>;
    const taskId = pickNonEmptyString(raw.taskId);
    const conversationThreadId = pickNonEmptyString(raw.conversationThreadId);
    const title = pickNonEmptyString(raw.title);
    const workspacePath = pickNonEmptyString(raw.workspacePath);
    const createdAt = pickNonEmptyString(raw.createdAt);
    const resourceId = pickNonEmptyString(raw.resourceId);
    const statusRaw = pickNonEmptyString(raw.status);

    if (
        !taskId
        || !conversationThreadId
        || !title
        || !workspacePath
        || !createdAt
        || !resourceId
        || !statusRaw
        || !VALID_STATUSES.has(statusRaw as TaskRuntimeStatus)
    ) {
        return null;
    }

    const status = statusRaw as TaskRuntimeStatus;
    const checkpoint = normalizeCheckpoint(raw.checkpoint);
    const checkpointVersion = normalizeNonNegativeInteger(raw.checkpointVersion) ?? checkpoint?.version;
    return {
        taskId,
        conversationThreadId,
        title,
        workspacePath,
        createdAt,
        status,
        suspended: typeof raw.suspended === 'boolean' ? raw.suspended : undefined,
        suspensionReason: pickNonEmptyString(raw.suspensionReason),
        lastUserMessage: pickNonEmptyString(raw.lastUserMessage),
        lastTraceId: pickNonEmptyString(raw.lastTraceId),
        enabledSkills: Array.isArray(raw.enabledSkills)
            ? raw.enabledSkills.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : undefined,
        resourceId,
        checkpoint,
        checkpointVersion,
        retry: normalizeRetry(raw.retry),
        operationLog: normalizeOperationLog(raw.operationLog),
        executionPath: VALID_EXECUTION_PATHS.has(raw.executionPath as TaskRuntimeExecutionPath)
            ? raw.executionPath as TaskRuntimeExecutionPath
            : undefined,
    };
}

export function recoverTaskRuntimeStateAfterRestart(state: TaskRuntimeState): TaskRuntimeState {
    if (state.status !== 'running' && state.status !== 'retrying') {
        return state;
    }
    return {
        ...state,
        status: 'interrupted',
        suspended: false,
        suspensionReason: 'runtime_restarted',
    };
}
