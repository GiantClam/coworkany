import { describe, expect, test } from 'bun:test';
import { createEntrypointRemoteSessionIndex } from '../src/mastra/entrypointRemoteSessionIndex';

function getString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

describe('entrypointRemoteSessionIndex', () => {
    test('fallback index supports bind/unbind/list/resolve', () => {
        const index = createEntrypointRemoteSessionIndex({
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            getString,
        });

        index.hydrateFromSessions([
            { remoteSessionId: 'remote-1', taskId: 'task-1' },
        ]);
        index.bindRemoteSessionToTask('task-2', '  remote-2  ');

        expect(index.resolveTaskIdForRemoteSessionId('remote-1')).toBe('task-1');
        expect(index.resolveTaskIdForRemoteSessionId('remote-2')).toBe('task-2');
        expect(index.resolveTaskIdForExternalEvent({ taskId: 'task-direct', remoteSessionId: 'remote-1' })).toBe('task-direct');
        expect(index.resolveTaskIdForExternalEvent({ remoteSessionId: 'remote-1' })).toBe('task-1');
        expect(index.resolveTaskIdForExternalEvent({})).toBeNull();

        const remoteState = index.resolveRemoteSessionState('remote-1');
        expect(remoteState?.taskId).toBe('task-1');
        expect(remoteState?.status).toBe('active');

        const listAll = index.listRemoteSessions();
        expect(listAll).toHaveLength(2);
        const listTask2 = index.listRemoteSessions({ taskId: 'task-2' });
        expect(listTask2).toHaveLength(1);
        expect(listTask2[0]?.remoteSessionId).toBe('remote-2');

        index.unbindRemoteSession('remote-1');
        expect(index.resolveTaskIdForRemoteSessionId('remote-1')).toBeUndefined();
        expect(index.resolveRemoteSessionState('remote-1')).toBeUndefined();
    });

    test('store-backed index delegates list/get while keeping external-event mapping index', () => {
        const listCalls: Array<{ taskId?: string; status?: 'active' | 'closed' }> = [];
        const getCalls: string[] = [];
        const index = createEntrypointRemoteSessionIndex({
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            getString,
            remoteSessionStore: {
                list: (query) => {
                    listCalls.push(query ?? {});
                    return [{
                        remoteSessionId: 'remote-store',
                        taskId: 'task-store',
                        status: 'active',
                        linkedAt: '2026-04-22T00:00:00.000Z',
                        lastSeenAt: '2026-04-23T00:00:00.000Z',
                    }];
                },
                get: (remoteSessionId) => {
                    getCalls.push(remoteSessionId);
                    return {
                        remoteSessionId,
                        taskId: 'task-store',
                        status: 'active',
                        linkedAt: '2026-04-22T00:00:00.000Z',
                        lastSeenAt: '2026-04-23T00:00:00.000Z',
                    };
                },
            },
        });

        index.hydrateFromSessions([{ remoteSessionId: 'remote-store', taskId: 'task-store' }]);

        const listed = index.listRemoteSessions({ status: 'active' });
        expect(listed).toHaveLength(1);
        expect(listCalls).toEqual([{ status: 'active' }]);

        const state = index.resolveRemoteSessionState('remote-store');
        expect(state?.taskId).toBe('task-store');
        expect(getCalls).toEqual(['remote-store']);

        expect(index.resolveTaskIdForExternalEvent({ remoteSessionId: 'remote-store' })).toBe('task-store');
    });
});
