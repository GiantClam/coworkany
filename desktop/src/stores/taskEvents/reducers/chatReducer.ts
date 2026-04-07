/**
 * Chat Reducer
 *
 * Handles CHAT_MESSAGE and TEXT_DELTA events
 */

import type { TaskSession, TaskEvent } from '../../../types';

function summarizeUserTitle(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.startsWith('[RESUME_REQUESTED]')) {
        return '';
    }
    return normalized.length > 80 ? `${normalized.slice(0, 79)}…` : normalized;
}

function normalizeComparableText(content: string): string {
    return content.trim().replace(/\s+/g, ' ');
}

function toOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function isSyntheticFailureAssistantMessageId(messageId: string | undefined): boolean {
    return typeof messageId === 'string' && messageId.startsWith('task-failed:');
}

function findAssistantMessageIndex(
    messages: TaskSession['messages'],
    identity: {
        turnId?: string;
        messageId?: string;
        correlationId?: string;
    },
): number {
    const turnId = identity.turnId;
    const messageId = identity.messageId;
    const correlationId = identity.correlationId;
    const normalizedCorrelationId = correlationId && correlationId.trim().length > 0
        ? correlationId
        : undefined;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const candidate = messages[index];
        if (candidate.role !== 'assistant') {
            continue;
        }
        if (isSyntheticFailureAssistantMessageId(candidate.id) || isSyntheticFailureAssistantMessageId(candidate.messageId)) {
            continue;
        }
        if (turnId && candidate.turnId === turnId) {
            return index;
        }
        if (messageId && candidate.messageId === messageId) {
            return index;
        }
        if (
            normalizedCorrelationId
            && (candidate.correlationId === normalizedCorrelationId || candidate.messageId === normalizedCorrelationId)
        ) {
            return index;
        }
    }

    return -1;
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

export function applyChatEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'CHAT_MESSAGE': {
            const role = (payload.role as 'user' | 'assistant' | 'system') ?? 'system';
            const content = (payload.content as string) ?? '';
            const turnId = toOptionalString(payload.turnId);
            const messageId = toOptionalString(payload.messageId);
            const correlationId = toOptionalString(payload.correlationId);
            const nextTitle = role === 'user' ? summarizeUserTitle(content) : '';
            const nextAssistantDraft = role === 'user'
                ? undefined
                : (role === 'assistant' ? content : session.assistantDraft);
            if (role === 'assistant') {
                const existingAssistantIndex = findAssistantMessageIndex(session.messages, {
                    turnId,
                    messageId,
                    correlationId,
                });
                if (existingAssistantIndex >= 0) {
                    const existing = session.messages[existingAssistantIndex];
                    const nextContent = normalizeComparableText(existing.content) === normalizeComparableText(content)
                        ? existing.content
                        : content;
                    return {
                        ...session,
                        title: nextTitle || session.title,
                        assistantDraft: nextAssistantDraft,
                        messages: [
                            ...session.messages.slice(0, existingAssistantIndex),
                            {
                                ...existing,
                                content: nextContent,
                                timestamp: event.timestamp,
                                turnId: turnId ?? existing.turnId,
                                messageId: messageId ?? existing.messageId,
                                correlationId: correlationId ?? existing.correlationId,
                            },
                            ...session.messages.slice(existingAssistantIndex + 1),
                        ],
                        status: session.status,
                        failure: session.failure,
                        blockingReason: session.blockingReason,
                    };
                }
            }
            const lastMessage = session.messages[session.messages.length - 1];
            const shouldSkipDuplicateAssistantMessage = role === 'assistant'
                && Boolean(lastMessage)
                && lastMessage.role === 'assistant'
                && normalizeComparableText(lastMessage.content) === normalizeComparableText(content)
                && (
                    (turnId !== undefined && lastMessage.turnId === turnId)
                    || (messageId !== undefined && lastMessage.messageId === messageId)
                    || (turnId === undefined && messageId === undefined)
                );
            if (shouldSkipDuplicateAssistantMessage) {
                return {
                    ...session,
                    title: nextTitle || session.title,
                    assistantDraft: nextAssistantDraft,
                    status: session.status,
                    failure: session.failure,
                    blockingReason: session.blockingReason,
                };
            }
            return {
                ...session,
                title: nextTitle || session.title,
                assistantDraft: nextAssistantDraft,
                messages: [
                    ...session.messages,
                    {
                        id: event.id,
                        role,
                        content,
                        timestamp: event.timestamp,
                        turnId,
                        messageId,
                        correlationId,
                    },
                ],
                status: session.status,
                failure: session.failure,
                blockingReason: session.blockingReason,
            };
        }

        case 'TEXT_DELTA': {
            const role = payload.role as string | undefined;
            if (role === 'thinking') {
                return session;
            }
            const delta = (payload.delta as string) ?? '';
            if (delta.length === 0) {
                return session;
            }
            const turnId = toOptionalString(payload.turnId);
            const messageId = toOptionalString(payload.messageId);
            const correlationId = toOptionalString(payload.correlationId);
            let messages = session.messages;
            const lastMessage = messages[messages.length - 1];
            const canAppendToLastAssistant = Boolean(lastMessage)
                && lastMessage.role === 'assistant'
                && !isSyntheticFailureAssistantMessageId(lastMessage.id)
                && !isSyntheticFailureAssistantMessageId(lastMessage.messageId)
                && (
                    (turnId !== undefined && lastMessage.turnId === turnId)
                    || (messageId !== undefined && lastMessage.messageId === messageId)
                    || (turnId === undefined && messageId === undefined)
                );
            const existingAssistantIndex = canAppendToLastAssistant
                ? messages.length - 1
                : findAssistantMessageIndex(messages, {
                    turnId,
                    messageId,
                    correlationId,
                });
            const existingAssistant = existingAssistantIndex >= 0 ? messages[existingAssistantIndex] : undefined;
            const previousContent = existingAssistant?.content ?? '';
            const shouldMergeWithExisting = existingAssistantIndex >= 0;
            const draft = shouldMergeWithExisting
                ? mergeAssistantStreamDelta(previousContent, delta)
                : delta;

            if (existingAssistantIndex < 0) {
                messages = [
                    ...messages,
                    {
                        id: event.id,
                        role: 'assistant',
                        content: draft,
                        timestamp: event.timestamp,
                        turnId,
                        messageId,
                        correlationId,
                    },
                ];
            } else {
                const targetAssistant = existingAssistant ?? messages[existingAssistantIndex];
                if (!targetAssistant) {
                    return session;
                }
                messages = [
                    ...messages.slice(0, existingAssistantIndex),
                    {
                        ...targetAssistant,
                        content: draft,
                        timestamp: event.timestamp,
                        turnId: turnId ?? targetAssistant.turnId,
                        messageId: messageId ?? targetAssistant.messageId,
                        correlationId: correlationId ?? targetAssistant.correlationId,
                    },
                    ...messages.slice(existingAssistantIndex + 1),
                ];
            }

            return {
                ...session,
                assistantDraft: draft,
                messages,
                status: session.status,
                failure: session.failure,
                blockingReason: session.blockingReason,
            };
        }

        default:
            return session;
    }
}
