/**
 * Chat Reducer
 *
 * Handles CHAT_MESSAGE and TEXT_DELTA events
 */

import type { TaskSession, TaskEvent } from '../../../types';

export function applyChatEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'CHAT_MESSAGE': {
            const role = (payload.role as 'user' | 'assistant' | 'system') ?? 'system';
            const content = (payload.content as string) ?? '';
            return {
                ...session,
                messages: [
                    ...session.messages,
                    {
                        id: event.id,
                        role,
                        content,
                        timestamp: event.timestamp,
                    },
                ],
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

            return {
                ...session,
                assistantDraft: draft,
                messages,
            };
        }

        default:
            return session;
    }
}
