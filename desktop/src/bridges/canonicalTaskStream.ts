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
                { ...previousPart, text: previousPart.text + event.payload.part.delta },
            ];
        } else {
            nextMessage.parts = [...nextMessage.parts, { type: 'text', text: event.payload.part.delta }];
        }
    } else if (previousPart?.type === 'reasoning') {
        nextMessage.parts = [
            ...nextMessage.parts.slice(0, -1),
            { ...previousPart, text: previousPart.text + event.payload.part.delta },
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
