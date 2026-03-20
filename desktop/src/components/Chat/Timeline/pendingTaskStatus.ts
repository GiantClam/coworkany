import type { TaskEvent, TaskSession } from '../../../types';

export type PendingTaskPhase = 'waiting_for_model' | 'running_tool' | 'retrying';

export interface PendingTaskStatus {
    phase: PendingTaskPhase;
    toolName?: string;
}

function isAssistantResponse(event: TaskEvent): boolean {
    const payload = event.payload as Record<string, unknown>;

    if (event.type === 'TEXT_DELTA') {
        return payload.role !== 'thinking' && typeof payload.delta === 'string' && payload.delta.length > 0;
    }

    return event.type === 'CHAT_MESSAGE' && payload.role === 'assistant' && typeof payload.content === 'string' && payload.content.length > 0;
}

function isUserTurnBoundary(event: TaskEvent): boolean {
    const payload = event.payload as Record<string, unknown>;
    return event.type === 'TASK_STARTED' || (event.type === 'CHAT_MESSAGE' && payload.role === 'user');
}

export function getPendingTaskStatus(session: Pick<TaskSession, 'status' | 'events'>): PendingTaskStatus | null {
    if (session.status !== 'running' || session.events.length === 0) {
        return null;
    }

    let latestRateLimited = false;
    const completedTools = new Set<string>();

    for (let index = session.events.length - 1; index >= 0; index -= 1) {
        const event = session.events[index];
        const payload = event.payload as Record<string, unknown>;

        if (isUserTurnBoundary(event)) {
            break;
        }

        if (isAssistantResponse(event)) {
            return null;
        }

        switch (event.type) {
            case 'RATE_LIMITED':
                latestRateLimited = true;
                break;
            case 'TOOL_RESULT':
                if (typeof payload.toolId === 'string') {
                    completedTools.add(payload.toolId);
                }
                break;
            case 'TOOL_CALLED':
                if (
                    typeof payload.toolId === 'string' &&
                    typeof payload.toolName === 'string' &&
                    !completedTools.has(payload.toolId)
                ) {
                    return { phase: 'running_tool', toolName: payload.toolName };
                }
                break;
            default:
                break;
        }
    }

    if (latestRateLimited) {
        return { phase: 'retrying' };
    }

    return { phase: 'waiting_for_model' };
}
