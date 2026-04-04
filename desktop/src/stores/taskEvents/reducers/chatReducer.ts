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

function hasExplicitNonChatTaskMode(taskMode: TaskSession['taskMode']): boolean {
    return taskMode === 'immediate_task'
        || taskMode === 'scheduled_task'
        || taskMode === 'scheduled_multi_task';
}

function inferRouteModeFromText(value: string | undefined): 'chat' | 'task' | null {
    if (typeof value !== 'string') {
        return null;
    }
    const matched = value.match(/^\s*__route_(chat|task)__\b/iu);
    const mode = matched?.[1]?.toLowerCase();
    if (mode === 'chat' || mode === 'task') {
        return mode;
    }
    return null;
}

function shouldTreatAssistantReplyAsChatCompletion(session: TaskSession): boolean {
    if (session.taskMode === 'chat') {
        return true;
    }
    if (hasExplicitNonChatTaskMode(session.taskMode)) {
        return false;
    }

    for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index];
        const payload = (event.payload as Record<string, unknown> | undefined) ?? {};

        if (event.type === 'TASK_PLAN_READY') {
            const mode = payload.mode;
            if (mode === 'chat') {
                return true;
            }
            if (
                mode === 'immediate_task'
                || mode === 'scheduled_task'
                || mode === 'scheduled_multi_task'
            ) {
                return false;
            }
        }

        if (event.type !== 'TASK_STARTED') {
            continue;
        }

        const context = ((payload.context as Record<string, unknown> | undefined) ?? {});
        if (context.scheduled === true) {
            return false;
        }
        if (context.mode === 'chat') {
            return true;
        }
        if (
            context.mode === 'immediate_task'
            || context.mode === 'scheduled_task'
            || context.mode === 'scheduled_multi_task'
        ) {
            return false;
        }

        const routedContextMode = inferRouteModeFromText(
            typeof context.userQuery === 'string' ? context.userQuery : undefined,
        );
        if (routedContextMode === 'chat') {
            return true;
        }
        if (routedContextMode === 'task') {
            return false;
        }

        const routedDescriptionMode = inferRouteModeFromText(
            typeof payload.description === 'string' ? payload.description : undefined,
        );
        if (routedDescriptionMode === 'chat') {
            return true;
        }
        if (routedDescriptionMode === 'task') {
            return false;
        }
    }

    return false;
}

export function applyChatEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'CHAT_MESSAGE': {
            const role = (payload.role as 'user' | 'assistant' | 'system') ?? 'system';
            const content = (payload.content as string) ?? '';
            const nextTitle = role === 'user' ? summarizeUserTitle(content) : '';
            const shouldSetChatFinished = role === 'assistant'
                && content.trim().length > 0
                && shouldTreatAssistantReplyAsChatCompletion(session);
            const nextAssistantDraft = role === 'user'
                ? undefined
                : (role === 'assistant' ? content : session.assistantDraft);
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
                    },
                ],
                status: shouldSetChatFinished ? 'finished' : session.status,
                failure: shouldSetChatFinished ? undefined : session.failure,
                blockingReason: shouldSetChatFinished ? undefined : session.blockingReason,
            };
        }

        case 'TEXT_DELTA': {
            const role = payload.role as string | undefined;
            if (role === 'thinking') {
                return session;
            }
            const delta = (payload.delta as string) ?? '';
            const draft = (session.assistantDraft ?? '') + delta;
            let messages = session.messages;

            if (messages.length === 0 || messages[messages.length - 1].role !== 'assistant') {
                messages = [
                    ...messages,
                    {
                        id: event.id,
                        role: 'assistant',
                        content: draft,
                        timestamp: event.timestamp,
                    },
                ];
            } else {
                const last = messages[messages.length - 1];
                messages = [
                    ...messages.slice(0, -1),
                    {
                        ...last,
                        content: draft,
                    },
                ];
            }

            const shouldSetChatFinished = shouldTreatAssistantReplyAsChatCompletion(session);
            return {
                ...session,
                assistantDraft: draft,
                messages,
                status: shouldSetChatFinished ? 'finished' : session.status,
                failure: shouldSetChatFinished ? undefined : session.failure,
                blockingReason: shouldSetChatFinished ? undefined : session.blockingReason,
            };
        }

        default:
            return session;
    }
}
