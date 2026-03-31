import { randomUUID } from 'crypto';
import type { DesktopEvent } from '../ipc/bridge';
type OutgoingMessage = Record<string, unknown>;
type UserMessageExecutionOptions = {
    taskId?: string;
    workspacePath?: string;
    requireToolApproval?: boolean;
    autoResumeSuspendedTools?: boolean;
    toolCallConcurrency?: number;
    maxSteps?: number;
};
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
    options?: UserMessageExecutionOptions,
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
    conversationThreadId: string;
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
    policyGateResponseTimeoutMs?: number;
    policyGateTimeoutRetryCount?: number;
};
const DEFAULT_POLICY_GATE_TIMEOUT_MS = 30_000;
const REQUEST_EFFECT_TIMEOUT_MS = 300_000;
const DEFAULT_POLICY_GATE_TIMEOUT_RETRY_COUNT = 1;
function isIpcTimeoutError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('IPC response timeout');
}
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
function parseVoiceProviderMode(value: unknown): 'auto' | 'system' | 'custom' | undefined {
    return value === 'auto' || value === 'system' || value === 'custom'
        ? value
        : undefined;
}
function buildUnsupportedAutonomousResponse(
    commandType: string,
    payload: Record<string, unknown>,
): { type: string; payload: Record<string, unknown> } | null {
    if (commandType === 'start_autonomous_task') {
        return {
            type: 'start_autonomous_task_response',
            payload: {
                success: false,
                taskId: getString(payload.taskId) ?? '',
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    if (commandType === 'get_autonomous_task_status') {
        return {
            type: 'get_autonomous_task_status_response',
            payload: {
                success: false,
                task: null,
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    if (
        commandType === 'pause_autonomous_task'
        || commandType === 'resume_autonomous_task'
        || commandType === 'cancel_autonomous_task'
    ) {
        return {
            type: `${commandType}_response`,
            payload: {
                success: false,
                taskId: getString(payload.taskId) ?? '',
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    if (commandType === 'list_autonomous_tasks') {
        return {
            type: 'list_autonomous_tasks_response',
            payload: {
                success: false,
                tasks: [],
                error: 'unsupported_in_mastra_runtime',
            },
        };
    }
    return null;
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
function isStoreDisabledHistoryReferenceError(message: string): boolean {
    const normalized = message.toLowerCase();
    return normalized.includes('item with id')
        && normalized.includes('not found')
        && normalized.includes('store')
        && normalized.includes('false');
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

function pickBooleanConfigValue(config: Record<string, unknown>, key: string): boolean | undefined {
    const value = config[key];
    return typeof value === 'boolean' ? value : undefined;
}

function pickPositiveIntegerConfigValue(
    config: Record<string, unknown>,
    key: string,
    min: number,
    max: number,
): number | undefined {
    const value = config[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    const normalized = Math.floor(value);
    if (normalized < min || normalized > max) {
        return undefined;
    }
    return normalized;
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
    const policyGateResponseTimeoutMs =
        deps.policyGateResponseTimeoutMs ?? DEFAULT_POLICY_GATE_TIMEOUT_MS;
    const policyGateTimeoutRetryCount =
        deps.policyGateTimeoutRetryCount ?? DEFAULT_POLICY_GATE_TIMEOUT_RETRY_COUNT;
    let transportClosed = false;
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
    const clearPendingApprovalsForTask = (taskId: string): void => {
        for (const [requestId, pending] of pendingApprovals.entries()) {
            if (pending.taskId === taskId) {
                pendingApprovals.delete(requestId);
            }
        }
    };
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
            conversationThreadId: patch.conversationThreadId ?? existing?.conversationThreadId ?? taskId,
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
            threadId: task.conversationThreadId,
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
            clearPendingApprovalsForTask(taskId);
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
            clearPendingApprovalsForTask(taskId);
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
    const closePendingForwardResponses = (reason: string): void => {
        for (const [commandId, pending] of pendingForwardResponses.entries()) {
            clearTimeout(pending.timeout);
            pendingForwardResponses.delete(commandId);
            pending.reject(new Error(reason));
        }
    };
    const forwardCommandAndWaitOnce = (
        type: string,
        payload: Record<string, unknown>,
        emit: (message: OutgoingMessage) => void,
        timeoutMs = policyGateResponseTimeoutMs,
    ): Promise<ProtocolCommand> => {
        if (transportClosed) {
            return Promise.reject(new Error('ipc_transport_closed'));
        }
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
            try {
                emit({
                    id: internalCommandId,
                    timestamp: getNowIso(),
                    type,
                    payload,
                });
            } catch (error) {
                clearTimeout(timeout);
                pendingForwardResponses.delete(internalCommandId);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    };
    const forwardCommandAndWait = async (
        type: string,
        payload: Record<string, unknown>,
        emit: (message: OutgoingMessage) => void,
        timeoutMs = policyGateResponseTimeoutMs,
    ): Promise<ProtocolCommand> => {
        let lastError: unknown;
        for (let attempt = 0; attempt <= policyGateTimeoutRetryCount; attempt += 1) {
            try {
                return await forwardCommandAndWaitOnce(type, payload, emit, timeoutMs);
            } catch (error) {
                lastError = error;
                const shouldRetry =
                    !transportClosed
                    && attempt < policyGateTimeoutRetryCount
                    && isIpcTimeoutError(error);
                if (!shouldRetry) {
                    throw error;
                }
            }
        }
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
        close: (reason = 'ipc_transport_closed'): void => {
            transportClosed = true;
            closePendingForwardResponses(reason);
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
            const emitFor = (type: string, responsePayload: Record<string, unknown>): void => {
                emit(buildResponse(commandId, type, responsePayload, getNowIso));
            };
            const emitCurrent = (responsePayload: Record<string, unknown>): void => {
                emitFor(`${command.type}_response`, responsePayload);
            };
            const emitInvalidPayload = (
                type: string,
                extra: Record<string, unknown> = {},
            ): void => {
                emitFor(type, {
                    success: false,
                    ...extra,
                    error: 'invalid_payload',
                });
            };
            const emitCurrentInvalidPayload = (extra: Record<string, unknown> = {}): void => {
                emitInvalidPayload(`${command.type}_response`, extra);
            };
            const emitTaskStarted = (input: {
                taskId: string;
                title: string;
                message: string;
                workspacePath: string;
                scheduled?: boolean;
            }): void => {
                emit({
                    type: 'TASK_STARTED',
                    taskId: input.taskId,
                    payload: {
                        title: input.title,
                        description: input.message,
                        context: {
                            workspacePath: input.workspacePath,
                            userQuery: input.message,
                            ...(input.scheduled ? { scheduled: true } : {}),
                        },
                    },
                });
            };
            const emitTaskSummary = (input: {
                taskId: string;
                summary: string;
                finishReason: string;
            }): void => {
                emit({
                    type: 'TEXT_DELTA',
                    taskId: input.taskId,
                    payload: {
                        delta: input.summary,
                        role: 'assistant',
                    },
                });
                emit({
                    type: 'TASK_FINISHED',
                    taskId: input.taskId,
                    payload: {
                        summary: input.summary,
                        finishReason: input.finishReason,
                    },
                });
            };
            const runUserMessageWithThreadRecovery = async (input: {
                taskId: string;
                message: string;
                resourceId: string;
                preferredThreadId: string;
                workspacePath?: string;
                executionOptions?: UserMessageExecutionOptions;
            }): Promise<void> => {
                const executeAttempt = async (threadId: string): Promise<DesktopEvent[]> => {
                    const events: DesktopEvent[] = [];
                    await deps.handleUserMessage(
                        input.message,
                        threadId,
                        input.resourceId,
                        (event) => events.push(event),
                        {
                            ...input.executionOptions,
                            taskId: input.taskId,
                            workspacePath: input.workspacePath,
                        },
                    );
                    return events;
                };

                const firstAttemptEvents = await executeAttempt(input.preferredThreadId);
                const hasRecoverableHistoryError = firstAttemptEvents.some((event) =>
                    event.type === 'error'
                    && isStoreDisabledHistoryReferenceError(event.message),
                );
                const hasAssistantProgress = firstAttemptEvents.some((event) =>
                    event.type === 'text_delta'
                    || event.type === 'tool_call'
                    || event.type === 'approval_required'
                    || event.type === 'tool_result',
                );

                if (hasRecoverableHistoryError && !hasAssistantProgress) {
                    const recoveryThreadId = `${input.taskId}-recovery-${createId()}`;
                    upsertTaskState(input.taskId, {
                        conversationThreadId: recoveryThreadId,
                    });
                    const retryEvents = await executeAttempt(recoveryThreadId);
                    for (const event of retryEvents) {
                        emitDesktopEvent(input.taskId, event, emit);
                    }
                    return;
                }

                for (const event of firstAttemptEvents) {
                    emitDesktopEvent(input.taskId, event, emit);
                }
            };
            if (command.type === 'bootstrap_runtime_context') {
                bootstrapRuntimeContext = toRecord(payload.runtimeContext);
                emitFor('bootstrap_runtime_context_response', {
                    success: true,
                });
                return;
            }
            if (command.type === 'get_runtime_snapshot') {
                try {
                    emitFor('get_runtime_snapshot_response', {
                        success: true,
                        snapshot: collectRuntimeSnapshot(),
                    });
                } catch (error) {
                    emitFor('get_runtime_snapshot_response', {
                        success: false,
                        snapshot: {
                            generatedAt: getNowIso(),
                            tasks: [],
                            count: 0,
                        },
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                return;
            }
            if (command.type === 'doctor_preflight') {
                emitFor('doctor_preflight_response', {
                    success: true,
                    report: {
                        runtime: 'mastra',
                        status: 'ok',
                        hasRuntimeContext: Boolean(bootstrapRuntimeContext),
                    },
                    markdown: '# Doctor Preflight\n\nMastra runtime is healthy.',
                });
                return;
            }
            if (command.type === 'get_tasks') {
                const workspacePath = getString(payload.workspacePath);
                if (!workspacePath) {
                    emitInvalidPayload('get_tasks_response', { tasks: [], count: 0 });
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
                emitFor('get_tasks_response', {
                    success: true,
                    tasks,
                    count: tasks.length,
                });
                return;
            }
            if (command.type === 'get_voice_state') {
                emitFor('get_voice_state_response', {
                    success: true,
                    state: toRecord(getVoicePlaybackState()),
                });
                return;
            }
            if (command.type === 'stop_voice') {
                const stopped = await stopVoicePlayback('user_requested');
                emitFor('stop_voice_response', {
                    success: true,
                    stopped,
                    state: toRecord(getVoicePlaybackState()),
                });
                return;
            }
            if (command.type === 'get_voice_provider_status') {
                const effectiveProviderMode = parseVoiceProviderMode(payload.providerMode);
                emitFor('get_voice_provider_status_response', {
                    success: true,
                    ...toRecord(getVoiceProviderStatus(effectiveProviderMode)),
                });
                return;
            }
            if (command.type === 'transcribe_voice') {
                const audioBase64 = getString(payload.audioBase64) ?? '';
                if (!audioBase64) {
                    emitInvalidPayload('transcribe_voice_response');
                    return;
                }
                const effectiveProviderMode = parseVoiceProviderMode(payload.providerMode);
                emitFor('transcribe_voice_response', await transcribeWithCustomAsr({
                    audioBase64,
                    mimeType: getString(payload.mimeType) ?? undefined,
                    language: getString(payload.language) ?? undefined,
                    providerMode: effectiveProviderMode,
                }));
                return;
            }
            const unsupportedAutonomous = buildUnsupportedAutonomousResponse(command.type, payload);
            if (unsupportedAutonomous) {
                emitFor(unsupportedAutonomous.type, unsupportedAutonomous.payload);
                return;
            }
            if (command.type === 'start_task' || command.type === 'send_task_message') {
                const taskId = getString(payload.taskId) ?? '';
                const message = command.type === 'start_task'
                    ? getString(payload.userQuery)
                    : getString(payload.content);
                if (!taskId || !message) {
                    emitCurrentInvalidPayload({ taskId });
                    return;
                }
                const workspacePath = getString(toRecord(payload.context).workspacePath) ?? process.cwd();
                const commandConfig = toRecord(payload.config);
                const executionOptions: UserMessageExecutionOptions = {
                    requireToolApproval: pickBooleanConfigValue(commandConfig, 'requireToolApproval'),
                    autoResumeSuspendedTools: pickBooleanConfigValue(commandConfig, 'autoResumeSuspendedTools'),
                    toolCallConcurrency: pickPositiveIntegerConfigValue(commandConfig, 'toolCallConcurrency', 1, 32),
                    maxSteps: pickPositiveIntegerConfigValue(commandConfig, 'maxSteps', 1, 128),
                };
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
                    emitFor('send_task_message_response', {
                        success: true,
                        taskId,
                    });
                    const cancellationSummary = cancelled.cancelledCount > 0
                        ? `已取消 ${cancelled.cancelledCount} 个定时任务。`
                        : '没有可取消的定时任务。';
                    emitTaskSummary({
                        taskId,
                        summary: cancellationSummary,
                        finishReason: 'scheduled_cancel',
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
                        emitCurrent({
                            success: false,
                            taskId,
                            error: scheduleDecision.error,
                        });
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
                            emitTaskStarted({
                                taskId,
                                title: getString(payload.title) ?? 'Task',
                                message,
                                workspacePath,
                                scheduled: true,
                            });
                        }
                        emitCurrent({
                            success: true,
                            taskId,
                        });
                        const summary = scheduleDecision.summary ?? '已安排定时任务。';
                        emitTaskSummary({
                            taskId,
                            summary,
                            finishReason: 'scheduled',
                        });
                        return;
                    }
                }
                const state = upsertTaskState(taskId, {
                    title: getString(payload.title) ?? taskStates.get(taskId)?.title ?? 'Task',
                    workspacePath,
                    status: 'running',
                    suspended: false,
                    suspensionReason: undefined,
                    lastUserMessage: message,
                    resourceId,
                });
                if (command.type === 'start_task') {
                    emitTaskStarted({
                        taskId,
                        title: getString(payload.title) ?? 'Task',
                        message,
                        workspacePath,
                    });
                }
                emitCurrent({
                    success: true,
                    taskId,
                });
                await runUserMessageWithThreadRecovery({
                    taskId,
                    message,
                    resourceId,
                    preferredThreadId: state.conversationThreadId,
                    workspacePath: state.workspacePath,
                    executionOptions,
                });
                return;
            }
            if (command.type === 'resume_interrupted_task') {
                const taskId = getString(payload.taskId) ?? '';
                if (!taskId) {
                    emitInvalidPayload('resume_interrupted_task_response', { taskId });
                    return;
                }
                const state = upsertTaskState(taskId, {
                    status: 'running',
                    suspended: false,
                    suspensionReason: undefined,
                    resourceId: resolveTaskResourceId(taskId, payload, taskStates.get(taskId)?.resourceId),
                });
                const resumeMessage = state.lastUserMessage ?? 'Continue from the saved task context.';
                emitFor('resume_interrupted_task_response', {
                    success: true,
                    taskId,
                });
                await deps.handleUserMessage(
                    resumeMessage,
                    state.conversationThreadId,
                    state.resourceId,
                    (event) => emitDesktopEvent(taskId, event, emit),
                    {
                        taskId,
                        workspacePath: state.workspacePath,
                    },
                );
                return;
            }
            if (command.type === 'report_effect_result') {
                const requestId = getString(payload.requestId);
                const success = payload.success;
                if (!requestId || typeof success !== 'boolean') {
                    emitInvalidPayload('report_effect_result_response');
                    return;
                }
                const pending = pendingApprovals.get(requestId);
                if (!pending || !pending.runId) {
                    emitFor('report_effect_result_response', {
                        success: false,
                        requestId,
                        error: 'approval_request_not_found',
                    });
                    return;
                }
                pendingApprovals.delete(requestId);
                await deps.handleApprovalResponse(
                    pending.runId,
                    pending.toolCallId,
                    success,
                    (event) => emitDesktopEvent(pending.taskId, event, emit),
                );
                emitFor('report_effect_result_response', {
                    success: true,
                    requestId,
                });
                return;
            }
            if (command.type === 'clear_task_history' || command.type === 'cancel_task') {
                const taskId = getString(payload.taskId) ?? '';
                let cancelledScheduledCount = 0;
                if (taskId) {
                    clearPendingApprovalsForTask(taskId);
                    if (command.type === 'cancel_task') {
                        if (deps.cancelScheduledTasksForSourceTask) {
                            const cancelled = await deps.cancelScheduledTasksForSourceTask({
                                sourceTaskId: taskId,
                                userMessage: 'cancel_task',
                            });
                            cancelledScheduledCount = cancelled.cancelledCount;
                        }
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
                const responsePayload: Record<string, unknown> = {
                    success: true,
                    taskId,
                };
                if (command.type === 'cancel_task') {
                    responsePayload.cancelledScheduledCount = cancelledScheduledCount;
                }
                emitCurrent(responsePayload);
                return;
            }
            if (forwardedCommandTypes.has(command.type)) {
                try {
                    const forwarded = await forwardCommandAndWait(
                        command.type,
                        payload,
                        emit,
                        command.type === 'request_effect' ? REQUEST_EFFECT_TIMEOUT_MS : policyGateResponseTimeoutMs,
                    );
                    const expectedType = `${command.type}_response`;
                    if (forwarded.type === expectedType) {
                        emitFor(expectedType, toRecord(forwarded.payload));
                        return;
                    }
                    emitFor(expectedType, {
                        success: false,
                        error: `policy_gate_invalid_response:${forwarded.type}`,
                    });
                    return;
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    if (command.type === 'apply_patch') {
                        emitFor('apply_patch_response', {
                            patchId: getString(payload.patchId) ?? createId(),
                            success: false,
                            error: `policy_gate_unavailable:${errorMessage}`,
                            errorCode: 'io_error',
                        });
                        return;
                    }
                    emitCurrent({
                        success: false,
                        error: `policy_gate_unavailable:${errorMessage}`,
                    });
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
            emitCurrent({
                success: false,
                error: 'unsupported_in_mastra_runtime',
            });
        },
    };
}
