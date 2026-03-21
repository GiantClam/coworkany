import type { TaskFailedPayload } from './taskEventBus';
import type {
    PersistedTaskRuntimeRecord,
    PersistedTaskSuspension,
} from './taskRuntimeStore';

export type TaskRuntimeRecoveryAction =
    | {
        type: 'restore_suspended';
        record: PersistedTaskRuntimeRecord;
        suspension: PersistedTaskSuspension;
    }
    | {
        type: 'restore_interrupted';
        record: PersistedTaskRuntimeRecord;
    }
    | {
        type: 'interrupt_running';
        record: PersistedTaskRuntimeRecord;
        failure: TaskFailedPayload;
    }
    | {
        type: 'hydrate_only';
        record: PersistedTaskRuntimeRecord;
    };

export function createRestartInterruptedFailure(): TaskFailedPayload {
    return {
        error: 'Task interrupted by sidecar restart',
        errorCode: 'INTERRUPTED',
        recoverable: true,
        suggestion: 'Resume the task to continue from the saved context.',
    };
}

export function planTaskRuntimeRecovery(
    record: PersistedTaskRuntimeRecord
): TaskRuntimeRecoveryAction {
    if (record.status === 'idle' || record.status === 'finished' || record.status === 'failed') {
        return {
            type: 'hydrate_only',
            record,
        };
    }

    if (record.status === 'suspended' && record.suspension) {
        return {
            type: 'restore_suspended',
            record,
            suspension: {
                ...record.suspension,
                canAutoResume: false,
            },
        };
    }

    if (record.status === 'interrupted') {
        return {
            type: 'restore_interrupted',
            record,
        };
    }

    return {
        type: 'interrupt_running',
        record,
        failure: createRestartInterruptedFailure(),
    };
}
