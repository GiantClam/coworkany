import type { TaskRuntimeState } from './taskRuntimeState';
import { failGuard, passGuard, runGuardPipeline } from './entrypointGuardPipeline';

type RuntimePayload = Record<string, unknown>;

type RuntimeSnapshot = {
    generatedAt: string;
    tasks: unknown[];
    count: number;
};

type WarmupSummary = {
    mcpServerCount: number;
    mcpToolCount: number;
    durationMs: number;
    mcpLoadStatus?: 'disabled' | 'ready' | 'timeout' | 'error';
};

type TaskTranscriptEntry = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    at: string;
};

type TaskTranscriptStore = {
    list: (taskId: string, limit?: number) => TaskTranscriptEntry[];
    rewindByUserTurns: (taskId: string, userTurns: number) => {
        success: boolean;
        removedEntries: number;
        removedUserTurns: number;
        remainingEntries: number;
        latestUserMessage?: string;
    };
};

type TaskRewindContextResult = {
    success: boolean;
    removedTurns: number;
    remainingTurns: number;
};

type RuntimeConfigDoctorSummary = {
    loadedFromPath?: string | null;
    search: {
        provider: {
            value: string;
            source: string;
        };
        credentials: {
            serperApiKeyConfigured: boolean;
            exaApiKeyConfigured: boolean;
            tavilyApiKeyConfigured: boolean;
            braveApiKeyConfigured: boolean;
        };
    };
    conflicts: string[];
};

type HookRuntimeEventType =
    | 'SessionStart'
    | 'TaskCreated'
    | 'RemoteSessionLinked'
    | 'ChannelEventInjected'
    | 'PermissionRequest'
    | 'PreToolUse'
    | 'PostToolUse'
    | 'PreCompact'
    | 'PostCompact'
    | 'TaskCompleted'
    | 'TaskFailed'
    | 'TaskRewound';

type RuntimeCommandType =
    | 'bootstrap_runtime_context'
    | 'get_runtime_snapshot'
    | 'warmup_chat_runtime'
    | 'doctor_preflight'
    | 'get_tasks'
    | 'get_task_runtime_state'
    | 'get_policy_decision_log'
    | 'get_hook_events'
    | 'get_task_transcript'
    | 'rewind_task';

type HandleEntrypointRuntimeCommandsInput = {
    commandType: string;
    commandId: string;
    payload: RuntimePayload;
    taskStates: Map<string, TaskRuntimeState>;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => RuntimePayload;
    getNowIso: () => string;
    createId: () => string;
    setBootstrapRuntimeContext: (context: RuntimePayload) => void;
    hasBootstrapRuntimeContext: () => boolean;
    hydrateLegacyRuntimeRecordsFromBootstrap: (context: RuntimePayload) => void;
    collectRuntimeSnapshot: () => RuntimeSnapshot;
    warmupChatRuntime?: () => Promise<WarmupSummary>;
    buildRuntimeConfigDoctorSummary: () => RuntimeConfigDoctorSummary;
    taskTranscriptStore?: TaskTranscriptStore;
    rewindTaskContext?: (input: { taskId: string; userTurns: number }) => TaskRewindContextResult;
    resolveTaskCheckpointVersion: (state: TaskRuntimeState) => number;
    listPolicyDecisionLog?: (input: { taskId?: string; limit?: number }) => unknown[];
    listHookEvents?: (input: {
        taskId?: string;
        limit?: number;
        type?: HookRuntimeEventType;
    }) => unknown[];
    applyPolicyDecision: (input: {
        requestId: string;
        action: 'task_command';
        commandType: string;
        taskId: string;
        source: 'rewind_task';
        payload: RuntimePayload;
    }) => {
        allowed: boolean;
        reason: string;
        ruleId: string;
    };
    upsertTaskState: (taskId: string, patch: Partial<TaskRuntimeState>) => TaskRuntimeState;
    appendTranscript: (taskId: string, role: 'user' | 'assistant' | 'system', content: string) => void;
    emitHookEvent: (
        type: HookRuntimeEventType,
        event: {
            taskId?: string;
            runId?: string;
            traceId?: string;
            payload?: RuntimePayload;
        },
    ) => void;
    emitTaskStatus: (taskId: string, payload: RuntimePayload) => void;
    emitInvalidPayload: (type: string, extra?: RuntimePayload) => void;
    emitFor: (type: string, responsePayload: RuntimePayload) => void;
};

function isRuntimeCommandType(commandType: string): commandType is RuntimeCommandType {
    return commandType === 'bootstrap_runtime_context'
        || commandType === 'get_runtime_snapshot'
        || commandType === 'warmup_chat_runtime'
        || commandType === 'doctor_preflight'
        || commandType === 'get_tasks'
        || commandType === 'get_task_runtime_state'
        || commandType === 'get_policy_decision_log'
        || commandType === 'get_hook_events'
        || commandType === 'get_task_transcript'
        || commandType === 'rewind_task';
}

function parseHookRuntimeEventType(value: unknown): HookRuntimeEventType | undefined {
    return value === 'SessionStart'
        || value === 'TaskCreated'
        || value === 'RemoteSessionLinked'
        || value === 'ChannelEventInjected'
        || value === 'PermissionRequest'
        || value === 'PreToolUse'
        || value === 'PostToolUse'
        || value === 'PreCompact'
        || value === 'PostCompact'
        || value === 'TaskCompleted'
        || value === 'TaskFailed'
        || value === 'TaskRewound'
        ? value
        : undefined;
}

function parsePositiveLimit(limit: unknown, max: number): number | undefined {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
        return undefined;
    }
    return Math.min(max, Math.floor(limit));
}

export async function handleEntrypointRuntimeCommands(
    input: HandleEntrypointRuntimeCommandsInput,
): Promise<boolean> {
    if (!isRuntimeCommandType(input.commandType)) {
        return false;
    }

    if (input.commandType === 'bootstrap_runtime_context') {
        const runtimeContext = input.toRecord(input.payload.runtimeContext);
        input.setBootstrapRuntimeContext(runtimeContext);
        input.hydrateLegacyRuntimeRecordsFromBootstrap(runtimeContext);
        input.emitFor('bootstrap_runtime_context_response', {
            success: true,
        });
        return true;
    }

    if (input.commandType === 'get_runtime_snapshot') {
        try {
            input.emitFor('get_runtime_snapshot_response', {
                success: true,
                snapshot: input.collectRuntimeSnapshot(),
            });
        } catch (error) {
            input.emitFor('get_runtime_snapshot_response', {
                success: false,
                snapshot: {
                    generatedAt: input.getNowIso(),
                    tasks: [],
                    count: 0,
                },
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return true;
    }

    if (input.commandType === 'warmup_chat_runtime') {
        if (!input.warmupChatRuntime) {
            input.emitFor('warmup_chat_runtime_response', {
                success: true,
                warmup: {
                    mcpServerCount: 0,
                    mcpToolCount: 0,
                    durationMs: 0,
                    skipped: true,
                },
            });
            return true;
        }
        try {
            const warmup = await input.warmupChatRuntime();
            input.emitFor('warmup_chat_runtime_response', {
                success: true,
                warmup,
            });
        } catch (error) {
            input.emitFor('warmup_chat_runtime_response', {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
        return true;
    }

    if (input.commandType === 'doctor_preflight') {
        const runtimeConfig = input.buildRuntimeConfigDoctorSummary();
        input.emitFor('doctor_preflight_response', {
            success: true,
            report: {
                runtime: 'mastra',
                status: 'ok',
                hasRuntimeContext: input.hasBootstrapRuntimeContext(),
                runtimeConfig,
            },
            markdown: [
                '# Doctor Preflight',
                '',
                'Mastra runtime is healthy.',
                '',
                `- Runtime config: ${runtimeConfig.loadedFromPath ?? 'not found'}`,
                `- Search provider: ${runtimeConfig.search.provider.value} (${runtimeConfig.search.provider.source})`,
                `- Search credentials: serper=${runtimeConfig.search.credentials.serperApiKeyConfigured ? 'on' : 'off'}, exa=${runtimeConfig.search.credentials.exaApiKeyConfigured ? 'on' : 'off'}, tavily=${runtimeConfig.search.credentials.tavilyApiKeyConfigured ? 'on' : 'off'}, brave=${runtimeConfig.search.credentials.braveApiKeyConfigured ? 'on' : 'off'}`,
                ...(runtimeConfig.conflicts.length > 0
                    ? ['', `- Conflicts: ${runtimeConfig.conflicts.join(' | ')}`]
                    : []),
            ].join('\n'),
        });
        return true;
    }

    if (input.commandType === 'get_tasks') {
        const workspacePath = input.getString(input.payload.workspacePath);
        if (!workspacePath) {
            input.emitInvalidPayload('get_tasks_response', { tasks: [], count: 0 });
            return true;
        }

        const statusFilter = Array.isArray(input.payload.status)
            ? new Set(input.payload.status.filter((value): value is string => typeof value === 'string'))
            : null;
        const limit = parsePositiveLimit(input.payload.limit, Number.MAX_SAFE_INTEGER);

        const all = Array.from(input.taskStates.values())
            .filter((task) => task.workspacePath === workspacePath)
            .filter((task) => {
                if (!statusFilter || statusFilter.size === 0) {
                    return true;
                }
                return statusFilter.has(task.status);
            })
            .map((task) => ({
                id: task.taskId,
                taskId: task.taskId,
                title: task.title,
                workspacePath: task.workspacePath,
                status: task.status,
                createdAt: task.createdAt,
                modelId: task.modelId ?? null,
                executionPath: task.executionPath ?? 'workflow',
            }));

        const tasks = limit ? all.slice(0, limit) : all;
        input.emitFor('get_tasks_response', {
            success: true,
            tasks,
            count: tasks.length,
        });
        return true;
    }

    if (input.commandType === 'get_task_runtime_state') {
        const taskId = input.getString(input.payload.taskId) ?? '';
        if (!taskId) {
            input.emitInvalidPayload('get_task_runtime_state_response', {
                taskId,
                state: null,
            });
            return true;
        }

        const state = input.taskStates.get(taskId);
        input.emitFor('get_task_runtime_state_response', {
            success: Boolean(state),
            taskId,
            state: state
                ? {
                    taskId: state.taskId,
                    threadId: state.conversationThreadId,
                    title: state.title,
                    workspacePath: state.workspacePath,
                    createdAt: state.createdAt,
                    status: state.status,
                    suspended: state.suspended ?? false,
                    suspensionReason: state.suspensionReason ?? null,
                    lastUserMessage: state.lastUserMessage ?? null,
                    lastTraceId: state.lastTraceId ?? null,
                    enabledSkills: state.enabledSkills ?? [],
                    modelId: state.modelId ?? null,
                    resourceId: state.resourceId,
                    checkpoint: state.checkpoint ?? null,
                    checkpointVersion: state.checkpointVersion ?? input.resolveTaskCheckpointVersion(state),
                    retry: state.retry ?? null,
                    agentTasks: state.agentTasks ?? [],
                    agentTaskProgress: state.agentTaskProgress ?? null,
                    operationLog: state.operationLog ?? [],
                    executionPath: state.executionPath ?? 'workflow',
                }
                : null,
            error: state ? null : 'task_not_found',
        });
        return true;
    }

    if (input.commandType === 'get_policy_decision_log') {
        const taskId = input.getString(input.payload.taskId) ?? undefined;
        const limit = parsePositiveLimit(input.payload.limit, 1000);
        const entries = input.listPolicyDecisionLog
            ? input.listPolicyDecisionLog({ taskId, limit })
            : [];
        input.emitFor('get_policy_decision_log_response', {
            success: true,
            taskId: taskId ?? null,
            entries,
            count: entries.length,
        });
        return true;
    }

    if (input.commandType === 'get_hook_events') {
        const taskId = input.getString(input.payload.taskId) ?? undefined;
        const limit = parsePositiveLimit(input.payload.limit, 1000);
        const type = parseHookRuntimeEventType(input.payload.type);
        const entries = input.listHookEvents
            ? input.listHookEvents({
                taskId,
                limit,
                type,
            })
            : [];
        input.emitFor('get_hook_events_response', {
            success: true,
            taskId: taskId ?? null,
            type: type ?? null,
            entries,
            count: entries.length,
        });
        return true;
    }

    if (input.commandType === 'get_task_transcript') {
        const taskId = input.getString(input.payload.taskId) ?? '';
        if (!taskId) {
            input.emitInvalidPayload('get_task_transcript_response', { taskId, entries: [], count: 0 });
            return true;
        }

        const limit = parsePositiveLimit(input.payload.limit, Number.MAX_SAFE_INTEGER);
        const entries = input.taskTranscriptStore
            ? input.taskTranscriptStore.list(taskId, limit).map((entry) => ({
                id: entry.id,
                role: entry.role,
                content: entry.content,
                at: entry.at,
            }))
            : [];
        input.emitFor('get_task_transcript_response', {
            success: true,
            taskId,
            entries,
            count: entries.length,
        });
        return true;
    }

    const taskId = input.getString(input.payload.taskId) ?? '';
    if (!taskId) {
        input.emitInvalidPayload('rewind_task_response', { taskId });
        return true;
    }

    const rewindGuard = await runGuardPipeline<undefined>([
        () => {
            const rewindDecision = input.applyPolicyDecision({
                requestId: input.commandId,
                action: 'task_command',
                commandType: input.commandType,
                taskId,
                source: 'rewind_task',
                payload: input.payload,
            });
            if (!rewindDecision.allowed) {
                return failGuard(`policy_denied:${rewindDecision.reason}`, undefined);
            }
            return passGuard();
        },
    ]);
    if (!rewindGuard.ok) {
        input.emitFor('rewind_task_response', {
            success: false,
            taskId,
            error: rewindGuard.error,
        });
        return true;
    }

    const userTurns = typeof input.payload.userTurns === 'number'
        && Number.isFinite(input.payload.userTurns)
        && input.payload.userTurns > 0
        ? Math.min(20, Math.floor(input.payload.userTurns))
        : 1;

    const rewound = input.taskTranscriptStore
        ? input.taskTranscriptStore.rewindByUserTurns(taskId, userTurns)
        : {
            success: false,
            removedEntries: 0,
            removedUserTurns: 0,
            remainingEntries: 0,
            latestUserMessage: undefined,
        };
    if (!rewound.success) {
        input.emitFor('rewind_task_response', {
            success: false,
            taskId,
            error: 'rewind_unavailable_or_no_history',
            removedEntries: rewound.removedEntries,
            removedUserTurns: rewound.removedUserTurns,
        });
        return true;
    }

    const newThreadId = `${taskId}-rewind-${input.createId()}`;
    const updatedState = input.upsertTaskState(taskId, {
        conversationThreadId: newThreadId,
        status: 'idle',
        suspended: false,
        suspensionReason: undefined,
        checkpoint: undefined,
        lastUserMessage: rewound.latestUserMessage,
    });
    const contextRewind = input.rewindTaskContext
        ? input.rewindTaskContext({ taskId, userTurns: rewound.removedUserTurns })
        : { success: false, removedTurns: 0, remainingTurns: 0 };

    input.appendTranscript(taskId, 'system', `Rewound last ${rewound.removedUserTurns} user turn(s).`);
    input.emitHookEvent('TaskRewound', {
        taskId,
        payload: {
            removedUserTurns: rewound.removedUserTurns,
            removedEntries: rewound.removedEntries,
            newThreadId: updatedState.conversationThreadId,
        },
    });

    input.emitFor('rewind_task_response', {
        success: true,
        taskId,
        removedEntries: rewound.removedEntries,
        removedUserTurns: rewound.removedUserTurns,
        remainingEntries: rewound.remainingEntries,
        latestUserMessage: rewound.latestUserMessage ?? null,
        newThreadId: updatedState.conversationThreadId,
        contextRewind,
    });
    input.emitTaskStatus(taskId, {
        status: 'idle',
        blockingReason: `Task rewound by ${rewound.removedUserTurns} user turn(s).`,
    });
    return true;
}
