import type { RemoteSessionState, RemoteSessionStatus } from './remoteSessionStore';

type RemoteSessionStoreLike = {
    list: (input?: { taskId?: string; status?: RemoteSessionStatus }) => RemoteSessionState[];
    get: (remoteSessionId: string) => RemoteSessionState | undefined;
};

type CreateEntrypointRemoteSessionIndexInput = {
    getNowIso: () => string;
    getString: (value: unknown) => string | null;
    remoteSessionStore?: RemoteSessionStoreLike;
};

export function createEntrypointRemoteSessionIndex(
    input: CreateEntrypointRemoteSessionIndexInput,
) {
    const remoteSessionToTaskId = new Map<string, string>();

    const hydrateFromSessions = (sessions: Array<{ remoteSessionId: string; taskId: string }>): void => {
        for (const session of sessions) {
            remoteSessionToTaskId.set(session.remoteSessionId, session.taskId);
        }
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

    const resolveTaskIdForRemoteSessionId = (remoteSessionId: string): string | undefined => {
        return remoteSessionToTaskId.get(remoteSessionId);
    };

    const resolveTaskIdForExternalEvent = (payload: Record<string, unknown>): string | null => {
        const directTaskId = input.getString(payload.taskId);
        if (directTaskId) {
            return directTaskId;
        }
        const remoteSessionId = input.getString(payload.remoteSessionId);
        if (!remoteSessionId) {
            return null;
        }
        return remoteSessionToTaskId.get(remoteSessionId) ?? null;
    };

    const resolveRemoteSessionState = (remoteSessionId: string): RemoteSessionState | undefined => {
        if (input.remoteSessionStore) {
            return input.remoteSessionStore.get(remoteSessionId);
        }
        const taskId = remoteSessionToTaskId.get(remoteSessionId);
        if (!taskId) {
            return undefined;
        }
        return {
            remoteSessionId,
            taskId,
            status: 'active',
            linkedAt: input.getNowIso(),
            lastSeenAt: input.getNowIso(),
        };
    };

    const listRemoteSessions = (query?: {
        taskId?: string;
        status?: RemoteSessionStatus;
    }): RemoteSessionState[] => {
        if (input.remoteSessionStore) {
            return input.remoteSessionStore.list(query);
        }
        return Array.from(remoteSessionToTaskId.entries())
            .map(([remoteSessionId, taskId]) => ({
                remoteSessionId,
                taskId,
                status: 'active' as const,
                linkedAt: input.getNowIso(),
                lastSeenAt: input.getNowIso(),
            }))
            .filter((session) => !query?.taskId || session.taskId === query.taskId)
            .filter((session) => !query?.status || session.status === query.status);
    };

    return {
        hydrateFromSessions,
        bindRemoteSessionToTask,
        unbindRemoteSession,
        resolveTaskIdForRemoteSessionId,
        resolveTaskIdForExternalEvent,
        resolveRemoteSessionState,
        listRemoteSessions,
    };
}
