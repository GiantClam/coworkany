import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    emitRuntimeHookEvent,
    registerRuntimeHookEventHandler,
    setAllRuntimeHookEventsEnabled,
    clearRuntimeHookEventState,
    type RuntimeHookEventHandler,
} from './hookEventBus';

export type HookRuntimeEventType =
    | 'SessionStart'
    | 'TaskCreated'
    | 'RemoteSessionLinked'
    | 'ChannelEventInjected'
    | 'PermissionRequest'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PreCompact'
    | 'PostCompact'
    | 'TaskCompleted'
    | 'TaskFailed'
    | 'TaskRewound';

export type HookRuntimeEvent = {
    id: string;
    at: string;
    type: HookRuntimeEventType;
    taskId?: string;
    runId?: string;
    traceId?: string;
    payload?: Record<string, unknown>;
};

export type HookRuntime = {
    emit: (event: Omit<HookRuntimeEvent, 'id' | 'at'>) => HookRuntimeEvent;
    list: (input?: { taskId?: string; limit?: number; type?: HookRuntimeEventType }) => HookRuntimeEvent[];
};

export function registerHookRuntimeEventHandler(handler: RuntimeHookEventHandler | null): void {
    registerRuntimeHookEventHandler(handler);
}

export function setHookRuntimeEventsEnabled(enabled: boolean): void {
    setAllRuntimeHookEventsEnabled(enabled);
}

export function clearHookRuntimeEvents(): void {
    clearRuntimeHookEventState();
}

function pickNonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function isHookRuntimeEventType(value: unknown): value is HookRuntimeEventType {
    return value === 'SessionStart'
        || value === 'TaskCreated'
        || value === 'RemoteSessionLinked'
        || value === 'ChannelEventInjected'
        || value === 'PermissionRequest'
        || value === 'PreToolUse'
        || value === 'PostToolUse'
        || value === 'PreCompact'
        || value === 'PostCompact'
        || value === 'TaskCompleted'
        || value === 'TaskFailed'
        || value === 'TaskRewound';
}

export class MastraHookRuntimeStore implements HookRuntime {
    private readonly filePath: string;
    private readonly events: HookRuntimeEvent[] = [];
    private readonly maxEvents: number;

    constructor(filePath: string, maxEvents = 6000) {
        this.filePath = filePath;
        this.maxEvents = Math.max(500, Math.floor(maxEvents));
        this.load();
    }

    emit(event: Omit<HookRuntimeEvent, 'id' | 'at'>): HookRuntimeEvent {
        const next: HookRuntimeEvent = {
            id: randomUUID(),
            at: new Date().toISOString(),
            ...event,
        };
        this.events.push(next);
        this.compactIfNeeded();
        this.save();
        emitRuntimeHookEvent({
            id: next.id,
            at: next.at,
            type: next.type,
            taskId: next.taskId,
            runId: next.runId,
            traceId: next.traceId,
            payload: next.payload,
        });
        return next;
    }

    list(input?: { taskId?: string; limit?: number; type?: HookRuntimeEventType }): HookRuntimeEvent[] {
        const taskId = pickNonEmptyString(input?.taskId);
        const type = input?.type;
        const filtered = this.events.filter((event) => {
            if (taskId && event.taskId !== taskId) {
                return false;
            }
            if (type && event.type !== type) {
                return false;
            }
            return true;
        });
        const limit = typeof input?.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
            ? Math.floor(input.limit)
            : undefined;
        if (typeof limit === 'number') {
            return filtered.slice(-limit);
        }
        return filtered;
    }

    private compactIfNeeded(): void {
        if (this.events.length <= this.maxEvents) {
            return;
        }
        this.events.splice(0, this.events.length - this.maxEvents);
    }

    private load(): void {
        if (!fs.existsSync(this.filePath)) {
            return;
        }
        try {
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
            if (!Array.isArray(raw)) {
                return;
            }
            for (const value of raw) {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    continue;
                }
                const record = value as Record<string, unknown>;
                if (!isHookRuntimeEventType(record.type)) {
                    continue;
                }
                const id = pickNonEmptyString(record.id);
                const at = pickNonEmptyString(record.at);
                if (!id || !at) {
                    continue;
                }
                const event: HookRuntimeEvent = {
                    id,
                    at,
                    type: record.type,
                    taskId: pickNonEmptyString(record.taskId),
                    runId: pickNonEmptyString(record.runId),
                    traceId: pickNonEmptyString(record.traceId),
                    payload: record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
                        ? record.payload as Record<string, unknown>
                        : undefined,
                };
                this.events.push(event);
            }
            this.compactIfNeeded();
        } catch (error) {
            console.error('[MastraHookRuntimeStore] Failed to load hook runtime store:', error);
        }
    }

    private save(): void {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const tempPath = `${this.filePath}.tmp`;
            fs.writeFileSync(tempPath, JSON.stringify(this.events, null, 2), 'utf-8');
            fs.renameSync(tempPath, this.filePath);
        } catch (error) {
            console.error('[MastraHookRuntimeStore] Failed to persist hook runtime store:', error);
        }
    }
}
