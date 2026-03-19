import { describe, expect, test } from 'bun:test';
import {
    createRestartInterruptedFailure,
    planTaskRuntimeRecovery,
} from '../src/execution/taskRuntimeRecovery';
import type { PersistedTaskRuntimeRecord } from '../src/execution/taskRuntimeStore';

function makeRecord(
    overrides: Partial<PersistedTaskRuntimeRecord> = {}
): PersistedTaskRuntimeRecord {
    return {
        taskId: overrides.taskId ?? 'task-1',
        title: overrides.title ?? 'Long task',
        workspacePath: overrides.workspacePath ?? '/tmp/workspace',
        createdAt: overrides.createdAt ?? new Date().toISOString(),
        updatedAt: overrides.updatedAt ?? new Date().toISOString(),
        status: overrides.status ?? 'running',
        conversation: overrides.conversation ?? [],
        config: overrides.config,
        historyLimit: overrides.historyLimit ?? 50,
        artifactContract: overrides.artifactContract,
        artifactsCreated: overrides.artifactsCreated ?? [],
        suspension: overrides.suspension,
    };
}

describe('task runtime recovery', () => {
    test('restores suspended runtimes as manual resumes', () => {
        const recovery = planTaskRuntimeRecovery(makeRecord({
            status: 'suspended',
            suspension: {
                reason: 'authentication_required',
                userMessage: 'Please log in.',
                canAutoResume: true,
                maxWaitTimeMs: 300000,
            },
        }));

        expect(recovery.type).toBe('restore_suspended');
        if (recovery.type !== 'restore_suspended') {
            throw new Error('expected restore_suspended recovery');
        }
        expect(recovery.suspension.canAutoResume).toBe(false);
        expect(recovery.suspension.reason).toBe('authentication_required');
    });

    test('marks running runtimes as interrupted after restart', () => {
        const recovery = planTaskRuntimeRecovery(makeRecord({
            status: 'running',
        }));

        expect(recovery).toEqual({
            type: 'interrupt_running',
            record: expect.objectContaining({
                taskId: 'task-1',
                status: 'running',
            }),
            failure: createRestartInterruptedFailure(),
        });
    });

    test('treats malformed suspended records as interrupted', () => {
        const recovery = planTaskRuntimeRecovery(makeRecord({
            status: 'suspended',
            suspension: undefined,
        }));

        expect(recovery.type).toBe('interrupt_running');
    });
});
