import * as fs from 'fs';
import * as path from 'path';
import {
    toTaskRuntimeState,
    type TaskRuntimeOperationAction,
    type TaskRuntimeOperationRecord,
    type TaskRuntimeState,
} from './taskRuntimeState';

function cloneTaskRuntimeState(state: TaskRuntimeState): TaskRuntimeState {
    return {
        ...state,
        checkpoint: state.checkpoint
            ? {
                ...state.checkpoint,
                metadata: state.checkpoint.metadata
                    ? { ...state.checkpoint.metadata }
                    : undefined,
            }
            : undefined,
        checkpointVersion: state.checkpointVersion,
        retry: state.retry
            ? {
                ...state.retry,
            }
            : undefined,
        agentTasks: Array.isArray(state.agentTasks)
            ? state.agentTasks.map((entry) => ({
                ...entry,
                usage: entry.usage
                    ? { ...entry.usage }
                    : undefined,
            }))
            : undefined,
        agentTaskProgress: state.agentTaskProgress
            ? {
                ...state.agentTaskProgress,
                usageTotals: state.agentTaskProgress.usageTotals
                    ? { ...state.agentTaskProgress.usageTotals }
                    : undefined,
                lastEvent: state.agentTaskProgress.lastEvent
                    ? { ...state.agentTaskProgress.lastEvent }
                    : undefined,
                recentActivity: Array.isArray(state.agentTaskProgress.recentActivity)
                    ? state.agentTaskProgress.recentActivity.map((entry) => ({ ...entry }))
                    : [],
            }
            : undefined,
        operationLog: Array.isArray(state.operationLog)
            ? state.operationLog.map((entry) => ({ ...entry }))
            : undefined,
    };
}

export class MastraTaskRuntimeStateStore {
    private readonly filePath: string;
    private readonly states = new Map<string, TaskRuntimeState>();

    constructor(filePath: string) {
        this.filePath = filePath;
        this.load();
    }

    list(): TaskRuntimeState[] {
        return Array.from(this.states.values()).map(cloneTaskRuntimeState);
    }

    upsert(state: TaskRuntimeState): void {
        this.states.set(state.taskId, cloneTaskRuntimeState(state));
        this.save();
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            const records = Array.isArray(raw) ? raw : [];
            for (const record of records) {
                const normalized = toTaskRuntimeState(record);
                if (!normalized) {
                    continue;
                }
                this.states.set(normalized.taskId, normalized);
            }
        } catch (error) {
            console.error('[MastraTaskRuntimeStateStore] Failed to load state store:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const fileContent = JSON.stringify(
                Array.from(this.states.values()),
                null,
                2,
            );
            const tempFile = `${this.filePath}.tmp`;
            fs.writeFileSync(tempFile, fileContent, 'utf-8');
            fs.renameSync(tempFile, this.filePath);
        } catch (error) {
            console.error('[MastraTaskRuntimeStateStore] Failed to persist state store:', error);
        }
    }
}

type TaskStateStore = {
    upsert: (state: TaskRuntimeState) => void;
};

type CreateTaskRuntimeStateStoreInput = {
    taskStates: Map<string, TaskRuntimeState>;
    taskStateStore?: TaskStateStore;
    resolveResourceId: (taskId: string) => string;
    getBootstrapRuntimeContext: () => Record<string, unknown> | undefined;
    getString: (value: unknown) => string | null;
    getNowIso: () => string;
    getNonNegativeInteger: (value: unknown) => number | null;
    pickResourceOverride: (payload: Record<string, unknown>) => string | null;
    maxTaskOperationLog: number;
    getDefaultWorkspacePath?: () => string;
    logger?: Pick<Console, 'error'>;
};

export function createTaskRuntimeStateStore(
    input: CreateTaskRuntimeStateStoreInput,
) {
    const logger = input.logger ?? console;
    const getDefaultWorkspacePath = input.getDefaultWorkspacePath ?? (() => process.cwd());

    const resolveTaskCheckpointVersion = (state?: TaskRuntimeState): number => {
        const fromState = input.getNonNegativeInteger(state?.checkpointVersion);
        if (fromState !== null) {
            return fromState;
        }
        const fromCheckpoint = input.getNonNegativeInteger(state?.checkpoint?.version);
        if (fromCheckpoint !== null) {
            return fromCheckpoint;
        }
        return 0;
    };

    const resolveTaskResourceId = (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ): string => {
        const fromPayload = input.pickResourceOverride(payload);
        if (fromPayload) {
            return fromPayload;
        }
        if (existingResourceId) {
            return existingResourceId;
        }
        const bootstrapRuntimeContext = input.getBootstrapRuntimeContext();
        const fromBootstrap = bootstrapRuntimeContext
            ? (
                input.getString(bootstrapRuntimeContext.resourceId)
                ?? input.getString(bootstrapRuntimeContext.memoryResourceId)
            )
            : null;
        if (fromBootstrap) {
            return fromBootstrap;
        }
        return input.resolveResourceId(taskId);
    };

    const resolveTaskOperationId = (
        payload: Record<string, unknown>,
        defaultValue: string,
    ): string => {
        const operationId = input.getString(payload.operationId)
            ?? input.getString(payload.idempotencyKey)
            ?? input.getString(payload.recoveryOperationId);
        return operationId ?? defaultValue;
    };

    const resolveExpectedCheckpointVersion = (payload: Record<string, unknown>): number | undefined => {
        const version = input.getNonNegativeInteger(payload.expectedCheckpointVersion);
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
        if (next.length <= input.maxTaskOperationLog) {
            return next;
        }
        return next.slice(next.length - input.maxTaskOperationLog);
    };

    const upsertTaskState = (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ): TaskRuntimeState => {
        const existing = input.taskStates.get(taskId);
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
            workspacePath: patch.workspacePath ?? existing?.workspacePath ?? getDefaultWorkspacePath(),
            createdAt: existing?.createdAt ?? patch.createdAt ?? input.getNowIso(),
            status: patch.status ?? existing?.status ?? 'idle',
            suspended: hasSuspended ? patch.suspended : existing?.suspended,
            suspensionReason: hasSuspensionReason ? patch.suspensionReason : existing?.suspensionReason,
            lastUserMessage: hasLastUserMessage ? patch.lastUserMessage : existing?.lastUserMessage,
            lastTraceId: hasLastTraceId ? patch.lastTraceId : existing?.lastTraceId,
            enabledSkills: hasEnabledSkills ? patch.enabledSkills : existing?.enabledSkills,
            modelId: hasModelId ? patch.modelId : existing?.modelId,
            resourceId: patch.resourceId ?? existing?.resourceId ?? input.resolveResourceId(taskId),
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
        input.taskStates.set(taskId, next);
        if (input.taskStateStore) {
            try {
                input.taskStateStore.upsert(next);
            } catch (error) {
                logger.error(`[MastraEntrypoint] Failed to persist task state for ${taskId}:`, error);
            }
        }
        return next;
    };

    return {
        resolveTaskResourceId,
        resolveTaskCheckpointVersion,
        resolveTaskOperationId,
        resolveExpectedCheckpointVersion,
        findTaskOperationRecord,
        appendTaskOperationRecord,
        upsertTaskState,
    };
}
