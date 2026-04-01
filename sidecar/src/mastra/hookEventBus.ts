// Ported and adapted from claude-code/src/utils/hooks/hookEvents.ts.
// Purpose: decouple runtime hook event emission from concrete consumers.

export type RuntimeHookEvent = {
    id: string;
    at: string;
    type: string;
    taskId?: string;
    runId?: string;
    traceId?: string;
    payload?: Record<string, unknown>;
};

export type RuntimeHookEventHandler = (event: RuntimeHookEvent) => void;

const ALWAYS_EMITTED_HOOK_EVENTS = ['SessionStart', 'TaskCreated'] as const;
const MAX_PENDING_EVENTS = 100;

const pendingEvents: RuntimeHookEvent[] = [];
let eventHandler: RuntimeHookEventHandler | null = null;
let allRuntimeHookEventsEnabled = false;

function shouldEmit(eventType: string): boolean {
    if ((ALWAYS_EMITTED_HOOK_EVENTS as readonly string[]).includes(eventType)) {
        return true;
    }
    return allRuntimeHookEventsEnabled;
}

function emitInternal(event: RuntimeHookEvent): void {
    if (eventHandler) {
        eventHandler(event);
        return;
    }
    pendingEvents.push(event);
    if (pendingEvents.length > MAX_PENDING_EVENTS) {
        pendingEvents.shift();
    }
}

export function registerRuntimeHookEventHandler(handler: RuntimeHookEventHandler | null): void {
    eventHandler = handler;
    if (!handler || pendingEvents.length === 0) {
        return;
    }
    for (const event of pendingEvents.splice(0, pendingEvents.length)) {
        handler(event);
    }
}

export function emitRuntimeHookEvent(event: RuntimeHookEvent): void {
    if (!shouldEmit(event.type)) {
        return;
    }
    emitInternal(event);
}

export function setAllRuntimeHookEventsEnabled(enabled: boolean): void {
    allRuntimeHookEventsEnabled = enabled;
}

export function clearRuntimeHookEventState(): void {
    eventHandler = null;
    pendingEvents.length = 0;
    allRuntimeHookEventsEnabled = false;
}
