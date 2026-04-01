import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type RemoteSessionStatus = 'active' | 'closed';
export type ChannelDeliveryStatus = 'pending' | 'acked';

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

function pickNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeMetadata(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value as Record<string, unknown>;
}

function toRemoteSessionState(value: unknown): RemoteSessionState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const raw = value as Record<string, unknown>;
    const remoteSessionId = pickNonEmptyString(raw.remoteSessionId);
    const taskId = pickNonEmptyString(raw.taskId);
    const linkedAt = pickNonEmptyString(raw.linkedAt);
    const lastSeenAt = pickNonEmptyString(raw.lastSeenAt);
    const status = raw.status === 'closed' ? 'closed' : (raw.status === 'active' ? 'active' : null);
    if (!remoteSessionId || !taskId || !linkedAt || !lastSeenAt || !status) {
        return null;
    }
    return {
        remoteSessionId,
        taskId,
        channel: pickNonEmptyString(raw.channel),
        status,
        linkedAt,
        lastSeenAt,
        metadata: sanitizeMetadata(raw.metadata),
    };
}

function toChannelDeliveryEvent(value: unknown): ChannelDeliveryEvent | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const raw = value as Record<string, unknown>;
    const id = pickNonEmptyString(raw.id);
    const taskId = pickNonEmptyString(raw.taskId);
    const channel = pickNonEmptyString(raw.channel);
    const eventType = pickNonEmptyString(raw.eventType);
    const injectedAt = pickNonEmptyString(raw.injectedAt);
    const status = raw.status === 'acked'
        ? 'acked'
        : (raw.status === 'pending' ? 'pending' : null);
    if (!id || !taskId || !channel || !eventType || !injectedAt || !status) {
        return null;
    }
    return {
        id,
        taskId,
        remoteSessionId: pickNonEmptyString(raw.remoteSessionId),
        channel,
        eventType,
        content: pickNonEmptyString(raw.content),
        metadata: sanitizeMetadata(raw.metadata),
        injectedAt,
        status,
        deliveryAttempts: (
            typeof raw.deliveryAttempts === 'number'
            && Number.isFinite(raw.deliveryAttempts)
            && raw.deliveryAttempts >= 0
        )
            ? Math.floor(raw.deliveryAttempts)
            : 0,
        lastDeliveredAt: pickNonEmptyString(raw.lastDeliveredAt),
        ackedAt: pickNonEmptyString(raw.ackedAt),
        ackMetadata: sanitizeMetadata(raw.ackMetadata),
    };
}

function cloneState(state: RemoteSessionState): RemoteSessionState {
    return {
        ...state,
        metadata: state.metadata ? { ...state.metadata } : undefined,
    };
}

function cloneChannelEvent(event: ChannelDeliveryEvent): ChannelDeliveryEvent {
    return {
        ...event,
        metadata: event.metadata ? { ...event.metadata } : undefined,
        ackMetadata: event.ackMetadata ? { ...event.ackMetadata } : undefined,
    };
}

export class MastraRemoteSessionStore {
    private readonly filePath: string;
    private readonly records = new Map<string, RemoteSessionState>();
    private readonly channelEvents = new Map<string, ChannelDeliveryEvent>();

    constructor(filePath: string) {
        this.filePath = filePath;
        this.load();
    }

    list(input?: { taskId?: string; status?: RemoteSessionStatus }): RemoteSessionState[] {
        const taskId = pickNonEmptyString(input?.taskId);
        const status = input?.status;
        return Array
            .from(this.records.values())
            .filter((record) => !taskId || record.taskId === taskId)
            .filter((record) => !status || record.status === status)
            .map(cloneState)
            .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
    }

    get(remoteSessionId: string): RemoteSessionState | undefined {
        const normalized = pickNonEmptyString(remoteSessionId);
        if (!normalized) {
            return undefined;
        }
        const record = this.records.get(normalized);
        return record ? cloneState(record) : undefined;
    }

    upsertLink(input: {
        remoteSessionId: string;
        taskId: string;
        channel?: string;
        metadata?: Record<string, unknown>;
    }): { success: boolean; conflict?: boolean; state?: RemoteSessionState } {
        const remoteSessionId = pickNonEmptyString(input.remoteSessionId);
        const taskId = pickNonEmptyString(input.taskId);
        if (!remoteSessionId || !taskId) {
            return { success: false };
        }
        const now = new Date().toISOString();
        const existing = this.records.get(remoteSessionId);
        if (existing && existing.taskId !== taskId && existing.status === 'active') {
            return {
                success: false,
                conflict: true,
                state: cloneState(existing),
            };
        }
        const next: RemoteSessionState = {
            remoteSessionId,
            taskId,
            channel: pickNonEmptyString(input.channel) ?? existing?.channel,
            status: 'active',
            linkedAt: existing?.linkedAt ?? now,
            lastSeenAt: now,
            metadata: input.metadata ?? existing?.metadata,
        };
        this.records.set(remoteSessionId, next);
        this.save();
        return {
            success: true,
            state: cloneState(next),
        };
    }

    heartbeat(remoteSessionId: string, metadata?: Record<string, unknown>): {
        success: boolean;
        state?: RemoteSessionState;
    } {
        const normalized = pickNonEmptyString(remoteSessionId);
        if (!normalized) {
            return { success: false };
        }
        const existing = this.records.get(normalized);
        if (!existing) {
            return { success: false };
        }
        const next: RemoteSessionState = {
            ...existing,
            status: 'active',
            lastSeenAt: new Date().toISOString(),
            metadata: metadata ?? existing.metadata,
        };
        this.records.set(normalized, next);
        this.save();
        return {
            success: true,
            state: cloneState(next),
        };
    }

    close(remoteSessionId: string): {
        success: boolean;
        state?: RemoteSessionState;
    } {
        const normalized = pickNonEmptyString(remoteSessionId);
        if (!normalized) {
            return { success: false };
        }
        const existing = this.records.get(normalized);
        if (!existing) {
            return { success: false };
        }
        const next: RemoteSessionState = {
            ...existing,
            status: 'closed',
            lastSeenAt: new Date().toISOString(),
        };
        this.records.set(normalized, next);
        this.save();
        return {
            success: true,
            state: cloneState(next),
        };
    }

    getChannelEvent(eventId: string): ChannelDeliveryEvent | undefined {
        const normalized = pickNonEmptyString(eventId);
        if (!normalized) {
            return undefined;
        }
        const event = this.channelEvents.get(normalized);
        return event ? cloneChannelEvent(event) : undefined;
    }

    enqueueChannelEvent(input: {
        taskId: string;
        remoteSessionId?: string;
        channel: string;
        eventType: string;
        content?: string;
        metadata?: Record<string, unknown>;
        eventId?: string;
        forceRequeue?: boolean;
    }): { success: boolean; event?: ChannelDeliveryEvent; deduplicated?: boolean; requeued?: boolean } {
        const taskId = pickNonEmptyString(input.taskId);
        const channel = pickNonEmptyString(input.channel);
        const eventType = pickNonEmptyString(input.eventType);
        if (!taskId || !channel || !eventType) {
            return { success: false };
        }
        const eventId = pickNonEmptyString(input.eventId) ?? `delivery-${randomUUID()}`;
        const existing = this.channelEvents.get(eventId);
        if (existing && input.forceRequeue !== true) {
            return {
                success: true,
                event: cloneChannelEvent(existing),
                deduplicated: true,
                requeued: false,
            };
        }
        const now = new Date().toISOString();
        const next: ChannelDeliveryEvent = {
            id: eventId,
            taskId,
            remoteSessionId: pickNonEmptyString(input.remoteSessionId),
            channel,
            eventType,
            content: pickNonEmptyString(input.content),
            metadata: input.metadata ?? existing?.metadata,
            injectedAt: existing?.injectedAt ?? now,
            status: 'pending',
            deliveryAttempts: existing?.deliveryAttempts ?? 0,
            lastDeliveredAt: existing?.lastDeliveredAt,
            ackedAt: undefined,
            ackMetadata: undefined,
        };
        this.channelEvents.set(eventId, next);
        this.save();
        return {
            success: true,
            event: cloneChannelEvent(next),
            deduplicated: false,
            requeued: Boolean(existing),
        };
    }

    markChannelEventDelivered(input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
    }): { success: boolean; event?: ChannelDeliveryEvent } {
        const eventId = pickNonEmptyString(input.eventId);
        if (!eventId) {
            return { success: false };
        }
        const existing = this.channelEvents.get(eventId);
        if (!existing) {
            return { success: false };
        }
        const taskId = pickNonEmptyString(input.taskId);
        if (taskId && existing.taskId !== taskId) {
            return { success: false };
        }
        const remoteSessionId = pickNonEmptyString(input.remoteSessionId);
        if (remoteSessionId && existing.remoteSessionId && existing.remoteSessionId !== remoteSessionId) {
            return { success: false };
        }
        if (existing.status !== 'pending') {
            return {
                success: true,
                event: cloneChannelEvent(existing),
            };
        }
        const next: ChannelDeliveryEvent = {
            ...existing,
            deliveryAttempts: (existing.deliveryAttempts ?? 0) + 1,
            lastDeliveredAt: new Date().toISOString(),
        };
        this.channelEvents.set(eventId, next);
        this.save();
        return {
            success: true,
            event: cloneChannelEvent(next),
        };
    }

    listChannelEvents(input?: {
        taskId?: string;
        remoteSessionId?: string;
        status?: ChannelDeliveryStatus;
        limit?: number;
    }): ChannelDeliveryEvent[] {
        const taskId = pickNonEmptyString(input?.taskId);
        const remoteSessionId = pickNonEmptyString(input?.remoteSessionId);
        const status = input?.status;
        const limit = typeof input?.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
            ? Math.floor(input.limit)
            : undefined;
        const listed = Array
            .from(this.channelEvents.values())
            .filter((event) => !taskId || event.taskId === taskId)
            .filter((event) => !remoteSessionId || event.remoteSessionId === remoteSessionId)
            .filter((event) => !status || event.status === status)
            .sort((left, right) => right.injectedAt.localeCompare(left.injectedAt))
            .map(cloneChannelEvent);
        return limit ? listed.slice(0, limit) : listed;
    }

    ackChannelEvent(input: {
        eventId: string;
        taskId?: string;
        remoteSessionId?: string;
        metadata?: Record<string, unknown>;
    }): { success: boolean; event?: ChannelDeliveryEvent } {
        const eventId = pickNonEmptyString(input.eventId);
        if (!eventId) {
            return { success: false };
        }
        const existing = this.channelEvents.get(eventId);
        if (!existing) {
            return { success: false };
        }
        const taskId = pickNonEmptyString(input.taskId);
        if (taskId && existing.taskId !== taskId) {
            return { success: false };
        }
        const remoteSessionId = pickNonEmptyString(input.remoteSessionId);
        if (remoteSessionId && existing.remoteSessionId !== remoteSessionId) {
            return { success: false };
        }
        const next: ChannelDeliveryEvent = {
            ...existing,
            status: 'acked',
            ackedAt: new Date().toISOString(),
            ackMetadata: input.metadata,
        };
        this.channelEvents.set(eventId, next);
        this.save();
        return {
            success: true,
            event: cloneChannelEvent(next),
        };
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            const envelope = (
                raw
                && typeof raw === 'object'
                && !Array.isArray(raw)
            )
                ? (raw as {
                    sessions?: unknown;
                    channelEvents?: unknown;
                })
                : null;
            const records = Array.isArray(raw)
                ? raw
                : (Array.isArray(envelope?.sessions) ? envelope.sessions : []);
            for (const record of records) {
                const state = toRemoteSessionState(record);
                if (!state) {
                    continue;
                }
                this.records.set(state.remoteSessionId, state);
            }
            const channelEvents = Array.isArray(envelope?.channelEvents)
                ? envelope.channelEvents
                : [];
            for (const channelEvent of channelEvents) {
                const event = toChannelDeliveryEvent(channelEvent);
                if (!event) {
                    continue;
                }
                this.channelEvents.set(event.id, event);
            }
        } catch (error) {
            console.error('[MastraRemoteSessionStore] Failed to load remote session store:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tempFile = `${this.filePath}.tmp`;
            const payload = {
                sessions: Array.from(this.records.values()).map(cloneState),
                channelEvents: Array.from(this.channelEvents.values()).map(cloneChannelEvent),
            };
            fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf-8');
            fs.renameSync(tempFile, this.filePath);
        } catch (error) {
            console.error('[MastraRemoteSessionStore] Failed to persist remote session store:', error);
        }
    }
}
