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
        type: 'interrupt_running';
        record: PersistedTaskRuntimeRecord;
        failure: TaskFailedPayload;
    };

export function createRestartInterruptedFailure(): TaskFailedPayload {
    return {
        error: 'Task interrupted by sidecar restart',
        errorCode: 'INTERRUPTED',
        recoverable: true,
        suggestion: 'Send a follow-up message to continue from the saved context.',
    };
}

export function planTaskRuntimeRecovery(
    record: PersistedTaskRuntimeRecord
): TaskRuntimeRecoveryAction {
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

    return {
        type: 'interrupt_running',
        record,
        failure: createRestartInterruptedFailure(),
    };
}
