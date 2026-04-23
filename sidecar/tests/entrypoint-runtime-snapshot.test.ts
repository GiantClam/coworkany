import { describe, expect, test } from 'bun:test';
import { createRuntimeSnapshotCollector } from '../src/mastra/entrypointRuntimeSnapshot';
import type { TaskRuntimeState } from '../src/mastra/taskRuntimeState';

function createTaskState(overrides?: Partial<TaskRuntimeState>): TaskRuntimeState {
    return {
        taskId: 'task-1',
        conversationThreadId: 'thread-1',
        title: 'Task 1',
        workspacePath: '/workspace',
        createdAt: '2026-04-23T00:00:00.000Z',
        status: 'idle',
        resourceId: 'resource-1',
        executionPath: 'workflow',
        ...overrides,
    };
}

describe('entrypointRuntimeSnapshot', () => {
    test('collects runtime snapshot with task, remote session, and channel delivery aggregates', () => {
        const taskStates = new Map<string, TaskRuntimeState>([
            ['task-1', createTaskState({
                taskId: 'task-1',
                status: 'running',
                checkpointVersion: undefined,
                checkpoint: { id: 'cp-1', label: 'Checkpoint', at: '2026-04-23T00:00:00.000Z', version: 4 },
            })],
            ['task-2', createTaskState({
                taskId: 'task-2',
                status: 'interrupted',
                conversationThreadId: 'thread-2',
                resourceId: 'resource-2',
            })],
        ]);

        const collectSnapshot = createRuntimeSnapshotCollector({
            taskStates,
            resolveTaskCheckpointVersion: (state) => state.checkpoint?.version ?? 0,
            listRemoteSessions: () => [
                {
                    remoteSessionId: 'remote-1',
                    taskId: 'task-1',
                    status: 'active',
                },
            ],
            listChannelDeliveryEvents: () => [
                { id: 'event-1', status: 'pending' },
                { id: 'event-2', status: 'acked' },
                { id: 'event-3', status: 'acked' },
            ],
            forwardBridgeStats: {
                forwardedRequests: 3,
                successfulResponses: 2,
            },
            remoteSessionGovernancePolicy: {
                conflictStrategy: 'deny',
            },
            getNowIso: () => '2026-04-23T00:00:00.000Z',
        });

        const snapshot = collectSnapshot();
        expect(snapshot.generatedAt).toBe('2026-04-23T00:00:00.000Z');
        expect(snapshot.count).toBe(2);
        expect(snapshot.activeTaskId).toBe('task-1');
        expect(snapshot.remoteSessions.count).toBe(1);
        expect(snapshot.channelDeliveries.count).toBe(3);
        expect(snapshot.channelDeliveries.pending).toBe(1);
        expect(snapshot.channelDeliveries.acked).toBe(2);
        expect(snapshot.policyGateBridge.forwardedRequests).toBe(3);
        expect(snapshot.remoteSessionGovernance.conflictStrategy).toBe('deny');
        const firstTask = snapshot.tasks.find((task) => task.taskId === 'task-1');
        expect(firstTask?.checkpointVersion).toBe(4);
        expect(firstTask?.executionPath).toBe('workflow');
    });

    test('activeTaskId falls back to retrying/suspended/interrupted priority', () => {
        const taskStates = new Map<string, TaskRuntimeState>([
            ['task-a', createTaskState({ taskId: 'task-a', status: 'idle' })],
            ['task-b', createTaskState({ taskId: 'task-b', status: 'suspended' })],
            ['task-c', createTaskState({ taskId: 'task-c', status: 'retrying' })],
        ]);

        const collectSnapshot = createRuntimeSnapshotCollector({
            taskStates,
            resolveTaskCheckpointVersion: () => 0,
            listRemoteSessions: () => [],
            listChannelDeliveryEvents: () => [],
            forwardBridgeStats: {},
            remoteSessionGovernancePolicy: {},
            getNowIso: () => '2026-04-23T00:00:00.000Z',
        });

        const snapshot = collectSnapshot();
        expect(snapshot.activeTaskId).toBe('task-c');
    });
});
