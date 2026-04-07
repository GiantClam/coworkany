import type {
    CanonicalStreamEvent,
    CanonicalTaskMessage,
} from '../../../sidecar/src/protocol';

export type CanonicalTaskStreamState = {
    taskId: string;
    messages: CanonicalTaskMessage[];
};

export function createEmptyCanonicalTaskStreamState(taskId: string): CanonicalTaskStreamState {
    return {
        taskId,
        messages: [],
    };
}

function sortMessages(messages: CanonicalTaskMessage[]): CanonicalTaskMessage[] {
    return [...messages].sort((left, right) => {
        if (left.sequence !== right.sequence) {
            return left.sequence - right.sequence;
        }
        return left.timestamp.localeCompare(right.timestamp);
    });
}

function findMessageIndex(
    messages: CanonicalTaskMessage[],
    message: Pick<CanonicalTaskMessage, 'id' | 'correlationId' | 'turnId'>,
): number {
    const turnId = message.turnId ?? '';
    const exactIndex = messages.findIndex((entry) => (
        entry.id === message.id
        && (entry.turnId ?? '') === turnId
    ));
    if (exactIndex >= 0) {
        return exactIndex;
    }

    if (!message.turnId) {
        const legacyExactIndex = messages.findIndex((entry) => entry.id === message.id && !entry.turnId);
        if (legacyExactIndex >= 0) {
            return legacyExactIndex;
        }
    }

    if (!message.correlationId) {
        return -1;
    }

    const correlatedIndex = messages.findIndex((entry) => (
        (entry.id === message.correlationId || entry.correlationId === message.correlationId)
        && (entry.turnId ?? '') === turnId
    ));
    if (correlatedIndex >= 0) {
        return correlatedIndex;
    }

    if (!message.turnId) {
        return messages.findIndex((entry) =>
            !entry.turnId
            && (entry.id === message.correlationId || entry.correlationId === message.correlationId)
        );
    }

    return -1;
}

function mergeCanonicalMessage(
    messages: CanonicalTaskMessage[],
    nextMessage: CanonicalTaskMessage,
): CanonicalTaskMessage[] {
    const existingIndex = findMessageIndex(messages, nextMessage);
    if (existingIndex < 0) {
        return sortMessages([...messages, nextMessage]);
    }

    const next = [...messages];
    next[existingIndex] = nextMessage;
    return sortMessages(next);
}

function mergeAssistantStreamDelta(previous: string, delta: string): string {
    if (delta.length === 0) {
        return previous;
    }
    if (previous.length === 0) {
        return delta;
    }
    if (previous.endsWith(delta)) {
        return previous;
    }
    if (delta.startsWith(previous)) {
        return delta;
    }

    const normalizeComparableText = (value: string): string => value.trim().replace(/\s+/g, ' ');
    const normalizedPrevious = normalizeComparableText(previous);
    const normalizedDelta = normalizeComparableText(delta);
    if (normalizedPrevious.length > 0 && normalizedDelta.length > 0) {
        if (normalizedPrevious === normalizedDelta) {
            return delta.length >= previous.length ? delta : previous;
        }

        const shorter = normalizedPrevious.length <= normalizedDelta.length ? normalizedPrevious : normalizedDelta;
        const longer = normalizedPrevious.length <= normalizedDelta.length ? normalizedDelta : normalizedPrevious;
        if (
            shorter.length >= 16
            && longer.includes(shorter)
            && shorter.length / longer.length >= 0.55
        ) {
            return normalizedDelta.length >= normalizedPrevious.length ? delta : previous;
        }

        let sharedPrefix = 0;
        const prefixLimit = Math.min(normalizedPrevious.length, normalizedDelta.length);
        while (
            sharedPrefix < prefixLimit
            && normalizedPrevious[sharedPrefix] === normalizedDelta[sharedPrefix]
        ) {
            sharedPrefix += 1;
        }
        if (
            sharedPrefix >= 10
            && Math.min(normalizedPrevious.length, normalizedDelta.length) >= 20
            && sharedPrefix / Math.min(normalizedPrevious.length, normalizedDelta.length) >= 0.2
        ) {
            return normalizedDelta.length >= normalizedPrevious.length ? delta : previous;
        }
    }

    const maxOverlap = Math.min(previous.length, delta.length);
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
        if (previous.slice(previous.length - overlap) === delta.slice(0, overlap)) {
            return previous + delta.slice(overlap);
        }
    }

    return previous + delta;
}

function applyMessageDelta(
    messages: CanonicalTaskMessage[],
    event: Extract<CanonicalStreamEvent, { type: 'canonical_message_delta' }>,
): CanonicalTaskMessage[] {
    let existingIndex = findMessageIndex(messages, {
        id: event.payload.id,
        correlationId: event.payload.correlationId,
        turnId: event.payload.turnId,
    });
    const hasExplicitIdentity = Boolean(
        event.payload.correlationId
        || (event.payload.id && event.payload.id !== event.payload.sourceEventId),
    );
    if (existingIndex < 0 && !hasExplicitIdentity) {
        const lastMessage = messages[messages.length - 1];
        if (
            lastMessage
            && lastMessage.role === 'assistant'
            && lastMessage.status === 'streaming'
            && lastMessage.sourceEventType === 'TEXT_DELTA'
            && (lastMessage.turnId ?? '') === (event.payload.turnId ?? '')
        ) {
            existingIndex = messages.length - 1;
        }
    }
    if (existingIndex < 0 && event.payload.turnId) {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const candidate = messages[index];
            if (
                candidate.role === event.payload.role
                && (candidate.turnId ?? '') === event.payload.turnId
                && candidate.sourceEventType === 'TEXT_DELTA'
            ) {
                existingIndex = index;
                break;
            }
        }
    }
    const existing = existingIndex >= 0 ? messages[existingIndex] : undefined;
    const nextMessage: CanonicalTaskMessage = existing
        ? { ...existing }
        : {
            id: event.payload.id,
            taskId: event.payload.taskId,
            turnId: event.payload.turnId,
            role: event.payload.role,
            timestamp: event.payload.timestamp,
            sequence: event.payload.sequence,
            correlationId: event.payload.correlationId,
            sourceEventId: event.payload.sourceEventId,
            sourceEventType: event.payload.sourceEventType,
            status: 'streaming',
            parts: [],
        };

    const previousPart = nextMessage.parts[nextMessage.parts.length - 1];
    if (event.payload.part.type === 'text') {
        if (previousPart?.type === 'text') {
            nextMessage.parts = [
                ...nextMessage.parts.slice(0, -1),
                { ...previousPart, text: mergeAssistantStreamDelta(previousPart.text, event.payload.part.delta) },
            ];
        } else {
            nextMessage.parts = [...nextMessage.parts, { type: 'text', text: event.payload.part.delta }];
        }
    } else if (previousPart?.type === 'reasoning') {
        nextMessage.parts = [
            ...nextMessage.parts.slice(0, -1),
            { ...previousPart, text: mergeAssistantStreamDelta(previousPart.text, event.payload.part.delta) },
        ];
    } else {
        nextMessage.parts = [...nextMessage.parts, { type: 'reasoning', text: event.payload.part.delta }];
    }

    nextMessage.status = 'streaming';
    nextMessage.sequence = event.payload.sequence;
    nextMessage.timestamp = event.payload.timestamp;
    nextMessage.turnId = event.payload.turnId ?? nextMessage.turnId;

    return mergeCanonicalMessage(messages, nextMessage);
}

export function applyCanonicalStreamEvent(
    state: CanonicalTaskStreamState,
    event: CanonicalStreamEvent,
): CanonicalTaskStreamState {
    if (event.type === 'canonical_message') {
        return {
            ...state,
            messages: mergeCanonicalMessage(state.messages, event.payload),
        };
    }

    return {
        ...state,
        messages: applyMessageDelta(state.messages, event),
    };
}

export function materializeCanonicalMessages(
    taskId: string,
    events: CanonicalStreamEvent[],
): CanonicalTaskMessage[] {
    if (events.length === 0) {
        return [];
    }

    return events.reduce(
        (state, event) => applyCanonicalStreamEvent(state, event),
        createEmptyCanonicalTaskStreamState(taskId),
    ).messages;
}
