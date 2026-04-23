type RemoteSessionStatus = 'active' | 'closed';
type ChannelDeliveryStatus = 'pending' | 'acked';

export type RemoteSessionState = {
    remoteSessionId: string;
    taskId: string;
    channel?: string;
    status: RemoteSessionStatus;
    linkedAt: string;
    lastSeenAt: string;
    metadata?: Record<string, unknown>;
};

export type ChannelDeliveryEvent = {
    id: string;
    taskId: string;
    remoteSessionId?: string;
    channel: string;
    eventType: string;
    content?: string;
    metadata?: Record<string, unknown>;
    injectedAt: string;
    status: ChannelDeliveryStatus;
    deliveryAttempts?: number;
    lastDeliveredAt?: string;
    ackedAt?: string;
    ackMetadata?: Record<string, unknown>;
};

type RemoteSessionStoreLike = {
    upsertLink: (input: {
        remoteSessionId: string;
        taskId: string;
        channel?: string;
        metadata?: Record<string, unknown>;
    }) => { success: boolean; conflict?: boolean; state?: RemoteSessionState };
    heartbeat: (remoteSessionId: string, metadata?: Record<string, unknown>) => {
        success: boolean;
        state?: RemoteSessionState;
    };
    close: (remoteSessionId: string) => {
        success: boolean;
        state?: RemoteSessionState;
    };
    enqueueChannelEvent: (input: {
        taskId: string;
        remoteSessionId?: string;
        channel: string;
        eventType: string;
        content?: string;
        metadata?: Record<string, unknown>;
        eventId?: string;
        forceRequeue?: boolean;
    }) => {
        success: boolean;
        event?: ChannelDeliveryEvent;
        deduplicated?: boolean;
        requeued?: boolean;
    };
    listChannelEvents: (input?: {
        taskId?: string;
        remoteSessionId?: string;
        status?: ChannelDeliveryStatus;
        limit?: number;
    }) => ChannelDeliveryEvent[];
    ackChannelEvent: (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
        metadata?: Record<string, unknown>;
    }) => { success: boolean; event?: ChannelDeliveryEvent };
    getChannelEvent: (eventId: string) => ChannelDeliveryEvent | undefined;
    markChannelEventDelivered: (input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
    }) => { success: boolean; event?: ChannelDeliveryEvent };
};

type CreateEntrypointRemoteSessionRecordsInput = {
    remoteSessionStore?: RemoteSessionStoreLike;
    resolveTaskIdForRemoteSessionId: (remoteSessionId: string) => string | undefined;
    getNowIso: () => string;
    getString: (value: unknown) => string | null;
    createId: () => string;
};

export function createEntrypointRemoteSessionRecords(
    input: CreateEntrypointRemoteSessionRecordsInput,
) {
    const channelDeliveryEvents = new Map<string, ChannelDeliveryEvent>();

    const hydrateChannelDeliveryEvents = (events: ChannelDeliveryEvent[]): void => {
        for (const event of events) {
            channelDeliveryEvents.set(event.id, event);
        }
    };

    const upsertRemoteSessionRecord = (payload: {
        remoteSessionId: string;
        taskId: string;
        channel?: string;
        metadata?: Record<string, unknown>;
    }): { success: boolean; conflict?: boolean; state?: RemoteSessionState } => {
        if (!input.remoteSessionStore) {
            return {
                success: true,
                state: {
                    remoteSessionId: payload.remoteSessionId,
                    taskId: payload.taskId,
                    channel: payload.channel,
                    status: 'active',
                    linkedAt: input.getNowIso(),
                    lastSeenAt: input.getNowIso(),
                    metadata: payload.metadata,
                },
            };
        }
        return input.remoteSessionStore.upsertLink(payload);
    };

    const heartbeatRemoteSessionRecord = (remoteSessionId: string, metadata?: Record<string, unknown>): {
        success: boolean;
        state?: RemoteSessionState;
    } => {
        if (!input.remoteSessionStore) {
            const taskId = input.resolveTaskIdForRemoteSessionId(remoteSessionId);
            if (!taskId) {
                return { success: false };
            }
            return {
                success: true,
                state: {
                    remoteSessionId,
                    taskId,
                    status: 'active',
                    linkedAt: input.getNowIso(),
                    lastSeenAt: input.getNowIso(),
                    metadata,
                },
            };
        }
        return input.remoteSessionStore.heartbeat(remoteSessionId, metadata);
    };

    const closeRemoteSessionRecord = (remoteSessionId: string): {
        success: boolean;
        state?: RemoteSessionState;
    } => {
        if (!input.remoteSessionStore) {
            const taskId = input.resolveTaskIdForRemoteSessionId(remoteSessionId);
            if (!taskId) {
                return { success: false };
            }
            return {
                success: true,
                state: {
                    remoteSessionId,
                    taskId,
                    status: 'closed',
                    linkedAt: input.getNowIso(),
                    lastSeenAt: input.getNowIso(),
                },
            };
        }
        return input.remoteSessionStore.close(remoteSessionId);
    };

    const enqueueChannelDeliveryEvent = (payload: {
        taskId: string;
        remoteSessionId?: string;
        channel: string;
        eventType: string;
        content?: string;
        metadata?: Record<string, unknown>;
        eventId?: string;
        forceRequeue?: boolean;
    }): {
        event: ChannelDeliveryEvent;
        deduplicated: boolean;
        requeued: boolean;
    } => {
        if (!input.remoteSessionStore) {
            const normalizedEventId = input.getString(payload.eventId) ?? '';
            const existing = normalizedEventId ? channelDeliveryEvents.get(normalizedEventId) : undefined;
            if (existing && payload.forceRequeue !== true) {
                return {
                    event: existing,
                    deduplicated: true,
                    requeued: false,
                };
            }
            const event: ChannelDeliveryEvent = {
                id: normalizedEventId || `delivery-${input.createId()}-${channelDeliveryEvents.size + 1}`,
                taskId: payload.taskId,
                remoteSessionId: payload.remoteSessionId,
                channel: payload.channel,
                eventType: payload.eventType,
                content: payload.content,
                metadata: payload.metadata,
                injectedAt: existing?.injectedAt ?? input.getNowIso(),
                status: 'pending',
                deliveryAttempts: existing?.deliveryAttempts ?? 0,
                lastDeliveredAt: existing?.lastDeliveredAt,
            };
            channelDeliveryEvents.set(event.id, event);
            return {
                event,
                deduplicated: false,
                requeued: Boolean(existing),
            };
        }
        const created = input.remoteSessionStore.enqueueChannelEvent(payload);
        if (created.success && created.event) {
            channelDeliveryEvents.set(created.event.id, created.event);
            return {
                event: created.event,
                deduplicated: created.deduplicated === true,
                requeued: created.requeued === true,
            };
        }
        const fallback: ChannelDeliveryEvent = {
            id: input.getString(payload.eventId) || `delivery-${input.createId()}-${channelDeliveryEvents.size + 1}`,
            taskId: payload.taskId,
            remoteSessionId: payload.remoteSessionId,
            channel: payload.channel,
            eventType: payload.eventType,
            content: payload.content,
            metadata: payload.metadata,
            injectedAt: input.getNowIso(),
            status: 'pending',
            deliveryAttempts: 0,
        };
        channelDeliveryEvents.set(fallback.id, fallback);
        return {
            event: fallback,
            deduplicated: false,
            requeued: false,
        };
    };

    const listChannelDeliveryEvents = (query?: {
        taskId?: string;
        remoteSessionId?: string;
        status?: ChannelDeliveryStatus;
        limit?: number;
    }): ChannelDeliveryEvent[] => {
        if (!input.remoteSessionStore) {
            const taskId = input.getString(query?.taskId) ?? undefined;
            const remoteSessionId = input.getString(query?.remoteSessionId) ?? undefined;
            const status = query?.status;
            const limit = typeof query?.limit === 'number' && Number.isFinite(query.limit) && query.limit > 0
                ? Math.floor(query.limit)
                : undefined;
            const listed = Array
                .from(channelDeliveryEvents.values())
                .filter((event) => !taskId || event.taskId === taskId)
                .filter((event) => !remoteSessionId || event.remoteSessionId === remoteSessionId)
                .filter((event) => !status || event.status === status)
                .sort((left, right) => right.injectedAt.localeCompare(left.injectedAt));
            return limit ? listed.slice(0, limit) : listed;
        }
        const listed = input.remoteSessionStore.listChannelEvents(query);
        for (const event of listed) {
            channelDeliveryEvents.set(event.id, event);
        }
        return listed;
    };

    const ackChannelDeliveryEvent = (payload: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
        metadata?: Record<string, unknown>;
    }): { success: boolean; event?: ChannelDeliveryEvent } => {
        if (!input.remoteSessionStore) {
            const existing = channelDeliveryEvents.get(payload.eventId);
            if (!existing) {
                return { success: false };
            }
            if (payload.taskId && existing.taskId !== payload.taskId) {
                return { success: false };
            }
            if (payload.remoteSessionId && existing.remoteSessionId !== payload.remoteSessionId) {
                return { success: false };
            }
            const next: ChannelDeliveryEvent = {
                ...existing,
                status: 'acked',
                ackedAt: input.getNowIso(),
                ackMetadata: payload.metadata,
            };
            channelDeliveryEvents.set(next.id, next);
            return {
                success: true,
                event: next,
            };
        }
        const acked = input.remoteSessionStore.ackChannelEvent(payload);
        if (acked.success && acked.event) {
            channelDeliveryEvents.set(acked.event.id, acked.event);
        }
        return acked;
    };

    const getChannelDeliveryEvent = (eventId: string): ChannelDeliveryEvent | undefined => {
        if (!input.remoteSessionStore) {
            return channelDeliveryEvents.get(eventId);
        }
        const event = input.remoteSessionStore.getChannelEvent(eventId);
        if (event) {
            channelDeliveryEvents.set(event.id, event);
        }
        return event;
    };

    const markChannelDeliveryDelivered = (payload: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
    }): { success: boolean; event?: ChannelDeliveryEvent } => {
        if (!input.remoteSessionStore) {
            const existing = channelDeliveryEvents.get(payload.eventId);
            if (!existing) {
                return { success: false };
            }
            if (payload.taskId && existing.taskId !== payload.taskId) {
                return { success: false };
            }
            if (payload.remoteSessionId && existing.remoteSessionId && existing.remoteSessionId !== payload.remoteSessionId) {
                return { success: false };
            }
            if (existing.status !== 'pending') {
                return { success: true, event: existing };
            }
            const updated: ChannelDeliveryEvent = {
                ...existing,
                deliveryAttempts: (existing.deliveryAttempts ?? 0) + 1,
                lastDeliveredAt: input.getNowIso(),
            };
            channelDeliveryEvents.set(updated.id, updated);
            return {
                success: true,
                event: updated,
            };
        }
        const marked = input.remoteSessionStore.markChannelEventDelivered(payload);
        if (marked.success && marked.event) {
            channelDeliveryEvents.set(marked.event.id, marked.event);
        }
        return marked;
    };

    return {
        hydrateChannelDeliveryEvents,
        upsertRemoteSessionRecord,
        heartbeatRemoteSessionRecord,
        closeRemoteSessionRecord,
        enqueueChannelDeliveryEvent,
        listChannelDeliveryEvents,
        ackChannelDeliveryEvent,
        getChannelDeliveryEvent,
        markChannelDeliveryDelivered,
    };
}
