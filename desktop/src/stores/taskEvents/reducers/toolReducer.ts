/**
 * Tool Reducer
 *
 * Handles TOOL_CALLED and TOOL_RESULT events
 */

import type { TaskSession, TaskEvent } from '../../../types';

function appendSystemMessage(session: TaskSession, event: TaskEvent, content: string): TaskSession {
    return {
        ...session,
        messages: [
            ...session.messages,
            {
                id: event.id,
                role: 'system',
                content,
                timestamp: event.timestamp,
            },
        ],
    };
}

export function applyToolEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'TOOL_CALLED':
            return appendSystemMessage(
                {
                    ...session,
                    toolCalls: [
                        ...session.toolCalls,
                        {
                            toolName: payload.toolName as string,
                            toolId: payload.toolId as string,
                            source: payload.source as string,
                        },
                    ],
                },
                event,
                `Tool called: ${(payload.toolName as string) || 'unknown'}`
            );

        case 'TOOL_RESULT': {
            const summary =
                (payload.resultSummary as string | undefined) ??
                (payload.success ? 'Tool finished successfully' : 'Tool failed');
            return appendSystemMessage(session, event, `Tool result: ${summary}`);
        }

        default:
            return session;
    }
}
