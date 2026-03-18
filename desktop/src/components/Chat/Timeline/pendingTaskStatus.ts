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

    let lastUserTurnIndex = -1;
    for (let index = 0; index < session.events.length; index += 1) {
        if (isUserTurnBoundary(session.events[index])) {
            lastUserTurnIndex = index;
        }
    }

    if (lastUserTurnIndex === -1) {
        return { phase: 'waiting_for_model' };
    }

    let hasAssistantResponse = false;
    let latestRateLimited = false;
    const runningTools = new Map<string, string>();

    for (let index = lastUserTurnIndex + 1; index < session.events.length; index += 1) {
        const event = session.events[index];
        const payload = event.payload as Record<string, unknown>;

        if (isAssistantResponse(event)) {
            hasAssistantResponse = true;
        }

        switch (event.type) {
            case 'RATE_LIMITED':
                latestRateLimited = true;
                break;
            case 'TOOL_CALLED':
                if (typeof payload.toolId === 'string' && typeof payload.toolName === 'string') {
                    runningTools.set(payload.toolId, payload.toolName);
                }
                break;
            case 'TOOL_RESULT':
                if (typeof payload.toolId === 'string') {
                    runningTools.delete(payload.toolId);
                }
                break;
            default:
                break;
        }
    }

    if (hasAssistantResponse) {
        return null;
    }

    if (latestRateLimited) {
        return { phase: 'retrying' };
    }

    const runningToolsArray = Array.from(runningTools.values());
    const lastRunningTool = runningToolsArray[runningToolsArray.length - 1];
    if (lastRunningTool) {
        return { phase: 'running_tool', toolName: lastRunningTool };
    }

    return { phase: 'waiting_for_model' };
}
