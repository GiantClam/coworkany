import { randomUUID } from 'crypto';
import type { DesktopEvent } from '../ipc/bridge';

type OutgoingMessage = Record<string, unknown>;

type ProtocolCommand = {
    id?: string;
    commandId?: string;
    type?: string;
    payload?: unknown;
    timestamp?: string;
};

type UserMessageHandler = (
    message: string,
    threadId: string,
    resourceId: string,
    sendToDesktop: (event: DesktopEvent) => void,
) => Promise<{ runId: string }>;

type ApprovalHandler = (
    runId: string,
    toolCallId: string,
    approved: boolean,
    sendToDesktop: (event: DesktopEvent) => void,
) => Promise<void>;

type PendingApproval = {
    taskId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
};

type PendingForwardResponse = {
    resolve: (response: ProtocolCommand) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
};

type TaskRuntimeStatus = 'running' | 'idle' | 'finished' | 'failed' | 'interrupted' | 'suspended' | 'scheduled';

type TaskRuntimeState = {
    taskId: string;
    title: string;
    workspacePath: string;
    createdAt: string;
    status: TaskRuntimeStatus;
    suspended?: boolean;
    suspensionReason?: string;
    lastUserMessage?: string;
    resourceId: string;
};

type ProcessorDeps = {
    handleUserMessage: UserMessageHandler;
    handleApprovalResponse: ApprovalHandler;
    getMastraHealth: () => {
        agents: string[];
        workflows: string[];
        storageConfigured: boolean;
    };
    stopVoicePlayback?: (reason?: string) => Promise<boolean>;
    getVoicePlaybackState?: () => unknown;
    getVoiceProviderStatus?: (providerMode?: 'auto' | 'system' | 'custom') => unknown;
    transcribeWithCustomAsr?: (input: {
        audioBase64: string;
        mimeType?: string;
        language?: string;
        providerMode?: 'auto' | 'system' | 'custom';
    }) => Promise<Record<string, unknown>>;
    scheduleTaskIfNeeded?: (input: {
        sourceTaskId: string;
        title?: string;
        message: string;
        workspacePath: string;
        config?: Record<string, unknown>;
    }) => Promise<{
        scheduled: boolean;
        summary?: string;
        error?: string;
    }>;
    cancelScheduledTasksForSourceTask?: (input: {
        sourceTaskId: string;
        userMessage: string;
    }) => Promise<{
        success: boolean;
        cancelledCount: number;
        cancelledTitles: string[];
    }>;
    handleAdditionalCommand?: (command: ProtocolCommand) => Promise<OutgoingMessage | null>;
    getNowIso?: () => string;
    createId?: () => string;
    resolveResourceId?: (taskId: string) => string;
};

function toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function toProtocolCommand(value: unknown): ProtocolCommand | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value as ProtocolCommand;
}

function getString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function isScheduledCancellationRequest(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }

    const chineseExplicitCancel = /(?:取消|停止|终止|结束|关闭|关掉|停掉).*(?:提醒|定时|任务|闹钟|计划|上述|这个|该)/u;
    if (chineseExplicitCancel.test(trimmed)) {
        return true;
    }

    const chineseShortCancel = /^(?:取消|停止|终止|结束)(?:上述|这个|该)?任务$/u;
    if (chineseShortCancel.test(trimmed)) {
        return true;
    }

    return /\b(cancel|stop|abort|terminate)\b/i.test(trimmed) && /\b(reminder|scheduled?|task)\b/i.test(trimmed);
}

function pickResourceOverride(payload: Record<string, unknown>): string | null {
    const fromPayload = getString(payload.resourceId) ?? getString(payload.memoryResourceId);
    if (fromPayload) {
        return fromPayload;
    }
    const context = toRecord(payload.context);
    const fromContext = getString(context.resourceId) ?? getString(context.memoryResourceId);
    if (fromContext) {
        return fromContext;
    }
    const config = toRecord(payload.config);
    return getString(config.resourceId) ?? getString(config.memoryResourceId);
}

function buildResponse(
    commandId: string,
    type: string,
    payload: Record<string, unknown>,
    getNowIso: () => string,
): OutgoingMessage {
    return {
        type,
        commandId,
        timestamp: getNowIso(),
        payload,
    };
}

function deriveDefaultResourceId(taskId: string): string {
    const configured = process.env.COWORKANY_MASTRA_RESOURCE_ID;
    if (typeof configured === 'string' && configured.trim().length > 0) {
        return configured.trim();
    }
    return `employee-${taskId}`;
}

export function createMastraEntrypointProcessor(deps: ProcessorDeps) {
    const getNowIso = deps.getNowIso ?? (() => new Date().toISOString());
    const createId = deps.createId ?? (() => randomUUID());
    const resolveResourceId = deps.resolveResourceId ?? deriveDefaultResourceId;
    const stopVoicePlayback = deps.stopVoicePlayback ?? (async () => false);
    const getVoicePlaybackState = deps.getVoicePlaybackState ?? (() => ({
        isSpeaking: false,
        canStop: false,
    }));
    const getVoiceProviderStatus = deps.getVoiceProviderStatus ?? (() => ({
        preferredAsr: 'system',
        preferredTts: 'system',
        hasCustomAsr: false,
        hasCustomTts: false,
        providers: {
            asr: [],
            tts: [],
        },
    }));
    const transcribeWithCustomAsr = deps.transcribeWithCustomAsr ?? (async () => ({
        success: false,
        error: 'transcription_unavailable',
    }));
    const pendingApprovals = new Map<string, PendingApproval>();
    const pendingForwardResponses = new Map<string, PendingForwardResponse>();
    const taskStates = new Map<string, TaskRuntimeState>();
    const forwardedCommandTypes = new Set<string>([
        'request_effect',
        'propose_patch',
        'apply_patch',
        'reject_patch',
        'read_file',
        'list_dir',
        'exec_shell',
        'capture_screen',
        'get_policy_config',
    ]);
    let bootstrapRuntimeContext: Record<string, unknown> | undefined;

    const resolveTaskResourceId = (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ): string => {
        const fromPayload = pickResourceOverride(payload);
        if (fromPayload) {
            return fromPayload;
        }
        if (existingResourceId) {
            return existingResourceId;
        }
        const fromBootstrap = bootstrapRuntimeContext
            ? (getString(bootstrapRuntimeContext.resourceId) ?? getString(bootstrapRuntimeContext.memoryResourceId))
            : null;
        if (fromBootstrap) {
            return fromBootstrap;
        }
        return resolveResourceId(taskId);
    };

    const upsertTaskState = (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ): TaskRuntimeState => {
        const existing = taskStates.get(taskId);
        const hasSuspended = Object.prototype.hasOwnProperty.call(patch, 'suspended');
        const hasSuspensionReason = Object.prototype.hasOwnProperty.call(patch, 'suspensionReason');
        const hasLastUserMessage = Object.prototype.hasOwnProperty.call(patch, 'lastUserMessage');
        const next: TaskRuntimeState = {
            taskId,
            title: patch.title ?? existing?.title ?? 'Task',
            workspacePath: patch.workspacePath ?? existing?.workspacePath ?? process.cwd(),
            createdAt: existing?.createdAt ?? patch.createdAt ?? getNowIso(),
            status: patch.status ?? existing?.status ?? 'idle',
            suspended: hasSuspended ? patch.suspended : existing?.suspended,
            suspensionReason: hasSuspensionReason ? patch.suspensionReason : existing?.suspensionReason,
            lastUserMessage: hasLastUserMessage ? patch.lastUserMessage : existing?.lastUserMessage,
            resourceId: patch.resourceId ?? existing?.resourceId ?? resolveResourceId(taskId),
        };
        taskStates.set(taskId, next);
        return next;
    };

    const collectRuntimeSnapshot = () => {
        const tasks = Array.from(taskStates.values()).map((task) => ({
            taskId: task.taskId,
            title: task.title,
            workspacePath: task.workspacePath,
            createdAt: task.createdAt,
            status: task.status,
            suspended: task.suspended,
            suspensionReason: task.suspensionReason,
            resourceId: task.resourceId,
        }));
        const activeTaskId = tasks.find((task) => task.status === 'running')?.taskId
            ?? tasks.find((task) => task.status === 'suspended')?.taskId
            ?? tasks.find((task) => task.status === 'interrupted')?.taskId;
        return {
            generatedAt: getNowIso(),
            activeTaskId,
            tasks,
            count: tasks.length,
        };
    };

    const emitDesktopEvent = (
        taskId: string,
        event: DesktopEvent,
        emit: (message: OutgoingMessage) => void,
    ): void => {
        if (event.type === 'text_delta') {
            emit({
                type: 'TEXT_DELTA',
                taskId,
                payload: {
                    delta: event.content,
                    role: 'assistant',
                },
            });
            return;
        }

        if (event.type === 'approval_required') {
            const requestId = createId();
            pendingApprovals.set(requestId, {
                taskId,
                runId: event.runId ?? '',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
            });
            emit({
                type: 'EFFECT_REQUESTED',
                taskId,
                payload: {
                    request: {
                        id: requestId,
                        timestamp: getNowIso(),
                        effectType: 'shell:write',
                        source: 'agent',
                        payload: {
                            description: `Mastra tool approval required: ${event.toolName}`,
                            command: JSON.stringify(event.args ?? {}),
                        },
                        context: {
                            taskId,
                            toolName: event.toolName,
                        },
                    },
                    requiresUserConfirmation: true,
                    riskLevel: 7,
                },
            });
            upsertTaskState(taskId, {
                status: 'suspended',
                suspended: true,
                suspensionReason: 'approval_required',
            });
            return;
        }

        if (event.type === 'complete') {
            upsertTaskState(taskId, {
                status: 'finished',
                suspended: false,
                suspensionReason: undefined,
            });
            emit({
                type: 'TASK_FINISHED',
                taskId,
                payload: {
                    summary: 'Task completed via Mastra runtime.',
                    finishReason: event.finishReason ?? 'stop',
                },
            });
            return;
        }

        if (event.type === 'error') {
            upsertTaskState(taskId, {
                status: 'failed',
                suspended: false,
                suspensionReason: undefined,
            });
            emit({
                type: 'TASK_FAILED',
                taskId,
                payload: {
                    error: event.message,
                    errorCode: 'MASTRA_RUNTIME_ERROR',
                },
            });
            return;
        }

        if (event.type === 'suspended') {
            upsertTaskState(taskId, {
                status: 'suspended',
                suspended: true,
                suspensionReason: 'waiting_user_input',
            });
            emit({
                type: 'TASK_STATUS',
                taskId,
                payload: {
                    status: 'idle',
                    blockingReason: 'Waiting for user input to resume Mastra task.',
                },
            });
            return;
        }

        if (event.type === 'token_usage') {
            emit({
                type: 'TOKEN_USAGE',
                taskId,
                payload: {
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                    modelId: event.modelId ?? null,
                    provider: event.provider ?? null,
                    usage: event.usage,
                },
            });
            return;
        }

        upsertTaskState(taskId, {
            status: 'running',
            suspended: false,
            suspensionReason: undefined,
        });
        emit({
            type: 'TASK_EVENT',
            taskId,
            payload: event,
        });
    };

    const processLegacySimpleCommand = async (
        command: ProtocolCommand,
        emit: (message: OutgoingMessage) => void,
    ): Promise<boolean> => {
        if (command.type === 'health_check') {
            emit({
                type: 'health',
                runtime: 'mastra',
                health: deps.getMastraHealth(),
            });
            return true;
        }

        if (command.type === 'user_message') {
            const message = getString((command as { message?: unknown }).message);
            const threadId = getString((command as { threadId?: unknown }).threadId);
            const resourceId = getString((command as { resourceId?: unknown }).resourceId);
            if (!message || !threadId || !resourceId) {
                emit({ type: 'error', message: 'invalid_command' });
                return true;
            }
            await deps.handleUserMessage(
                message,
                threadId,
                resourceId,
                (event) => emit(toRecord(event)),
            );
            return true;
        }

        if (command.type === 'approval_response') {
            const runId = getString((command as { runId?: unknown }).runId);
            const toolCallId = getString((command as { toolCallId?: unknown }).toolCallId);
            const approved = (command as { approved?: unknown }).approved;
            if (!runId || !toolCallId || typeof approved !== 'boolean') {
                emit({ type: 'error', message: 'invalid_command' });
                return true;
            }
            await deps.handleApprovalResponse(
                runId,
                toolCallId,
                approved,
                (event) => emit(toRecord(event)),
            );
            return true;
        }

        return false;
    };

    const resolvePendingForwardResponse = (message: ProtocolCommand): boolean => {
        const messageId = getString(message.commandId);
        if (!messageId) {
            return false;
        }
        const pending = pendingForwardResponses.get(messageId);
        if (!pending) {
            return false;
        }

        clearTimeout(pending.timeout);
        pendingForwardResponses.delete(messageId);
        pending.resolve(message);
        return true;
    };

    const forwardCommandAndWait = (
        type: string,
        payload: Record<string, unknown>,
        emit: (message: OutgoingMessage) => void,
        timeoutMs = 30_000,
    ): Promise<ProtocolCommand> => {
        const internalCommandId = createId();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                pendingForwardResponses.delete(internalCommandId);
                reject(new Error(`IPC response timeout for ${type}`));
            }, timeoutMs);

            pendingForwardResponses.set(internalCommandId, {
                resolve,
                reject,
                timeout,
            });

            emit({
                id: internalCommandId,
                timestamp: getNowIso(),
                type,
                payload,
            });
        });
    };

    return {
        emitDesktopEventForTask: (
            taskId: string,
            event: DesktopEvent,
            emit: (message: OutgoingMessage) => void,
        ): void => {
            emitDesktopEvent(taskId, event, emit);
        },
        resolveResourceIdForTask: (taskId: string): string => {
            return taskStates.get(taskId)?.resourceId ?? resolveTaskResourceId(taskId, {});
        },
        processMessage: async (
            raw: unknown,
            emit: (message: OutgoingMessage) => void,
        ): Promise<void> => {
            const command = toProtocolCommand(raw);
            if (!command || !command.type) {
                emit({ type: 'error', message: 'invalid_command' });
                return;
            }

            if (command.type.endsWith('_response')) {
                resolvePendingForwardResponse(command);
                return;
            }

            if (await processLegacySimpleCommand(command, emit)) {
                return;
            }

            const commandId = getString(command.id) ?? createId();
            const payload = toRecord(command.payload);

            if (command.type === 'bootstrap_runtime_context') {
                bootstrapRuntimeContext = toRecord(payload.runtimeContext);
                emit(buildResponse(commandId, 'bootstrap_runtime_context_response', {
                    success: true,
                }, getNowIso));
                return;
            }

            if (command.type === 'get_runtime_snapshot') {
                try {
                    emit(buildResponse(commandId, 'get_runtime_snapshot_response', {
                        success: true,
                        snapshot: collectRuntimeSnapshot(),
                    }, getNowIso));
                } catch (error) {
                    emit(buildResponse(commandId, 'get_runtime_snapshot_response', {
                        success: false,
                        snapshot: {
                            generatedAt: getNowIso(),
                            tasks: [],
                            count: 0,
                        },
                        error: error instanceof Error ? error.message : String(error),
                    }, getNowIso));
                }
                return;
            }

            if (command.type === 'doctor_preflight') {
                emit(buildResponse(commandId, 'doctor_preflight_response', {
                    success: true,
                    report: {
                        runtime: 'mastra',
                        status: 'ok',
                        hasRuntimeContext: Boolean(bootstrapRuntimeContext),
                    },
                    markdown: '# Doctor Preflight\n\nMastra runtime is healthy.',
                }, getNowIso));
                return;
            }

            if (command.type === 'get_tasks') {
                const workspacePath = getString(payload.workspacePath);
                if (!workspacePath) {
                    emit(buildResponse(commandId, 'get_tasks_response', {
                        success: false,
                        tasks: [],
                        count: 0,
                        error: 'invalid_payload',
                    }, getNowIso));
                    return;
                }
                const statusFilter = Array.isArray(payload.status)
                    ? new Set(payload.status.filter((value): value is string => typeof value === 'string'))
                    : null;
                const limit = typeof payload.limit === 'number' && payload.limit > 0
                    ? Math.floor(payload.limit)
                    : null;
                const all = Array.from(taskStates.values())
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
                    }));
                const tasks = limit ? all.slice(0, limit) : all;
                emit(buildResponse(commandId, 'get_tasks_response', {
                    success: true,
                    tasks,
                    count: tasks.length,
                }, getNowIso));
                return;
            }

            if (command.type === 'get_voice_state') {
                emit(buildResponse(commandId, 'get_voice_state_response', {
                    success: true,
                    state: toRecord(getVoicePlaybackState()),
                }, getNowIso));
                return;
            }

            if (command.type === 'stop_voice') {
                const stopped = await stopVoicePlayback('user_requested');
                emit(buildResponse(commandId, 'stop_voice_response', {
                    success: true,
                    stopped,
                    state: toRecord(getVoicePlaybackState()),
                }, getNowIso));
                return;
            }

            if (command.type === 'get_voice_provider_status') {
                const providerMode = payload.providerMode;
                const effectiveProviderMode = providerMode === 'auto' || providerMode === 'system' || providerMode === 'custom'
                    ? providerMode
                    : undefined;
                emit(buildResponse(commandId, 'get_voice_provider_status_response', {
                    success: true,
                    ...toRecord(getVoiceProviderStatus(effectiveProviderMode)),
                }, getNowIso));
                return;
            }

            if (command.type === 'transcribe_voice') {
                const audioBase64 = getString(payload.audioBase64) ?? '';
                if (!audioBase64) {
                    emit(buildResponse(commandId, 'transcribe_voice_response', {
                        success: false,
                        error: 'invalid_payload',
                    }, getNowIso));
                    return;
                }
                const providerMode = payload.providerMode;
                const effectiveProviderMode = providerMode === 'auto' || providerMode === 'system' || providerMode === 'custom'
                    ? providerMode
                    : undefined;
                emit(buildResponse(commandId, 'transcribe_voice_response', await transcribeWithCustomAsr({
                    audioBase64,
                    mimeType: getString(payload.mimeType) ?? undefined,
                    language: getString(payload.language) ?? undefined,
                    providerMode: effectiveProviderMode,
                }), getNowIso));
                return;
            }

            if (command.type === 'start_autonomous_task') {
                emit(buildResponse(commandId, 'start_autonomous_task_response', {
                    success: false,
                    taskId: getString(payload.taskId) ?? '',
                    error: 'unsupported_in_mastra_runtime',
                }, getNowIso));
                return;
            }

            if (command.type === 'get_autonomous_task_status') {
                emit(buildResponse(commandId, 'get_autonomous_task_status_response', {
                    success: false,
                    task: null,
                    error: 'unsupported_in_mastra_runtime',
                }, getNowIso));
                return;
            }

            if (command.type === 'pause_autonomous_task'
                || command.type === 'resume_autonomous_task'
                || command.type === 'cancel_autonomous_task') {
                emit(buildResponse(commandId, `${command.type}_response`, {
                    success: false,
                    taskId: getString(payload.taskId) ?? '',
                    error: 'unsupported_in_mastra_runtime',
                }, getNowIso));
                return;
            }

            if (command.type === 'list_autonomous_tasks') {
                emit(buildResponse(commandId, 'list_autonomous_tasks_response', {
                    success: false,
                    tasks: [],
                    error: 'unsupported_in_mastra_runtime',
                }, getNowIso));
                return;
            }

            if (command.type === 'start_task' || command.type === 'send_task_message') {
                const taskId = getString(payload.taskId) ?? '';
                const message = command.type === 'start_task'
                    ? getString(payload.userQuery)
                    : getString(payload.content);
                if (!taskId || !message) {
                    emit(buildResponse(commandId, `${command.type}_response`, {
                        success: false,
                        taskId,
                        error: 'invalid_payload',
                    }, getNowIso));
                    return;
                }

                const workspacePath = getString(toRecord(payload.context).workspacePath) ?? process.cwd();
                const previousState = taskStates.get(taskId);
                const resourceId = resolveTaskResourceId(taskId, payload, previousState?.resourceId);

                if (
                    command.type === 'send_task_message'
                    && deps.cancelScheduledTasksForSourceTask
                    && isScheduledCancellationRequest(message)
                ) {
                    const cancelled = await deps.cancelScheduledTasksForSourceTask({
                        sourceTaskId: taskId,
                        userMessage: message,
                    });
                    upsertTaskState(taskId, {
                        title: getString(payload.title) ?? previousState?.title ?? 'Task',
                        workspacePath,
                        status: 'idle',
                        suspended: false,
                        suspensionReason: undefined,
                        lastUserMessage: message,
                        resourceId,
                    });
                    emit(buildResponse(commandId, 'send_task_message_response', {
                        success: true,
                        taskId,
                    }, getNowIso));
                    const cancellationSummary = cancelled.cancelledCount > 0
                        ? `已取消 ${cancelled.cancelledCount} 个定时任务。`
                        : '没有可取消的定时任务。';
                    emit({
                        type: 'TEXT_DELTA',
                        taskId,
                        payload: {
                            delta: cancellationSummary,
                            role: 'assistant',
                        },
                    });
                    emit({
                        type: 'TASK_FINISHED',
                        taskId,
                        payload: {
                            summary: cancellationSummary,
                            finishReason: 'scheduled_cancel',
                        },
                    });
                    return;
                }

                if (deps.scheduleTaskIfNeeded) {
                    const scheduleDecision = await deps.scheduleTaskIfNeeded({
                        sourceTaskId: taskId,
                        title: getString(payload.title) ?? undefined,
                        message,
                        workspacePath,
                        config: toRecord(payload.config),
                    });
                    if (scheduleDecision.error) {
                        emit(buildResponse(commandId, `${command.type}_response`, {
                            success: false,
                            taskId,
                            error: scheduleDecision.error,
                        }, getNowIso));
                        return;
                    }
                    if (scheduleDecision.scheduled) {
                        upsertTaskState(taskId, {
                            title: getString(payload.title) ?? previousState?.title ?? 'Task',
                            workspacePath,
                            status: 'scheduled',
                            suspended: false,
                            suspensionReason: undefined,
                            lastUserMessage: message,
                            resourceId,
                        });
                        if (command.type === 'start_task') {
                            emit({
                                type: 'TASK_STARTED',
                                taskId,
                                payload: {
                                    title: getString(payload.title) ?? 'Task',
                                    description: message,
                                    context: {
                                        workspacePath,
                                        userQuery: message,
                                        scheduled: true,
                                    },
                                },
                            });
                        }
                        emit(buildResponse(commandId, `${command.type}_response`, {
                            success: true,
                            taskId,
                        }, getNowIso));
                        const summary = scheduleDecision.summary ?? '已安排定时任务。';
                        emit({
                            type: 'TEXT_DELTA',
                            taskId,
                            payload: {
                                delta: summary,
                                role: 'assistant',
                            },
                        });
                        emit({
                            type: 'TASK_FINISHED',
                            taskId,
                            payload: {
                                summary,
                                finishReason: 'scheduled',
                            },
                        });
                        return;
                    }
                }

                upsertTaskState(taskId, {
                    title: getString(payload.title) ?? taskStates.get(taskId)?.title ?? 'Task',
                    workspacePath,
                    status: 'running',
                    suspended: false,
                    suspensionReason: undefined,
                    lastUserMessage: message,
                    resourceId,
                });
                if (command.type === 'start_task') {
                    emit({
                        type: 'TASK_STARTED',
                        taskId,
                        payload: {
                            title: getString(payload.title) ?? 'Task',
                            description: message,
                            context: {
                                workspacePath,
                                userQuery: message,
                            },
                        },
                    });
                }
                emit(buildResponse(commandId, `${command.type}_response`, {
                    success: true,
                    taskId,
                }, getNowIso));

                await deps.handleUserMessage(
                    message,
                    taskId,
                    resourceId,
                    (event) => emitDesktopEvent(taskId, event, emit),
                );
                return;
            }

            if (command.type === 'resume_interrupted_task') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emit(buildResponse(commandId, 'resume_interrupted_task_response', {
                        success: false,
                        taskId,
                        error: 'invalid_payload',
                    }, getNowIso));
                    return;
                }

                const state = upsertTaskState(taskId, {
                    status: 'running',
                    suspended: false,
                    suspensionReason: undefined,
                    resourceId: resolveTaskResourceId(taskId, payload, taskStates.get(taskId)?.resourceId),
                });
                const resumeMessage = state.lastUserMessage ?? 'Continue from the saved task context.';
                emit(buildResponse(commandId, 'resume_interrupted_task_response', {
                    success: true,
                    taskId,
                }, getNowIso));
                await deps.handleUserMessage(
                    resumeMessage,
                    taskId,
                    state.resourceId,
                    (event) => emitDesktopEvent(taskId, event, emit),
                );
                return;
            }

            if (command.type === 'report_effect_result') {
                const requestId = getString(payload.requestId);
                const success = payload.success;
                if (!requestId || typeof success !== 'boolean') {
                    emit(buildResponse(commandId, 'report_effect_result_response', {
                        success: false,
                        error: 'invalid_payload',
                    }, getNowIso));
                    return;
                }
                const pending = pendingApprovals.get(requestId);
                if (!pending || !pending.runId) {
                    emit(buildResponse(commandId, 'report_effect_result_response', {
                        success: false,
                        requestId,
                        error: 'approval_request_not_found',
                    }, getNowIso));
                    return;
                }
                pendingApprovals.delete(requestId);
                await deps.handleApprovalResponse(
                    pending.runId,
                    pending.toolCallId,
                    success,
                    (event) => emitDesktopEvent(pending.taskId, event, emit),
                );
                emit(buildResponse(commandId, 'report_effect_result_response', {
                    success: true,
                    requestId,
                }, getNowIso));
                return;
            }

            if (command.type === 'clear_task_history' || command.type === 'cancel_task') {
                const taskId = getString(payload.taskId) ?? '';
                if (taskId) {
                    if (command.type === 'cancel_task') {
                        upsertTaskState(taskId, {
                            status: 'idle',
                            suspended: false,
                            suspensionReason: undefined,
                        });
                    } else {
                        upsertTaskState(taskId, {
                            status: 'idle',
                            suspended: false,
                            suspensionReason: undefined,
                            lastUserMessage: undefined,
                        });
                    }
                }
                emit(buildResponse(commandId, `${command.type}_response`, {
                    success: true,
                    taskId,
                }, getNowIso));
                return;
            }

            if (forwardedCommandTypes.has(command.type)) {
                try {
                    const forwarded = await forwardCommandAndWait(
                        command.type,
                        payload,
                        emit,
                        command.type === 'request_effect' ? 300_000 : 30_000,
                    );
                    const expectedType = `${command.type}_response`;
                    if (forwarded.type === expectedType) {
                        emit(buildResponse(commandId, expectedType, toRecord(forwarded.payload), getNowIso));
                        return;
                    }
                    emit(buildResponse(commandId, expectedType, {
                        success: false,
                        error: `policy_gate_invalid_response:${forwarded.type}`,
                    }, getNowIso));
                    return;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (command.type === 'apply_patch') {
                        emit(buildResponse(commandId, 'apply_patch_response', {
                            patchId: getString(payload.patchId) ?? createId(),
                            success: false,
                            error: `policy_gate_unavailable:${errorMessage}`,
                            errorCode: 'io_error',
                        }, getNowIso));
                        return;
                    }
                    emit(buildResponse(commandId, `${command.type}_response`, {
                        success: false,
                        error: `policy_gate_unavailable:${errorMessage}`,
                    }, getNowIso));
                    return;
                }
            }

            if (deps.handleAdditionalCommand) {
                const delegated = await deps.handleAdditionalCommand(command);
                if (delegated) {
                    emit(delegated);
                    return;
                }
            }

            emit(buildResponse(commandId, `${command.type}_response`, {
                success: false,
                error: 'unsupported_in_mastra_runtime',
            }, getNowIso));
        },
    };
}
