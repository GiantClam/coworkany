/**
 * Task Reducer
 *
 * Handles TASK_* events
 */

import type { TaskSession, TaskEvent, PlanStep, TaskStatus } from '../../../types';

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

export function applyTaskEvent(session: TaskSession, event: TaskEvent): TaskSession {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'TASK_STARTED':
            return {
                ...session,
                status: 'running',
                title: payload.title as string,
                clarificationQuestions: undefined,
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
                suspension: undefined,
                clarificationQuestions: undefined,
                assistantDraft: undefined,
            };

        case 'TASK_FAILED':
            return appendSystemMessage({
                ...session,
                status: 'failed',
                summary: payload.error as string,
                suspension: undefined,
                clarificationQuestions: undefined,
                assistantDraft: undefined,
            }, event, [
                `Task failed: ${(payload.error as string) ?? 'Unknown error'}`,
                typeof payload.suggestion === 'string' && payload.suggestion.trim().length > 0
                    ? payload.suggestion.trim()
                    : null,
            ].filter(Boolean).join('\n'));

        case 'TASK_STATUS': {
            const status = payload.status as TaskStatus;
            return {
                ...session,
                status: status ?? session.status,
                assistantDraft: status === 'running' ? session.assistantDraft : undefined,
            };
        }

        case 'TASK_CLARIFICATION_REQUIRED':
            return {
                ...session,
                status: 'idle',
                summary: (payload.reason as string | undefined) ?? session.summary,
                suspension: undefined,
                clarificationQuestions: ((payload.questions as string[] | undefined) ?? []).filter(Boolean),
                assistantDraft: undefined,
            };

        case 'TASK_SUSPENDED':
        {
            const nextSuspension = {
                reason: String(payload.reason ?? ''),
                userMessage: String(payload.userMessage ?? ''),
                canAutoResume: Boolean(payload.canAutoResume),
                maxWaitTimeMs:
                    typeof payload.maxWaitTimeMs === 'number'
                        ? payload.maxWaitTimeMs
                        : undefined,
            };
            const isDuplicateSuspension =
                session.suspension?.reason === nextSuspension.reason &&
                session.suspension?.userMessage === nextSuspension.userMessage &&
                session.suspension?.canAutoResume === nextSuspension.canAutoResume &&
                session.suspension?.maxWaitTimeMs === nextSuspension.maxWaitTimeMs;

            const nextSession: TaskSession = {
                ...session,
                status: 'idle',
                suspension: nextSuspension,
                assistantDraft: undefined,
            };

            if (isDuplicateSuspension) {
                return nextSession;
            }

            return appendSystemMessage(
                nextSession,
                event,
                nextSuspension.userMessage || 'Task suspended'
            );
        }

        case 'TASK_RESUMED':
            return appendSystemMessage({
                ...session,
                status: 'running',
                suspension: undefined,
            }, event, 'Task resumed');

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
            const identity = payload.identity as Record<string, unknown> | undefined;
            const sessionId = identity?.sessionId as string | undefined;
            return appendSystemMessage(
                session,
                event,
                `Agent identity established${sessionId ? ` (${sessionId})` : ''}`
            );
        }

        case 'MCP_GATEWAY_DECISION': {
            const toolName = payload.toolName as string | undefined;
            const action = payload.decision as string | undefined;
            return appendSystemMessage(
                session,
                event,
                `MCP decision${toolName ? ` for ${toolName}` : ''}: ${action ?? 'unknown'}`
            );
        }

        case 'RUNTIME_SECURITY_ALERT': {
            const threat = payload.threatType as string | undefined;
            return appendSystemMessage(
                session,
                event,
                `Security alert${threat ? `: ${threat}` : ''}`
            );
        }

        default:
            return session;
    }
}
