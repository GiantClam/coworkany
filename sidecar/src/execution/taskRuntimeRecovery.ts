import type {
    PersistedTaskRuntimeRecord,
    PersistedTaskRuntimeSuspension,
} from './taskRuntimeStore';

export type TaskRuntimeRestartInterruptedFailure = {
    error: string;
    recoverable: boolean;
    errorCode: string;
};

export type TaskRuntimeRecoveryPlan =
    | {
        type: 'restore_suspended';
        record: PersistedTaskRuntimeRecord;
        suspension: PersistedTaskRuntimeSuspension;
    }
    | {
        type: 'interrupt_running';
        record: PersistedTaskRuntimeRecord;
        failure: TaskRuntimeRestartInterruptedFailure;
    }
    | {
        type: 'restore_interrupted';
        record: PersistedTaskRuntimeRecord;
    }
    | {
        type: 'hydrate_only';
        record: PersistedTaskRuntimeRecord;
    };

function cloneRecord(record: PersistedTaskRuntimeRecord): PersistedTaskRuntimeRecord {
    return {
        ...record,
        conversation: Array.isArray(record.conversation)
            ? record.conversation.map((item) => item)
            : [],
        config: record.config ? { ...record.config } : undefined,
        artifactContract: record.artifactContract ? { ...record.artifactContract } : undefined,
        artifactsCreated: [...record.artifactsCreated],
        suspension: record.suspension ? { ...record.suspension } : undefined,
    };
}

function normalizeSuspensionForManualResume(
    suspension: PersistedTaskRuntimeSuspension,
): PersistedTaskRuntimeSuspension {
    return {
        ...suspension,
        canAutoResume: false,
    };
}

export function createRestartInterruptedFailure(): TaskRuntimeRestartInterruptedFailure {
    return {
        error: 'runtime_restarted_before_completion',
        recoverable: true,
        errorCode: 'TASK_RUNTIME_INTERRUPTED_AFTER_RESTART',
    };
}

export function planTaskRuntimeRecovery(
    record: PersistedTaskRuntimeRecord,
): TaskRuntimeRecoveryPlan {
    const cloned = cloneRecord(record);
    if (cloned.status === 'suspended') {
        if (cloned.suspension?.reason) {
            return {
                type: 'restore_suspended',
                record: cloned,
                suspension: normalizeSuspensionForManualResume(cloned.suspension),
            };
        }
        return {
            type: 'interrupt_running',
            record: cloned,
            failure: createRestartInterruptedFailure(),
        };
    }

    if (cloned.status === 'running' || cloned.status === 'retrying') {
        return {
            type: 'interrupt_running',
            record: cloned,
            failure: createRestartInterruptedFailure(),
        };
    }

    if (cloned.status === 'interrupted') {
        return {
            type: 'restore_interrupted',
            record: cloned,
        };
    }

    return {
        type: 'hydrate_only',
        record: cloned,
    };
}
