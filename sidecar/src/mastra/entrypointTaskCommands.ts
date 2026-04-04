import type { TaskRuntimeExecutionPath, TaskRuntimeRetryState, TaskRuntimeState } from './taskRuntimeState';
import { failGuard, passGuard, runGuardPipeline } from './entrypointGuardPipeline';
import { parseRoutedInput } from '../orchestration/routedInput';

type UserMessageExecutionOptions = {
    enabledSkills?: string[];
    skillPrompt?: string;
    requireToolApproval?: boolean;
    autoResumeSuspendedTools?: boolean;
    toolCallConcurrency?: number;
    maxSteps?: number;
    executionPath?: 'direct' | 'workflow';
    forcedRouteMode?: 'chat' | 'task';
    forcePostAssistantCompletion?: boolean;
};

type StartOrSendCommandType = 'start_task' | 'send_task_message';

type TaskStartedMode = 'chat' | 'immediate_task' | 'scheduled_task';

type HandleStartOrSendTaskCommandInput = {
    commandType: string;
    commandId: string;
    payload: Record<string, unknown>;
    taskStates: Map<string, TaskRuntimeState>;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => Record<string, unknown>;
    pickStringArrayConfigValue: (config: Record<string, unknown>, key: string) => string[] | undefined;
    pickTaskRuntimeRetryConfig: (config: Record<string, unknown>) => TaskRuntimeRetryState | undefined;
    pickBooleanConfigValue: (config: Record<string, unknown>, key: string) => boolean | undefined;
    pickPositiveIntegerConfigValue: (
        config: Record<string, unknown>,
        key: string,
        min: number,
        max: number,
    ) => number | undefined;
    pickTaskExecutionPath: (config: Record<string, unknown>) => 'direct' | 'workflow' | undefined;
    toUserMessageExecutionPath: (path?: TaskRuntimeExecutionPath) => 'direct' | 'workflow';
    resolveSkillPrompt?: (input: {
        message: string;
        workspacePath: string;
        explicitEnabledSkills?: string[];
    }) => {
        prompt?: string;
        enabledSkillIds: string[];
    };
    resolveTaskResourceId: (
        taskId: string,
        payload: Record<string, unknown>,
        existingResourceId?: string,
    ) => string;
    upsertTaskState: (
        taskId: string,
        patch: Partial<TaskRuntimeState>,
    ) => TaskRuntimeState;
    appendTranscript: (taskId: string, role: 'user' | 'assistant' | 'system', content: string) => void;
    applyPolicyDecision: (input: {
        requestId: string;
        action: 'task_command' | 'forward_command' | 'approval_result';
        commandType?: string;
        taskId?: string;
        source: string;
        payload?: Record<string, unknown>;
        approved?: boolean;
    }) => {
        allowed: boolean;
        reason: string;
        ruleId: string;
    };
    emitCurrentInvalidPayload: (extra?: Record<string, unknown>) => void;
    emitCurrent: (responsePayload: Record<string, unknown>) => void;
    emitFor: (type: string, responsePayload: Record<string, unknown>) => void;
    emitHookEvent: (
        type: 'SessionStart' | 'TaskCreated' | 'RemoteSessionLinked' | 'ChannelEventInjected' | 'PermissionRequest' | 'PreToolUse' | 'PostToolUse' | 'PreCompact' | 'PostCompact' | 'TaskCompleted' | 'TaskFailed' | 'TaskRewound',
        event: {
            taskId?: string;
            runId?: string;
            traceId?: string;
            payload?: Record<string, unknown>;
        },
    ) => void;
    emitTaskStarted: (input: {
        taskId: string;
        title: string;
        message: string;
        workspacePath: string;
        mode: TaskStartedMode;
        scheduled?: boolean;
        turnId?: string;
    }) => void;
    emitTaskSummary: (input: {
        taskId: string;
        summary: string;
        finishReason: string;
        turnId?: string;
    }) => void;
    enqueueTaskExecution: (input: {
        taskId: string;
        turnId: string;
        run: () => Promise<TaskRuntimeExecutionPath>;
    }) => {
        queuePosition: number;
        completion: Promise<TaskRuntimeExecutionPath>;
    };
    executeTaskMessage: (input: {
        taskId: string;
        turnId: string;
        message: string;
        resourceId: string;
        preferredThreadId: string;
        workspacePath?: string;
        executionOptions?: UserMessageExecutionOptions;
    }) => Promise<TaskRuntimeExecutionPath>;
    isScheduledCancellationRequest: (text: string) => boolean;
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
};

function isStartOrSendCommandType(commandType: string): commandType is StartOrSendCommandType {
    return commandType === 'start_task' || commandType === 'send_task_message';
}

const EXPLICIT_SCHEDULE_PREFIX = /^(?:创建|新建)?定时任务[：:\s,，、-]*/u;
const HIGH_RISK_HOST_ACTION_PATTERN = /\b(shutdown|reboot|poweroff|halt)\b|关机|重启/u;
const SPACED_ABSOLUTE_TIME_PATTERN = /(?:今天|明天|后天)?\s*(?:凌晨|早上|上午|中午|下午|晚上)?\s*[零〇一二两兩三四五六七八九十\d]{1,3}\s+点/u;
const DATABASE_OPERATION_PATTERN = /(连接(?:到)?数据库|数据库.*(?:查询|执行)|\b(?:mysql|postgres(?:ql)?|sqlite|database)\b|(?:select|insert|update|delete)\s+.+\s+from)/iu;

function resolveTaskStartedMode(input: {
    forcedRouteMode?: UserMessageExecutionOptions['forcedRouteMode'];
    executionPath?: UserMessageExecutionOptions['executionPath'];
    scheduled?: boolean;
}): TaskStartedMode {
    if (input.scheduled) {
        return 'scheduled_task';
    }
    if (input.forcedRouteMode === 'chat') {
        return 'chat';
    }
    if (input.forcedRouteMode === 'task') {
        return 'immediate_task';
    }
    return input.executionPath === 'direct' ? 'chat' : 'immediate_task';
}

export async function handleStartOrSendTaskCommand(
    input: HandleStartOrSendTaskCommandInput,
): Promise<boolean> {
    if (!isStartOrSendCommandType(input.commandType)) {
        return false;
    }
    const { commandType, commandId, payload } = input;
    const turnId = commandId;
    const taskId = input.getString(payload.taskId) ?? '';
    const rawMessage = commandType === 'start_task'
        ? input.getString(payload.userQuery)
        : input.getString(payload.content);
    if (!taskId || !rawMessage) {
        input.emitCurrentInvalidPayload({ taskId });
        return true;
    }
    const previousState = input.taskStates.get(taskId);
    const routedMessage = parseRoutedInput(rawMessage);
    const message = routedMessage.cleanText.trim().length > 0
        ? routedMessage.cleanText
        : (
            routedMessage.forcedRouteMode
                ? (previousState?.lastUserMessage ?? '')
                : rawMessage
        );
    if (!message || message.trim().length === 0) {
        input.emitCurrentInvalidPayload({ taskId });
        return true;
    }
    const taskCommandGuard = await runGuardPipeline<undefined>([
        () => {
            const taskCommandDecision = input.applyPolicyDecision({
                requestId: commandId,
                action: 'task_command',
                commandType,
                taskId,
                source: 'entrypoint',
                payload,
            });
            if (!taskCommandDecision.allowed) {
                return failGuard(`policy_denied:${taskCommandDecision.reason}`, undefined);
            }
            return passGuard();
        },
    ]);
    if (!taskCommandGuard.ok) {
        input.emitCurrent({
            success: false,
            taskId,
            error: taskCommandGuard.error,
        });
        return true;
    }
    input.appendTranscript(taskId, 'user', message);
    const workspacePath = input.getString(input.toRecord(payload.context).workspacePath) ?? process.cwd();
    const commandConfig = input.toRecord(payload.config);
    const explicitEnabledSkills = input.pickStringArrayConfigValue(commandConfig, 'enabledSkills');
    const retryConfig = input.pickTaskRuntimeRetryConfig(commandConfig);
    const resolvedSkillPrompt = input.resolveSkillPrompt
        ? input.resolveSkillPrompt({
            message,
            workspacePath,
            explicitEnabledSkills,
        })
        : {
            prompt: undefined,
            enabledSkillIds: explicitEnabledSkills ?? [],
        };
    const resolvedExecutionPath = input.pickTaskExecutionPath(commandConfig) ?? input.toUserMessageExecutionPath(previousState?.executionPath);
    let executionOptions: UserMessageExecutionOptions = {
        enabledSkills: resolvedSkillPrompt.enabledSkillIds,
        skillPrompt: resolvedSkillPrompt.prompt,
        requireToolApproval: input.pickBooleanConfigValue(commandConfig, 'requireToolApproval'),
        autoResumeSuspendedTools: input.pickBooleanConfigValue(commandConfig, 'autoResumeSuspendedTools'),
        toolCallConcurrency: input.pickPositiveIntegerConfigValue(commandConfig, 'toolCallConcurrency', 1, 32),
        maxSteps: input.pickPositiveIntegerConfigValue(commandConfig, 'maxSteps', 1, 128),
        executionPath: resolvedExecutionPath,
        forcedRouteMode: routedMessage.forcedRouteMode ?? undefined,
        forcePostAssistantCompletion: (
            resolvedExecutionPath === 'direct'
            || routedMessage.forcedRouteMode === 'chat'
            || (
                routedMessage.forcedRouteMode === undefined
                && previousState?.executionPath === 'direct'
            )
        )
            ? true
            : undefined,
    };
    const resourceId = input.resolveTaskResourceId(taskId, payload, previousState?.resourceId);
    const nextRetryState: TaskRuntimeRetryState | undefined = retryConfig
        ? retryConfig
        : (previousState?.retry
            ? {
                ...previousState.retry,
                attempts: 0,
                lastRetryAt: undefined,
                lastError: undefined,
            }
            : undefined);

    if (
        commandType === 'send_task_message'
        && input.cancelScheduledTasksForSourceTask
        && input.isScheduledCancellationRequest(message)
    ) {
        const cancelled = await input.cancelScheduledTasksForSourceTask({
            sourceTaskId: taskId,
            userMessage: message,
        });
        input.upsertTaskState(taskId, {
            title: input.getString(payload.title) ?? previousState?.title ?? 'Task',
            workspacePath,
            status: 'idle',
            suspended: false,
            suspensionReason: undefined,
            lastUserMessage: message,
            enabledSkills: resolvedSkillPrompt.enabledSkillIds,
            resourceId,
            checkpoint: undefined,
            retry: nextRetryState,
        });
        input.emitFor('send_task_message_response', {
            success: true,
            taskId,
            accepted: true,
            queuePosition: 0,
            turnId,
        });
        const cancellationSummary = cancelled.cancelledCount > 0
            ? `已取消 ${cancelled.cancelledCount} 个定时任务。`
            : '没有可取消的定时任务。';
        input.emitTaskSummary({
            taskId,
            summary: cancellationSummary,
            finishReason: 'scheduled_cancel',
            turnId,
        });
        return true;
    }

    const hasExplicitSchedulePrefix = EXPLICIT_SCHEDULE_PREFIX.test(rawMessage);
    const isHighRiskHostAction = HIGH_RISK_HOST_ACTION_PATTERN.test(message);
    const hasSpacedAbsoluteTimeCue = SPACED_ABSOLUTE_TIME_PATTERN.test(message);
    const isDatabaseOperation = DATABASE_OPERATION_PATTERN.test(message);
    const skipImplicitSchedule =
        !routedMessage.usedEnvelope
        && !hasExplicitSchedulePrefix
        && isHighRiskHostAction
        && !hasSpacedAbsoluteTimeCue;
    if (skipImplicitSchedule) {
        executionOptions = {
            ...executionOptions,
            executionPath: 'direct',
            forcedRouteMode: 'task',
            forcePostAssistantCompletion: undefined,
        };
    }
    const shouldForceDatabaseTaskPath = isDatabaseOperation
        && routedMessage.forcedRouteMode !== 'chat';
    if (shouldForceDatabaseTaskPath) {
        executionOptions = {
            ...executionOptions,
            executionPath: 'direct',
            forcedRouteMode: 'task',
            forcePostAssistantCompletion: undefined,
        };
    }

    if (input.scheduleTaskIfNeeded && !skipImplicitSchedule) {
        const scheduleDecision = await input.scheduleTaskIfNeeded({
            sourceTaskId: taskId,
            title: input.getString(payload.title) ?? undefined,
            message,
            workspacePath,
            config: input.toRecord(payload.config),
        });
        if (scheduleDecision.error) {
            input.emitCurrent({
                success: false,
                taskId,
                error: scheduleDecision.error,
            });
            return true;
        }
        if (scheduleDecision.scheduled) {
            input.upsertTaskState(taskId, {
                title: input.getString(payload.title) ?? previousState?.title ?? 'Task',
                workspacePath,
                status: 'scheduled',
                suspended: false,
                suspensionReason: undefined,
                lastUserMessage: message,
                enabledSkills: resolvedSkillPrompt.enabledSkillIds,
                resourceId,
                checkpoint: undefined,
                retry: nextRetryState,
                executionPath: executionOptions.executionPath === 'direct' ? 'direct' : 'workflow',
            });
            if (commandType === 'start_task') {
                input.emitTaskStarted({
                    taskId,
                    title: input.getString(payload.title) ?? 'Task',
                    message,
                    workspacePath,
                    mode: resolveTaskStartedMode({
                        forcedRouteMode: executionOptions.forcedRouteMode,
                        executionPath: executionOptions.executionPath,
                        scheduled: true,
                    }),
                    scheduled: true,
                    turnId,
                });
            }
            input.emitCurrent({
                success: true,
                taskId,
                accepted: true,
                queuePosition: 0,
                turnId,
            });
            const summary = scheduleDecision.summary ?? '已安排定时任务。';
            input.emitTaskSummary({
                taskId,
                summary,
                finishReason: 'scheduled',
                turnId,
            });
            return true;
        }
    }

    const state = input.upsertTaskState(taskId, {
        title: input.getString(payload.title) ?? input.taskStates.get(taskId)?.title ?? 'Task',
        workspacePath,
        status: 'running',
        suspended: false,
        suspensionReason: undefined,
        lastUserMessage: message,
        enabledSkills: resolvedSkillPrompt.enabledSkillIds,
        resourceId,
        checkpoint: undefined,
        retry: nextRetryState,
        executionPath: executionOptions.executionPath === 'direct' ? 'direct' : 'workflow',
    });
    if (commandType === 'start_task') {
        input.emitHookEvent('SessionStart', {
            taskId,
            payload: {
                threadId: state.conversationThreadId,
                workspacePath: state.workspacePath,
                resourceId: state.resourceId,
            },
        });
        input.emitHookEvent('TaskCreated', {
            taskId,
            payload: {
                title: state.title,
                workspacePath: state.workspacePath,
                enabledSkills: state.enabledSkills ?? [],
            },
        });
        input.emitTaskStarted({
            taskId,
            title: input.getString(payload.title) ?? 'Task',
            message,
            workspacePath,
            mode: resolveTaskStartedMode({
                forcedRouteMode: executionOptions.forcedRouteMode,
                executionPath: executionOptions.executionPath,
            }),
            turnId,
        });
    }
    const queuedExecution = input.enqueueTaskExecution({
        taskId,
        turnId,
        run: () => input.executeTaskMessage({
            taskId,
            turnId,
            message,
            resourceId,
            preferredThreadId: state.conversationThreadId,
            workspacePath: state.workspacePath,
            executionOptions,
        }),
    });
    input.emitCurrent({
        success: true,
        taskId,
        accepted: true,
        queuePosition: queuedExecution.queuePosition,
        turnId,
    });
    const executionPath = await queuedExecution.completion;
    if (executionPath !== state.executionPath) {
        input.upsertTaskState(taskId, {
            executionPath,
        });
    }
    return true;
}
