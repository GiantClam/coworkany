import type {
    ChatMessagePayload,
    EffectDecisionPayload,
    EffectRequestedPayload,
    PatchPayload,
    PlanUpdatedPayload,
    TaskClarificationRequiredPayload,
    TaskEvent,
    TaskFailedPayload,
    TaskFinishedPayload,
    TaskStartedPayload,
    TaskStatusPayload,
    TextDeltaPayload,
    ToolCalledPayload,
    ToolResultPayload,
} from './events';

export type CanonicalMessageRole = 'user' | 'assistant' | 'system' | 'runtime';

export type CanonicalTaskStatus = 'idle' | 'running' | 'finished' | 'failed';

export type CanonicalTaskMessagePart =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'tool-call'; toolId: string; toolName?: string; input?: unknown }
    | { type: 'tool-result'; toolId: string; success: boolean; result?: unknown; resultSummary?: string }
    | { type: 'effect'; requestId: string; effectType: string; riskLevel: number; status: 'requested' | 'approved' | 'denied' }
    | { type: 'patch'; patchId: string; filePath?: string; status: 'proposed' | 'applied' | 'rejected' }
    | { type: 'status'; status: CanonicalTaskStatus; label?: string }
    | {
        type: 'task';
        event:
            | 'plan_ready'
            | 'plan_updated'
            | 'research_updated'
            | 'contract_reopened'
            | 'checkpoint_reached'
            | 'user_action_required'
            | 'clarification_required';
        title?: string;
        summary?: string;
        data?: Record<string, unknown>;
    }
    | {
        type: 'collaboration';
        kind: string;
        actionId?: string;
        title?: string;
        description?: string;
        blocking?: boolean;
        questions: string[];
        instructions: string[];
        choices?: Array<{ label: string; value: string }>;
    }
    | { type: 'finish'; summary?: string; artifacts?: string[]; files?: string[] }
    | { type: 'error'; message: string; suggestion?: string };

export type CanonicalTaskMessage = {
    id: string;
    taskId: string;
    role: CanonicalMessageRole;
    timestamp: string;
    sequence: number;
    correlationId?: string;
    sourceEventId?: string;
    sourceEventType?: string;
    status: 'streaming' | 'complete';
    parts: CanonicalTaskMessagePart[];
};

export type CanonicalStreamEvent =
    | {
        type: 'canonical_message';
        payload: CanonicalTaskMessage;
    }
    | {
        type: 'canonical_message_delta';
        payload: {
            id: string;
            taskId: string;
            role: CanonicalMessageRole;
            timestamp: string;
            sequence: number;
            correlationId?: string;
            sourceEventId?: string;
            sourceEventType?: string;
            part: {
                type: 'text' | 'reasoning';
                delta: string;
            };
        };
    };

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function toRole(value: unknown): CanonicalMessageRole {
    return value === 'user' || value === 'assistant' || value === 'system' || value === 'runtime'
        ? value
        : 'runtime';
}

function toStatus(value: unknown, fallback: CanonicalTaskStatus = 'running'): CanonicalTaskStatus {
    return value === 'idle' || value === 'running' || value === 'finished' || value === 'failed'
        ? value
        : fallback;
}

function baseMessage(event: TaskEvent, role: CanonicalMessageRole): CanonicalTaskMessage {
    return {
        id: event.id,
        taskId: event.taskId,
        role,
        timestamp: event.timestamp,
        sequence: event.sequence,
        sourceEventId: event.id,
        sourceEventType: event.type,
        status: 'complete',
        parts: [],
    };
}

function makeCollaborationPart(payload: TaskClarificationRequiredPayload, fallbackKind: string): CanonicalTaskMessagePart {
    const kind = payload.clarificationType ?? fallbackKind;
    const choicesRaw = Array.isArray(payload.routeChoices) ? payload.routeChoices : [];
    const choices = choicesRaw
        .map((choice) => ({
            label: asString(choice.label) ?? '',
            value: asString(choice.value) ?? '',
        }))
        .filter((choice) => choice.label.length > 0 && choice.value.length > 0);
    return {
        type: 'collaboration',
        kind,
        title: payload.reason,
        description: payload.reason,
        blocking: true,
        questions: asStringArray(payload.questions),
        instructions: asStringArray(payload.instructions),
        choices: choices.length > 0 ? choices : undefined,
    };
}

function eventToCanonicalMessage(event: TaskEvent): CanonicalTaskMessage | undefined {
    const payload = asRecord(event.payload);
    switch (event.type) {
        case 'CHAT_MESSAGE': {
            const chat = payload as ChatMessagePayload;
            const content = chat.content ?? '';
            if (!content) {
                return undefined;
            }
            const message = baseMessage(event, toRole(chat.role));
            message.parts.push({ type: 'text', text: content });
            return message;
        }
        case 'TASK_STARTED': {
            const data = payload as TaskStartedPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({ type: 'status', status: 'running', label: data.title });
            return message;
        }
        case 'TASK_STATUS': {
            const data = payload as TaskStatusPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'status',
                status: toStatus(data.status),
                label: data.message,
            });
            return message;
        }
        case 'TASK_SUSPENDED': {
            const message = baseMessage(event, 'runtime');
            message.parts.push({ type: 'status', status: 'idle', label: asString(payload.reason) });
            return message;
        }
        case 'TASK_RESUMED': {
            const message = baseMessage(event, 'runtime');
            message.parts.push({ type: 'status', status: 'running', label: asString(payload.reason) });
            return message;
        }
        case 'TASK_PLAN_READY': {
            const summary = asString(payload.summary);
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'task',
                event: 'plan_ready',
                summary,
                data: payload,
            });
            return message;
        }
        case 'PLAN_UPDATED': {
            const data = payload as PlanUpdatedPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'task',
                event: 'plan_updated',
                summary: data.summary,
                data: payload,
            });
            return message;
        }
        case 'TASK_RESEARCH_UPDATED': {
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'task',
                event: 'research_updated',
                summary: asString(payload.summary),
                data: payload,
            });
            return message;
        }
        case 'TASK_CONTRACT_REOPENED': {
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'task',
                event: 'contract_reopened',
                title: asString(payload.title),
                summary: asString(payload.summary),
                data: payload,
            });
            return message;
        }
        case 'TASK_CHECKPOINT_REACHED': {
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'task',
                event: 'checkpoint_reached',
                title: asString(payload.title),
                summary: asString(payload.summary),
                data: payload,
            });
            return message;
        }
        case 'TASK_USER_ACTION_REQUIRED': {
            const data = payload as TaskClarificationRequiredPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'task',
                event: 'user_action_required',
                title: data.reason,
                summary: data.reason,
                data: payload,
            });
            message.parts.push(makeCollaborationPart(data, 'user_action_required'));
            return message;
        }
        case 'TASK_CLARIFICATION_REQUIRED': {
            const data = payload as TaskClarificationRequiredPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'task',
                event: 'clarification_required',
                title: data.reason,
                summary: data.reason,
                data: payload,
            });
            message.parts.push(makeCollaborationPart(data, 'clarification'));
            return message;
        }
        case 'TOOL_CALLED': {
            const data = payload as ToolCalledPayload;
            const toolId = data.toolId ?? event.id;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'tool-call',
                toolId,
                toolName: data.toolName,
                input: data.args,
            });
            return message;
        }
        case 'TOOL_RESULT': {
            const data = payload as ToolResultPayload;
            const toolId = data.toolId ?? event.id;
            const success = data.success ?? data.isError !== true;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'tool-result',
                toolId,
                success,
                result: data.result,
                resultSummary: data.resultSummary,
            });
            return message;
        }
        case 'EFFECT_REQUESTED': {
            const data = payload as EffectRequestedPayload;
            const requestId = data.request?.id ?? event.id;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'effect',
                requestId,
                effectType: data.request?.effectType ?? 'effect',
                riskLevel: data.riskLevel ?? 0,
                status: 'requested',
            });
            return message;
        }
        case 'EFFECT_APPROVED':
        case 'EFFECT_DENIED': {
            const data = payload as EffectDecisionPayload;
            const requestId = data.response?.requestId ?? event.id;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'effect',
                requestId,
                effectType: 'effect',
                riskLevel: 0,
                status: event.type === 'EFFECT_APPROVED' ? 'approved' : 'denied',
            });
            return message;
        }
        case 'PATCH_PROPOSED': {
            const data = payload as PatchPayload;
            const patchId = data.patch?.id ?? event.id;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'patch',
                patchId,
                filePath: data.patch?.filePath,
                status: 'proposed',
            });
            return message;
        }
        case 'PATCH_APPLIED':
        case 'PATCH_REJECTED': {
            const data = payload as PatchPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'patch',
                patchId: data.patchId ?? event.id,
                filePath: data.filePath,
                status: event.type === 'PATCH_APPLIED' ? 'applied' : 'rejected',
            });
            return message;
        }
        case 'TASK_FINISHED': {
            const data = payload as TaskFinishedPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'finish',
                summary: data.summary,
                artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
                files: Array.isArray(data.files) ? data.files : [],
            });
            return message;
        }
        case 'TASK_FAILED': {
            const data = payload as TaskFailedPayload;
            const message = baseMessage(event, 'runtime');
            message.parts.push({
                type: 'error',
                message: data.error ?? 'Task failed',
                suggestion: data.suggestion,
            });
            return message;
        }
        default:
            return undefined;
    }
}

function eventToCanonicalMessageDelta(event: TaskEvent): CanonicalStreamEvent | undefined {
    if (event.type !== 'TEXT_DELTA') {
        return undefined;
    }
    const payload = event.payload as TextDeltaPayload;
    const delta = payload.content ?? payload.text ?? '';
    if (!delta) {
        return undefined;
    }
    return {
        type: 'canonical_message_delta',
        payload: {
            id: payload.messageId ?? `${event.taskId}-assistant`,
            taskId: event.taskId,
            role: 'assistant',
            timestamp: event.timestamp,
            sequence: event.sequence,
            correlationId: payload.correlationId,
            sourceEventId: event.id,
            sourceEventType: event.type,
            part: {
                type: 'text',
                delta,
            },
        },
    };
}

export function taskEventToCanonicalStreamEvents(event: TaskEvent): CanonicalStreamEvent[] {
    const delta = eventToCanonicalMessageDelta(event);
    if (delta) {
        return [delta];
    }
    const message = eventToCanonicalMessage(event);
    if (!message) {
        return [];
    }
    return [{
        type: 'canonical_message',
        payload: message,
    }];
}
