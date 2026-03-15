/**
 * Task Reducer
 *
 * Handles TASK_* events
 */

import type { TaskSession, TaskEvent, PlanStep, TaskStatus } from '../../../types';

export function applyTaskEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'TASK_STARTED':
            return {
                ...session,
                status: 'running',
                title: payload.title as string,
                workspacePath: (payload.context as Record<string, unknown>)?.workspacePath as string,
                messages: [
                    ...session.messages,
                    {
                        id: event.id,
                        role: 'user',
                        content:
                            ((payload.context as Record<string, unknown>)?.userQuery as string) ??
                            (payload.description as string) ??
                            '',
                        timestamp: event.timestamp,
                    },
                ],
            };

        case 'PLAN_UPDATED':
            return {
                ...session,
                planSummary: payload.summary as string,
                planSteps: (payload.steps as PlanStep[]) || [],
            };

        case 'TASK_FINISHED':
            return {
                ...session,
                status: 'finished',
                summary: payload.summary as string,
                assistantDraft: undefined,
            };

        case 'TASK_FAILED':
            return {
                ...session,
                status: 'failed',
                summary: payload.error as string,
                assistantDraft: undefined,
            };

        case 'TASK_STATUS': {
            const status = payload.status as TaskStatus;
            return {
                ...session,
                status: status ?? session.status,
                assistantDraft: status === 'running' ? session.assistantDraft : undefined,
            };
        }

        case 'TASK_HISTORY_CLEARED': {
            return {
                ...session,
                messages: [
                    {
                        id: event.id,
                        role: 'system',
                        content: 'Conversation history cleared.',
                        timestamp: event.timestamp,
                    },
                ],
                assistantDraft: undefined,
            };
        }

        case 'AGENT_IDENTITY_ESTABLISHED': {
            return session;
        }

        case 'MCP_GATEWAY_DECISION': {
            return session;
        }

        case 'RUNTIME_SECURITY_ALERT': {
            return session;
        }

        default:
            return session;
    }
}
