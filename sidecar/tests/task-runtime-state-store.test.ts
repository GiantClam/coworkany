import { describe, expect, test } from 'bun:test';
import type { TaskRuntimeState } from '../src/mastra/taskRuntimeState';
import { createTaskRuntimeStateStore } from '../src/mastra/taskRuntimeStateStore';

function getString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function getNonNegativeInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return null;
    }
    return Math.floor(value);
}

function pickResourceOverride(payload: Record<string, unknown>): string | null {
    const fromResourceId = getString(payload.resourceId);
    if (fromResourceId) {
        return fromResourceId;
    }
    const fromMemoryResourceId = getString(payload.memoryResourceId);
    if (fromMemoryResourceId) {
        return fromMemoryResourceId;
    }
    return null;
}

function createStore(input?: {
    bootstrapRuntimeContext?: Record<string, unknown>;
    maxTaskOperationLog?: number;
    taskStateStore?: { upsert: (state: TaskRuntimeState) => void };
    taskStates?: Map<string, TaskRuntimeState>;
}) {
    const taskStates = input?.taskStates ?? new Map<string, TaskRuntimeState>();
    return createTaskRuntimeStateStore({
        taskStates,
        taskStateStore: input?.taskStateStore,
        resolveResourceId: (taskId) => `resolved:${taskId}`,
        getBootstrapRuntimeContext: () => input?.bootstrapRuntimeContext,
        getString,
        getNowIso: () => '2026-04-23T00:00:00.000Z',
        getNonNegativeInteger,
        pickResourceOverride,
        maxTaskOperationLog: input?.maxTaskOperationLog ?? 3,
        getDefaultWorkspacePath: () => '/tmp/workspace',
    });
}

describe('taskRuntimeStateStore', () => {
    test('resolveTaskResourceId prefers payload override then existing then bootstrap then resolver', () => {
        const storeWithBootstrapResource = createStore({
            bootstrapRuntimeContext: { resourceId: 'bootstrap-resource' },
        });
        expect(
            storeWithBootstrapResource.resolveTaskResourceId('task-1', { resourceId: 'payload-resource' }),
        ).toBe('payload-resource');
        expect(
            storeWithBootstrapResource.resolveTaskResourceId('task-1', {}, 'existing-resource'),
        ).toBe('existing-resource');
        expect(
            storeWithBootstrapResource.resolveTaskResourceId('task-1', {}),
        ).toBe('bootstrap-resource');

        const storeWithBootstrapMemory = createStore({
            bootstrapRuntimeContext: { memoryResourceId: 'bootstrap-memory' },
        });
        expect(
            storeWithBootstrapMemory.resolveTaskResourceId('task-2', {}),
        ).toBe('bootstrap-memory');

        const storeWithoutBootstrap = createStore();
        expect(
            storeWithoutBootstrap.resolveTaskResourceId('task-3', {}),
        ).toBe('resolved:task-3');
    });

    test('resolveTaskCheckpointVersion falls back from state field to checkpoint to zero', () => {
        const store = createStore();
        expect(store.resolveTaskCheckpointVersion({ checkpointVersion: 3 } as TaskRuntimeState)).toBe(3);
        expect(store.resolveTaskCheckpointVersion({ checkpoint: { version: 5 } } as TaskRuntimeState)).toBe(5);
        expect(store.resolveTaskCheckpointVersion()).toBe(0);
    });

    test('appendTaskOperationRecord deduplicates by operationId and trims to max length', () => {
        const store = createStore({ maxTaskOperationLog: 3 });
        const baseState = {
            operationLog: [
                { operationId: 'op-1', action: 'retry', at: 't1', result: 'applied' },
                { operationId: 'op-2', action: 'retry', at: 't2', result: 'applied' },
                { operationId: 'op-3', action: 'retry', at: 't3', result: 'applied' },
            ],
        } as TaskRuntimeState;

        const deduped = store.appendTaskOperationRecord(baseState, {
            operationId: 'op-2',
            action: 'retry',
            at: 't4',
            result: 'deduplicated',
        });
        expect(deduped.map((item) => item.operationId)).toEqual(['op-1', 'op-3', 'op-2']);
        expect(deduped[2]?.result).toBe('deduplicated');

        const trimmed = store.appendTaskOperationRecord({ operationLog: deduped } as TaskRuntimeState, {
            operationId: 'op-4',
            action: 'retry',
            at: 't5',
            result: 'applied',
        });
        expect(trimmed.map((item) => item.operationId)).toEqual(['op-3', 'op-2', 'op-4']);
    });

    test('upsertTaskState keeps omitted fields and applies explicit overrides', () => {
        const persisted: TaskRuntimeState[] = [];
        const taskStates = new Map<string, TaskRuntimeState>();
        taskStates.set('task-1', {
            taskId: 'task-1',
            conversationThreadId: 'thread-1',
            title: 'Existing',
            workspacePath: '/existing',
            createdAt: '2026-04-20T00:00:00.000Z',
            status: 'idle',
            suspended: true,
            lastUserMessage: 'before',
            lastTraceId: 'trace-1',
            enabledSkills: ['skill-a'],
            modelId: 'model-a',
            resourceId: 'resource-existing',
            checkpointVersion: 7,
            operationLog: [],
            executionPath: 'workflow',
        });

        const store = createStore({
            taskStates,
            taskStateStore: {
                upsert: (state) => {
                    persisted.push(state);
                },
            },
        });

        const next = store.upsertTaskState('task-1', {
            status: 'running',
            suspended: undefined,
            lastUserMessage: undefined,
        });

        expect(next.status).toBe('running');
        expect(next.suspended).toBeUndefined();
        expect(next.lastUserMessage).toBeUndefined();
        expect(next.lastTraceId).toBe('trace-1');
        expect(next.checkpointVersion).toBe(7);
        expect(next.resourceId).toBe('resource-existing');
        expect(next.createdAt).toBe('2026-04-20T00:00:00.000Z');
        expect(taskStates.get('task-1')).toEqual(next);
        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toEqual(next);
    });

    test('resolves operation ids and expected checkpoint version from payload', () => {
        const store = createStore();
        expect(store.resolveTaskOperationId({ operationId: 'op-1' }, 'fallback')).toBe('op-1');
        expect(store.resolveTaskOperationId({ idempotencyKey: 'idemp-1' }, 'fallback')).toBe('idemp-1');
        expect(store.resolveTaskOperationId({ recoveryOperationId: 'recover-1' }, 'fallback')).toBe('recover-1');
        expect(store.resolveTaskOperationId({}, 'fallback')).toBe('fallback');

        expect(store.resolveExpectedCheckpointVersion({ expectedCheckpointVersion: 9 })).toBe(9);
        expect(store.resolveExpectedCheckpointVersion({ expectedCheckpointVersion: -1 })).toBeUndefined();
    });
});
