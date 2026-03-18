import type { IpcCommand, IpcResponse } from '../protocol';

function respond(commandId: string, type: string, payload: Record<string, unknown>): IpcResponse {
    return {
        commandId,
        timestamp: new Date().toISOString(),
        type,
        payload,
    } as IpcResponse;
}

export type RuntimeCommandDeps = {
    emit: (message: Record<string, unknown>) => void;
    onBootstrapRuntimeContext: (runtimeContext: unknown) => void;
    executeFreshTask: (args: any) => Promise<unknown>;
    createTaskFailedEvent: (taskId: string, payload: {
        error: string;
        errorCode?: string;
        recoverable: boolean;
        suggestion?: string;
    }) => Record<string, unknown>;
    createChatMessageEvent: (taskId: string, payload: {
        role: 'assistant' | 'system' | 'user';
        content: string;
    }) => Record<string, unknown>;
    createTaskClarificationRequiredEvent: (taskId: string, payload: {
        reason?: string;
        questions: string[];
        missingFields?: string[];
    }) => Record<string, unknown>;
    createTaskStatusEvent: (taskId: string, payload: {
        status: 'running' | 'failed' | 'idle' | 'finished';
    }) => Record<string, unknown>;
    createTaskFinishedEvent: (taskId: string, payload: {
        summary: string;
        duration: number;
        artifactsCreated?: string[];
        filesModified?: string[];
    }) => Record<string, unknown>;
    taskSessionStore: {
        clearConversation: (taskId: string) => void;
        ensureHistoryLimit: (taskId: string) => void;
        setHistoryLimit: (taskId: string, limit: number) => void;
        setConfig: (taskId: string, config: any) => void;
        getConfig: (taskId: string) => any;
        getArtifactContract: (taskId: string) => unknown;
        setArtifactContract: (taskId: string, contract: any) => any;
    };
    taskEventBus: {
        emitRaw: (taskId: string, type: string, payload: unknown) => void;
        emitChatMessage: (taskId: string, payload: { role: 'assistant' | 'system' | 'user'; content: string }) => void;
        emitStatus: (taskId: string, payload: { status: 'running' | 'failed' | 'idle' | 'finished' }) => void;
        reset: (taskId: string) => void;
        emitStarted: (taskId: string, payload: { title: string; description?: string; context: { workspacePath?: string; userQuery: string } }) => void;
        emitFinished: (taskId: string, payload: { summary: string; duration: number }) => void;
    };
    suspendResumeManager: {
        isSuspended: (taskId: string) => boolean;
        resume: (taskId: string, reason: string) => Promise<{ success: boolean }>;
    };
    enqueueResumeMessage: (taskId: string, content: string, config?: Record<string, unknown>) => void;
    getTaskConfig: (taskId: string) => any;
    workspaceRoot: string;
    workRequestStore: any;
    prepareWorkRequestContext: (input: any) => any;
    buildArtifactContract: (query: string) => unknown;
    buildClarificationMessage: (frozenWorkRequest: any) => string;
    pushConversationMessage: (taskId: string, message: { role: 'user' | 'assistant'; content: string }) => any;
    shouldUsePlanningFiles: (frozenWorkRequest: any) => boolean;
    appendPlanningProgressEntry: (workspacePath: string, entry: string) => void;
    scheduleTaskInternal: (input: any) => any;
    buildScheduledConfirmationMessage: (record: any) => string;
    toScheduledTaskConfig: (config: unknown) => unknown;
    markWorkRequestExecutionStarted: (preparedWorkRequest: any) => void;
    continuePreparedAgentFlow: (input: any, deps: any) => Promise<unknown>;
    getExecutionRuntimeDeps: (taskId: string) => unknown;
    runPostEditHooks: (workspacePath: string, filePath: string, content: string | undefined) => unknown[];
    formatHookResults: (results: any) => string;
    loadLlmConfig: (workspaceRoot: string) => any;
    resolveProviderConfig: (llmConfig: any, options: any) => any;
    autonomousLlmAdapter: {
        setProviderConfig: (config: any) => void;
    };
    getAutonomousAgent: (taskId: string) => {
        startTask: (query: string, options: {
            autoSaveMemory: boolean;
            notifyOnComplete: boolean;
            runInBackground: boolean;
        }) => Promise<any>;
        getTask: (taskId: string) => any;
        pauseTask: (taskId: string) => boolean;
        resumeTask: (taskId: string, userInput?: Record<string, string>) => Promise<void>;
        cancelTask: (taskId: string) => boolean;
        getAllTasks: () => any[];
    };
    stopVoicePlayback: (reason?: string) => Promise<boolean>;
    getVoicePlaybackState: () => unknown;
};

export async function handleRuntimeCommand(command: IpcCommand, deps: RuntimeCommandDeps): Promise<boolean> {
    switch (command.type) {
        case 'bootstrap_runtime_context': {
            deps.onBootstrapRuntimeContext((command.payload as { runtimeContext: unknown }).runtimeContext);
            deps.emit(respond(command.id, 'bootstrap_runtime_context_response', {
                success: true,
            }));
            return true;
        }

        case 'start_task': {
            const payload = command.payload as any;
            deps.emit(respond(command.id, 'start_task_response', {
                success: true,
                taskId: payload.taskId,
            }));

            await deps.executeFreshTask({
                taskId: payload.taskId,
                title: payload.title,
                userQuery: payload.userQuery,
                workspacePath: payload.context.workspacePath,
                activeFile: payload.context.activeFile,
                config: payload.config,
                emitStartedEvent: true,
                allowAutonomousFallback: true,
            });
            return true;
        }

        case 'cancel_task': {
            const payload = command.payload as any;
            deps.emit(deps.createTaskFailedEvent(payload.taskId, {
                error: 'Task cancelled by user',
                errorCode: 'CANCELLED',
                recoverable: false,
                suggestion: payload.reason,
            }));
            deps.emit(respond(command.id, 'cancel_task_response', {
                success: true,
                taskId: payload.taskId,
            }));
            return true;
        }

        case 'clear_task_history': {
            const payload = command.payload as any;
            deps.taskSessionStore.clearConversation(payload.taskId);
            deps.taskSessionStore.ensureHistoryLimit(payload.taskId);
            deps.taskEventBus.emitRaw(payload.taskId, 'TASK_HISTORY_CLEARED', {
                reason: 'user_requested',
            });
            deps.emit(respond(command.id, 'clear_task_history_response', {
                success: true,
                taskId: payload.taskId,
            }));
            return true;
        }

        case 'send_task_message': {
            const payload = command.payload as any;
            const taskId = payload.taskId as string;
            const content = payload.content as string;

            if (deps.suspendResumeManager.isSuspended(taskId)) {
                deps.enqueueResumeMessage(taskId, content, payload.config);
                const resume = await deps.suspendResumeManager.resume(taskId, 'User provided follow-up input');
                deps.emit(respond(command.id, 'send_task_message_response', {
                    success: resume.success,
                    taskId,
                    error: resume.success ? undefined : 'resume_failed',
                }));
                return true;
            }

            deps.taskEventBus.emitChatMessage(taskId, {
                role: 'user',
                content,
            });
            deps.emit(respond(command.id, 'send_task_message_response', {
                success: true,
                taskId,
            }));
            deps.taskEventBus.emitStatus(taskId, { status: 'running' });

            const taskConfig = deps.getTaskConfig(taskId);
            let effectiveTaskConfig = taskConfig;
            if (payload.config) {
                if (typeof payload.config.maxHistoryMessages === 'number' && payload.config.maxHistoryMessages > 0) {
                    deps.taskSessionStore.setHistoryLimit(taskId, payload.config.maxHistoryMessages);
                }
                deps.taskSessionStore.setConfig(taskId, {
                    ...taskConfig,
                    ...payload.config,
                });
                effectiveTaskConfig = deps.getTaskConfig(taskId);
            }

            const workspacePath =
                (effectiveTaskConfig?.workspacePath as string | undefined) ||
                (taskConfig?.workspacePath as string | undefined) ||
                deps.workspaceRoot;
            const preparedWorkRequest = deps.prepareWorkRequestContext({
                sourceText: content,
                workspacePath,
                workRequestStore: deps.workRequestStore,
            });
            const {
                frozenWorkRequest,
                executionQuery,
                workRequestExecutionPrompt,
            } = preparedWorkRequest;

            const artifactContract =
                deps.taskSessionStore.getArtifactContract(taskId) ||
                deps.buildArtifactContract(executionQuery);
            deps.taskSessionStore.setArtifactContract(taskId, artifactContract);

            if (frozenWorkRequest.clarification.required) {
                const clarificationMessage = deps.buildClarificationMessage(frozenWorkRequest);
                deps.pushConversationMessage(taskId, { role: 'user', content });
                deps.pushConversationMessage(taskId, { role: 'assistant', content: clarificationMessage });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: clarificationMessage,
                }));
                deps.emit(deps.createTaskClarificationRequiredEvent(taskId, {
                    reason: frozenWorkRequest.clarification.reason,
                    questions: frozenWorkRequest.clarification.questions,
                    missingFields: frozenWorkRequest.clarification.missingFields,
                }));
                deps.emit(deps.createTaskStatusEvent(taskId, { status: 'idle' }));
                if (deps.shouldUsePlanningFiles(frozenWorkRequest)) {
                    deps.appendPlanningProgressEntry(
                        workspacePath,
                        `Clarification requested for work request ${frozenWorkRequest.id}: ${clarificationMessage}`
                    );
                }
                return true;
            }

            if (frozenWorkRequest.mode === 'scheduled_task' && frozenWorkRequest.schedule?.executeAt) {
                deps.pushConversationMessage(taskId, { role: 'user', content });
                const primaryTask = frozenWorkRequest.tasks[0];
                const record = deps.scheduleTaskInternal({
                    title: primaryTask?.title || executionQuery.trim().slice(0, 60) || 'Scheduled Task',
                    taskQuery: executionQuery,
                    executeAt: new Date(frozenWorkRequest.schedule.executeAt),
                    workspacePath,
                    speakResult: frozenWorkRequest.presentation.ttsEnabled,
                    sourceTaskId: taskId,
                    config: deps.toScheduledTaskConfig(effectiveTaskConfig),
                    workRequestId: frozenWorkRequest.id,
                    frozenWorkRequest,
                });
                const confirmation = deps.buildScheduledConfirmationMessage(record);
                deps.pushConversationMessage(taskId, { role: 'assistant', content: confirmation });
                deps.emit(deps.createChatMessageEvent(taskId, {
                    role: 'assistant',
                    content: confirmation,
                }));
                deps.emit(deps.createTaskFinishedEvent(taskId, {
                    summary: confirmation,
                    duration: 0,
                }));
                return true;
            }

            deps.markWorkRequestExecutionStarted(preparedWorkRequest);
            const explicitSkillIds =
                (effectiveTaskConfig?.enabledClaudeSkills as string[] | undefined) ??
                (effectiveTaskConfig?.enabledSkills as string[] | undefined) ??
                (payload.config?.enabledClaudeSkills as string[] | undefined) ??
                (payload.config?.enabledSkills as string[] | undefined);
            const conversation = deps.pushConversationMessage(taskId, { role: 'user', content });

            await deps.continuePreparedAgentFlow({
                taskId,
                userMessage: content,
                workspacePath,
                config: effectiveTaskConfig,
                preparedWorkRequest,
                workRequestExecutionPrompt,
                conversation,
                artifactContract,
                explicitSkillIds,
            }, deps.getExecutionRuntimeDeps(taskId));
            return true;
        }

        case 'request_effect': {
            const effectPayload = command.payload as any;
            if (effectPayload.tool === 'Edit' || effectPayload.tool === 'Write') {
                const filePath = effectPayload.parameters?.file_path || effectPayload.parameters?.path;
                const content = effectPayload.parameters?.new_string || effectPayload.parameters?.content;
                if (filePath) {
                    const taskId: string = (command as any).taskId || ((command.payload as any).taskId) || '';
                    const taskContext = deps.taskSessionStore.getConfig(taskId);
                    const workspacePath = (taskContext?.workspacePath as string | undefined) || process.cwd();
                    const hookResults = deps.runPostEditHooks(workspacePath, filePath, content);
                    if (hookResults.length > 0) {
                        deps.formatHookResults(hookResults);
                    }
                }
            }

            deps.emit(respond(command.id, 'request_effect_response', {
                response: {
                    approved: false,
                    requestId: command.id,
                } as any,
            }));
            return true;
        }

        case 'apply_patch':
        case 'read_file':
        case 'list_dir':
        case 'exec_shell':
        case 'capture_screen':
        case 'get_policy_config':
            console.error(`[STUB] Command type "${command.type}" should be forwarded to Rust Policy Gate`);
            return true;

        case 'start_autonomous_task': {
            const payload = command.payload as any;
            deps.taskEventBus.reset(payload.taskId);
            const llmConfig = deps.loadLlmConfig(deps.workspaceRoot);
            const providerConfig = deps.resolveProviderConfig(llmConfig, {});
            deps.autonomousLlmAdapter.setProviderConfig(providerConfig);
            const agent = deps.getAutonomousAgent(payload.taskId);

            deps.taskEventBus.emitStarted(payload.taskId, {
                title: 'Autonomous Task',
                description: payload.query,
                context: {
                    workspacePath: deps.workspaceRoot,
                    userQuery: payload.query,
                },
            });

            deps.emit(respond(command.id, 'start_autonomous_task_response', {
                success: true,
                taskId: payload.taskId,
                message: 'Autonomous task started',
            }));

            try {
                const task = await agent.startTask(payload.query, {
                    autoSaveMemory: payload.autoSaveMemory ?? true,
                    notifyOnComplete: true,
                    runInBackground: payload.runInBackground ?? false,
                });
                deps.taskEventBus.emitFinished(payload.taskId, {
                    summary: task.summary || 'Task completed',
                    duration: Date.now() - new Date(task.createdAt).getTime(),
                });
            } catch (error) {
                deps.emit(deps.createTaskFailedEvent(payload.taskId, {
                    error: error instanceof Error ? error.message : String(error),
                    errorCode: 'AUTONOMOUS_TASK_ERROR',
                    recoverable: false,
                }));
            }
            return true;
        }

        case 'get_autonomous_task_status': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            const task = agent.getTask(payload.taskId);
            deps.emit(respond(command.id, 'get_autonomous_task_status_response', {
                success: true,
                task: task ? {
                    id: task.id,
                    status: task.status,
                    subtaskCount: task.decomposedTasks.length,
                    completedSubtasks: task.decomposedTasks.filter((s: any) => s.status === 'completed').length,
                    summary: task.summary,
                    memoryExtracted: task.memoryExtracted,
                } : null,
            }));
            return true;
        }

        case 'get_voice_state': {
            deps.emit(respond(command.id, 'get_voice_state_response', {
                success: true,
                state: deps.getVoicePlaybackState(),
            }));
            return true;
        }

        case 'stop_voice': {
            const stopped = await deps.stopVoicePlayback('user_requested');
            deps.emit(respond(command.id, 'stop_voice_response', {
                success: true,
                stopped,
                state: deps.getVoicePlaybackState(),
            }));
            return true;
        }

        case 'pause_autonomous_task': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            const success = agent.pauseTask(payload.taskId);
            deps.emit(respond(command.id, 'pause_autonomous_task_response', {
                success,
                taskId: payload.taskId,
            }));
            return true;
        }

        case 'resume_autonomous_task': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            deps.emit(respond(command.id, 'resume_autonomous_task_response', {
                success: true,
                taskId: payload.taskId,
            }));
            agent.resumeTask(payload.taskId, payload.userInput).catch((error) => {
                deps.emit(deps.createTaskFailedEvent(payload.taskId, {
                    error: error instanceof Error ? error.message : String(error),
                    errorCode: 'AUTONOMOUS_RESUME_ERROR',
                    recoverable: false,
                }));
            });
            return true;
        }

        case 'cancel_autonomous_task': {
            const payload = command.payload as any;
            const agent = deps.getAutonomousAgent(payload.taskId);
            const success = agent.cancelTask(payload.taskId);
            deps.emit(respond(command.id, 'cancel_autonomous_task_response', {
                success,
                taskId: payload.taskId,
            }));
            if (success) {
                deps.emit(deps.createTaskFailedEvent(payload.taskId, {
                    error: 'Task cancelled by user',
                    errorCode: 'CANCELLED',
                    recoverable: false,
                }));
            }
            return true;
        }

        case 'list_autonomous_tasks': {
            const agent = deps.getAutonomousAgent('global');
            const tasks = agent.getAllTasks();
            deps.emit(respond(command.id, 'list_autonomous_tasks_response', {
                tasks: tasks.map((task) => ({
                    id: task.id,
                    query: task.originalQuery,
                    status: task.status,
                    subtaskCount: task.decomposedTasks.length,
                    completedSubtasks: task.decomposedTasks.filter((s: any) => s.status === 'completed').length,
                    createdAt: task.createdAt,
                    completedAt: task.completedAt,
                })),
            }));
            return true;
        }

        default:
            return false;
    }
}

export type RuntimeResponseDeps = {
    taskEventBus: {
        emitRaw: (taskId: string, type: string, payload: unknown) => void;
    };
};

export async function handleRuntimeResponse(response: IpcResponse, deps: RuntimeResponseDeps): Promise<boolean> {
    switch (response.type) {
        case 'request_effect_response': {
            const approved = (response.payload as any).response.approved;
            if (approved) {
                deps.taskEventBus.emitRaw('global', 'EFFECT_APPROVED', {
                    response: (response.payload as any).response,
                    approvedBy: 'policy',
                });
            } else {
                deps.taskEventBus.emitRaw('global', 'EFFECT_DENIED', {
                    response: (response.payload as any).response,
                    deniedBy: 'policy',
                });
            }
            return true;
        }
        case 'apply_patch_response': {
            const payload = response.payload as any;
            const success = payload.success;
            const eventType = success ? 'PATCH_APPLIED' : 'PATCH_REJECTED';
            const eventPayload = success
                ? {
                    patchId: payload.patchId,
                    filePath: payload.filePath ?? '',
                    hunksApplied: 0,
                    backupPath: payload.backupPath,
                }
                : {
                    patchId: payload.patchId,
                    reason: payload.error,
                };
            deps.taskEventBus.emitRaw('global', eventType, eventPayload);
            return true;
        }
        default:
            return false;
    }
}
