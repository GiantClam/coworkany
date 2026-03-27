import { z } from 'zod';
import type { TaskEvent } from './events';

export const CanonicalMessageRoleSchema = z.enum(['user', 'assistant', 'system', 'runtime']);

export const CanonicalStatusPartSchema = z.object({
    type: z.literal('status'),
    status: z.enum(['idle', 'running', 'finished', 'failed']),
    label: z.string().optional(),
    activeHardness: z.enum(['trivial', 'bounded', 'multi_step', 'externally_blocked', 'high_risk']).optional(),
    blockingReason: z.string().optional(),
});

export const CanonicalTextPartSchema = z.object({
    type: z.literal('text'),
    text: z.string(),
});

export const CanonicalReasoningPartSchema = z.object({
    type: z.literal('reasoning'),
    text: z.string(),
});

export const CanonicalTaskPartSchema = z.object({
    type: z.literal('task'),
    event: z.enum([
        'started',
        'plan_ready',
        'plan_updated',
        'research_updated',
        'contract_reopened',
        'checkpoint_reached',
        'user_action_required',
        'clarification_required',
    ]),
    title: z.string().optional(),
    summary: z.string().optional(),
    data: z.record(z.unknown()).optional(),
});

export const CanonicalCollaborationPartSchema = z.object({
    type: z.literal('collaboration'),
    kind: z.string(),
    actionId: z.string().optional(),
    title: z.string(),
    description: z.string().optional(),
    blocking: z.boolean().optional(),
    activeHardness: z.enum(['trivial', 'bounded', 'multi_step', 'externally_blocked', 'high_risk']).optional(),
    blockingReason: z.string().optional(),
    questions: z.array(z.string()).default([]),
    instructions: z.array(z.string()).default([]),
    choices: z.array(z.object({
        label: z.string(),
        value: z.string(),
    })).optional(),
});

export const CanonicalToolCallPartSchema = z.object({
    type: z.literal('tool-call'),
    toolId: z.string(),
    toolName: z.string(),
    source: z.string().optional(),
    input: z.unknown().optional(),
});

export const CanonicalToolResultPartSchema = z.object({
    type: z.literal('tool-result'),
    toolId: z.string(),
    success: z.boolean(),
    resultSummary: z.string().optional(),
    result: z.unknown().optional(),
});

export const CanonicalEffectPartSchema = z.object({
    type: z.literal('effect'),
    status: z.enum(['requested', 'approved', 'denied']),
    requestId: z.string(),
    effectType: z.string(),
    riskLevel: z.number().optional(),
});

export const CanonicalPatchPartSchema = z.object({
    type: z.literal('patch'),
    status: z.enum(['proposed', 'applied', 'rejected']),
    patchId: z.string(),
    filePath: z.string().optional(),
});

export const CanonicalFinishPartSchema = z.object({
    type: z.literal('finish'),
    summary: z.string(),
    artifacts: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    durationMs: z.number().optional(),
});

export const CanonicalErrorPartSchema = z.object({
    type: z.literal('error'),
    message: z.string(),
    code: z.string().optional(),
    recoverable: z.boolean().optional(),
    suggestion: z.string().optional(),
});

export const CanonicalMessagePartSchema = z.discriminatedUnion('type', [
    CanonicalStatusPartSchema,
    CanonicalTextPartSchema,
    CanonicalReasoningPartSchema,
    CanonicalTaskPartSchema,
    CanonicalCollaborationPartSchema,
    CanonicalToolCallPartSchema,
    CanonicalToolResultPartSchema,
    CanonicalEffectPartSchema,
    CanonicalPatchPartSchema,
    CanonicalFinishPartSchema,
    CanonicalErrorPartSchema,
]);

export const CanonicalTaskMessageSchema = z.object({
    id: z.string(),
    taskId: z.string(),
    role: CanonicalMessageRoleSchema,
    timestamp: z.string().datetime(),
    sequence: z.number().int().nonnegative(),
    correlationId: z.string().optional(),
    sourceEventId: z.string(),
    sourceEventType: z.string(),
    status: z.enum(['streaming', 'complete']).default('complete'),
    parts: z.array(CanonicalMessagePartSchema).min(1),
});

export const CanonicalTextDeltaSchema = z.object({
    type: z.literal('text'),
    delta: z.string(),
});

export const CanonicalReasoningDeltaSchema = z.object({
    type: z.literal('reasoning'),
    delta: z.string(),
});

export const CanonicalMessageDeltaPartSchema = z.discriminatedUnion('type', [
    CanonicalTextDeltaSchema,
    CanonicalReasoningDeltaSchema,
]);

export const CanonicalMessageEventSchema = z.object({
    type: z.literal('canonical_message'),
    payload: CanonicalTaskMessageSchema,
});

export const CanonicalMessageDeltaEventSchema = z.object({
    type: z.literal('canonical_message_delta'),
    payload: z.object({
        id: z.string(),
        taskId: z.string(),
        role: CanonicalMessageRoleSchema,
        timestamp: z.string().datetime(),
        sequence: z.number().int().nonnegative(),
        correlationId: z.string().optional(),
        sourceEventId: z.string(),
        sourceEventType: z.string(),
        part: CanonicalMessageDeltaPartSchema,
    }),
});

export const CanonicalStreamEventSchema = z.discriminatedUnion('type', [
    CanonicalMessageEventSchema,
    CanonicalMessageDeltaEventSchema,
]);

export type CanonicalTaskMessage = z.infer<typeof CanonicalTaskMessageSchema>;
export type CanonicalMessageEvent = z.infer<typeof CanonicalMessageEventSchema>;
export type CanonicalMessageDeltaEvent = z.infer<typeof CanonicalMessageDeltaEventSchema>;
export type CanonicalStreamEvent = z.infer<typeof CanonicalStreamEventSchema>;

const AUTH_OPEN_PAGE_PREFIX = '__auth_open_page__:';

function normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeTaskStartedUserQuery(value: unknown): string {
    const text = normalizeText(value);
    if (!text) {
        return '';
    }

    const routedMatch = text.match(
        /^(?:原始任务|Original task)\s*[:：]\s*([\s\S]+?)\n(?:用户路由|User route)\s*[:：]\s*(?:chat|task|immediate_task)\s*$/i
    );
    if (routedMatch?.[1]) {
        return routedMatch[1].trim();
    }

    const commandMatch = text.match(/^\/(?:ask|task)\b\s*([\s\S]*)$/i);
    if (commandMatch?.[1]) {
        const cleaned = commandMatch[1].trim();
        return cleaned || text;
    }

    return text;
}

function streamingMessageId(taskId: string, variant: 'assistant' | 'reasoning'): string {
    return `stream:${taskId}:${variant}`;
}

function completeMessage(input: Omit<CanonicalTaskMessage, 'status'>): CanonicalMessageEvent {
    return {
        type: 'canonical_message',
        payload: {
            ...input,
            status: 'complete',
        },
    };
}

export function taskEventToCanonicalStreamEvents(event: TaskEvent): CanonicalStreamEvent[] {
    const payload = event.payload as Record<string, unknown>;

    switch (event.type) {
        case 'TASK_STARTED': {
            const context = (payload.context as Record<string, unknown> | undefined) ?? {};
            const userQuery = normalizeTaskStartedUserQuery(context.userQuery);
            if (!userQuery) {
                return [];
            }
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'user',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{ type: 'text', text: userQuery }],
                }),
            ];
        }

        case 'CHAT_MESSAGE': {
            const role = payload.role === 'assistant' || payload.role === 'user' || payload.role === 'system'
                ? payload.role
                : 'system';
            const correlationId = role === 'assistant' ? streamingMessageId(event.taskId, 'assistant') : undefined;
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role,
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    correlationId,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{ type: 'text', text: String(payload.content ?? '') }],
                }),
            ];
        }

        case 'TEXT_DELTA': {
            const isReasoning = payload.role === 'thinking';
            const id = streamingMessageId(event.taskId, isReasoning ? 'reasoning' : 'assistant');
            return [
                {
                    type: 'canonical_message_delta',
                    payload: {
                        id,
                        taskId: event.taskId,
                        role: 'assistant',
                        timestamp: event.timestamp,
                        sequence: event.sequence,
                        correlationId: id,
                        sourceEventId: event.id,
                        sourceEventType: event.type,
                        part: isReasoning
                            ? { type: 'reasoning', delta: String(payload.delta ?? '') }
                            : { type: 'text', delta: String(payload.delta ?? '') },
                    },
                },
            ];
        }

        case 'TASK_STATUS':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'status',
                        status: payload.status === 'running' || payload.status === 'finished' || payload.status === 'failed'
                            ? payload.status
                            : 'idle',
                        activeHardness:
                            payload.activeHardness === 'trivial'
                            || payload.activeHardness === 'bounded'
                            || payload.activeHardness === 'multi_step'
                            || payload.activeHardness === 'externally_blocked'
                            || payload.activeHardness === 'high_risk'
                                ? payload.activeHardness
                                : undefined,
                        blockingReason: normalizeText(payload.blockingReason) || undefined,
                    }],
                }),
            ];

        case 'TASK_RESUMED': {
            const resumeReason = normalizeText(payload.resumeReason);
            if (resumeReason !== 'capability_review_approved') {
                return [];
            }

            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'status',
                        status: 'running',
                        label: 'Approved the generated capability and resumed the original task.',
                    }],
                }),
            ];
        }

        case 'PLAN_UPDATED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'task',
                        event: 'plan_updated',
                        summary: normalizeText(payload.summary),
                        data: {
                            taskProgress: payload.taskProgress,
                        },
                    }],
                }),
            ];

        case 'TASK_RESEARCH_UPDATED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'task',
                        event: 'research_updated',
                        summary: normalizeText(payload.summary),
                        data: {
                            sourcesChecked: payload.sourcesChecked,
                            blockingUnknowns: payload.blockingUnknowns,
                        },
                    }],
                }),
            ];

        case 'TASK_CONTRACT_REOPENED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'task',
                        event: 'contract_reopened',
                        title: normalizeText(payload.reason),
                        summary: normalizeText(payload.summary),
                        data: {
                            trigger: payload.trigger,
                            reasons: payload.reasons,
                            diff: payload.diff,
                        },
                    }],
                }),
            ];

        case 'TASK_PLAN_READY':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'task',
                        event: 'plan_ready',
                        summary: normalizeText(payload.summary),
                        data: {
                            mode: payload.mode,
                            intentRouting: payload.intentRouting,
                            tasks: payload.tasks,
                            deliverables: payload.deliverables,
                            checkpoints: payload.checkpoints,
                            userActionsRequired: payload.userActionsRequired,
                            executionProfile: payload.executionProfile,
                            capabilityPlan: payload.capabilityPlan,
                            capabilityReview: payload.capabilityReview,
                            missingInfo: payload.missingInfo,
                        },
                    }],
                }),
            ];

        case 'TASK_CHECKPOINT_REACHED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [
                        {
                            type: 'task',
                            event: 'checkpoint_reached',
                            title: normalizeText(payload.title),
                            summary: normalizeText(payload.userMessage) || normalizeText(payload.reason),
                            data: {
                                checkpointId: payload.checkpointId,
                                kind: payload.kind,
                                riskTier: payload.riskTier,
                                executionPolicy: payload.executionPolicy,
                                activeHardness: payload.activeHardness,
                                blockingReason: payload.blockingReason,
                            },
                        },
                        {
                            type: 'collaboration',
                            kind: 'checkpoint',
                            actionId: normalizeText(payload.checkpointId),
                            title: normalizeText(payload.title) || 'Checkpoint reached',
                            description: normalizeText(payload.userMessage) || normalizeText(payload.reason),
                            blocking: Boolean(payload.blocking),
                            activeHardness:
                                payload.activeHardness === 'trivial'
                                || payload.activeHardness === 'bounded'
                                || payload.activeHardness === 'multi_step'
                                || payload.activeHardness === 'externally_blocked'
                                || payload.activeHardness === 'high_risk'
                                    ? payload.activeHardness
                                    : undefined,
                            blockingReason: normalizeText(payload.blockingReason) || undefined,
                            questions: [],
                            instructions: [],
                        },
                    ],
                }),
            ];

        case 'TASK_USER_ACTION_REQUIRED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'collaboration',
                        kind: normalizeText(payload.kind),
                        actionId: normalizeText(payload.actionId),
                        title: normalizeText(payload.title) || 'User action required',
                        description: normalizeText(payload.description),
                        blocking: Boolean(payload.blocking),
                        activeHardness:
                            payload.activeHardness === 'trivial'
                            || payload.activeHardness === 'bounded'
                            || payload.activeHardness === 'multi_step'
                            || payload.activeHardness === 'externally_blocked'
                            || payload.activeHardness === 'high_risk'
                                ? payload.activeHardness
                                : undefined,
                        blockingReason: normalizeText(payload.blockingReason) || undefined,
                        questions: Array.isArray(payload.questions) ? payload.questions.filter((entry): entry is string => typeof entry === 'string') : [],
                        instructions: [
                            ...(Array.isArray(payload.instructions) ? payload.instructions.filter((entry): entry is string => typeof entry === 'string') : []),
                            ...(normalizeText(payload.kind) === 'external_auth' && payload.canAutoResume === true
                                ? ['登录完成后将自动继续执行。']
                                : []),
                        ],
                        choices: normalizeText(payload.kind) === 'external_auth'
                            ? [
                                ...(normalizeText(payload.authUrl)
                                    ? [{ label: '打开登录页面', value: `${AUTH_OPEN_PAGE_PREFIX}${normalizeText(payload.authUrl)}` }]
                                    : []),
                                { label: '我已登录，继续执行', value: '继续执行' },
                            ]
                            : undefined,
                    }],
                }),
            ];

        case 'TASK_CLARIFICATION_REQUIRED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'collaboration',
                        kind: normalizeText(payload.clarificationType) || 'clarification',
                        actionId: normalizeText(payload.clarificationType) === 'task_draft_confirmation'
                            ? 'task_draft_confirm'
                            : normalizeText(payload.clarificationType) === 'route_disambiguation'
                                ? 'intent_route'
                                : normalizeText(payload.reason) || 'clarification',
                        title: 'Clarification required',
                        description: normalizeText(payload.reason),
                        blocking: true,
                        activeHardness:
                            payload.activeHardness === 'trivial'
                            || payload.activeHardness === 'bounded'
                            || payload.activeHardness === 'multi_step'
                            || payload.activeHardness === 'externally_blocked'
                            || payload.activeHardness === 'high_risk'
                                ? payload.activeHardness
                                : undefined,
                        blockingReason: normalizeText(payload.blockingReason) || undefined,
                        questions: Array.isArray(payload.questions) ? payload.questions.filter((entry): entry is string => typeof entry === 'string') : [],
                        instructions: [],
                        choices: Array.isArray(payload.routeChoices)
                            ? payload.routeChoices
                                .filter((entry): entry is { label: string; value: string } =>
                                    typeof entry === 'object'
                                    && entry !== null
                                    && typeof (entry as { label?: unknown }).label === 'string'
                                    && typeof (entry as { value?: unknown }).value === 'string')
                                .map((entry) => ({ label: entry.label, value: entry.value }))
                            : undefined,
                    }],
                }),
            ];

        case 'TOOL_CALLED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'tool-call',
                        toolId: normalizeText(payload.toolId),
                        toolName: normalizeText(payload.toolName) || 'Tool',
                        source: normalizeText(payload.source),
                        input: payload.input,
                    }],
                }),
            ];

        case 'TOOL_RESULT':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'tool-result',
                        toolId: normalizeText(payload.toolId),
                        success: Boolean(payload.success),
                        resultSummary: normalizeText(payload.resultSummary),
                        result: payload.result,
                    }],
                }),
            ];

        case 'EFFECT_REQUESTED': {
            const request = (payload.request as Record<string, unknown> | undefined) ?? {};
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'effect',
                        status: 'requested',
                        requestId: normalizeText(request.id),
                        effectType: normalizeText(request.effectType),
                        riskLevel: typeof payload.riskLevel === 'number' ? payload.riskLevel : undefined,
                    }],
                }),
            ];
        }

        case 'EFFECT_APPROVED':
        case 'EFFECT_DENIED': {
            const response = (payload.response as Record<string, unknown> | undefined) ?? {};
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'effect',
                        status: event.type === 'EFFECT_APPROVED' ? 'approved' : 'denied',
                        requestId: normalizeText(response.requestId),
                        effectType: normalizeText(response.effectType),
                    }],
                }),
            ];
        }

        case 'PATCH_PROPOSED':
        case 'PATCH_APPLIED':
        case 'PATCH_REJECTED': {
            const patch = (payload.patch as Record<string, unknown> | undefined) ?? {};
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'runtime',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [{
                        type: 'patch',
                        status: event.type === 'PATCH_PROPOSED'
                            ? 'proposed'
                            : event.type === 'PATCH_APPLIED'
                                ? 'applied'
                                : 'rejected',
                        patchId: normalizeText(patch.id) || normalizeText(payload.patchId),
                        filePath: normalizeText(patch.filePath) || normalizeText(payload.filePath),
                    }],
                }),
            ];
        }

        case 'TASK_FINISHED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [
                        {
                            type: 'finish',
                            summary: normalizeText(payload.summary),
                            artifacts: Array.isArray(payload.artifactsCreated) ? payload.artifactsCreated.filter((entry): entry is string => typeof entry === 'string') : undefined,
                            files: Array.isArray(payload.filesModified) ? payload.filesModified.filter((entry): entry is string => typeof entry === 'string') : undefined,
                            durationMs: typeof payload.duration === 'number' ? payload.duration : undefined,
                        },
                        {
                            type: 'text',
                            text: normalizeText(payload.summary),
                        },
                    ],
                }),
            ];

        case 'TASK_FAILED':
            return [
                completeMessage({
                    id: event.id,
                    taskId: event.taskId,
                    role: 'assistant',
                    timestamp: event.timestamp,
                    sequence: event.sequence,
                    sourceEventId: event.id,
                    sourceEventType: event.type,
                    parts: [
                        {
                            type: 'error',
                            message: normalizeText(payload.error),
                            code: normalizeText(payload.errorCode),
                            recoverable: typeof payload.recoverable === 'boolean' ? payload.recoverable : undefined,
                            suggestion: normalizeText(payload.suggestion),
                        },
                        {
                            type: 'text',
                            text: normalizeText(payload.error),
                        },
                    ],
                }),
            ];

        default:
            return [];
    }
}
