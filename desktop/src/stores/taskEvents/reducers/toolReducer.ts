/**
 * Tool Reducer
 *
 * Handles TOOL_CALLED and TOOL_RESULT events
 */

import type { TaskSession, TaskEvent } from '../../../types';

export function applyToolEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'TOOL_CALLED':
            return {
                ...session,
                toolCalls: [
                    ...session.toolCalls,
                    {
                        toolName: payload.toolName as string,
                        toolId: payload.toolId as string,
                        source: payload.source as string,
                    },
                ],
            };

        case 'TOOL_RESULT': {
            return session;
        }

        default:
            return session;
    }
}
