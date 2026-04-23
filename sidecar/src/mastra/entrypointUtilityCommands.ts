type UtilityPayload = Record<string, unknown>;

type ReplayWorkflowRunInput = {
    workflowId: string;
    runId: string;
    steps: string[];
    taskId?: string;
    resourceId?: string;
    threadId?: string;
    workspacePath?: string;
    inputData?: unknown;
    resumeData?: unknown;
    perStep?: boolean;
};

type ReplayWorkflowRunResult = {
    success: boolean;
    workflowId: string;
    runId: string;
    status: string;
    steps: string[];
    traceId: string;
    sampled: boolean;
    result?: unknown;
    error?: unknown;
};

type UtilityDeps = {
    payload: UtilityPayload;
    commandType: string;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => UtilityPayload;
    emitFor: (type: string, responsePayload: UtilityPayload) => void;
    emitCurrent: (responsePayload: UtilityPayload) => void;
    emitCurrentInvalidPayload: (extra?: UtilityPayload) => void;
    stopVoicePlayback: (reason?: string) => Promise<boolean>;
    getVoicePlaybackState: () => unknown;
    getVoiceProviderStatus: (providerMode?: 'auto' | 'system' | 'custom') => unknown;
    transcribeWithCustomAsr: (input: {
        audioBase64: string;
        mimeType?: string;
        language?: string;
        providerMode?: 'auto' | 'system' | 'custom';
    }) => Promise<UtilityPayload>;
    replayWorkflowRunTimeTravel?: (input: ReplayWorkflowRunInput) => Promise<ReplayWorkflowRunResult>;
};

function parseVoiceProviderMode(value: unknown): 'auto' | 'system' | 'custom' | undefined {
    return value === 'auto' || value === 'system' || value === 'custom'
        ? value
        : undefined;
}

function buildUnsupportedAutonomousResponse(
    commandType: string,
    payload: UtilityPayload,
    getString: (value: unknown) => string | null,
): { type: string; payload: UtilityPayload } | null {
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

export async function handleEntrypointUtilityCommands(deps: UtilityDeps): Promise<boolean> {
    if (deps.commandType === 'get_voice_state') {
        deps.emitFor('get_voice_state_response', {
            success: true,
            state: deps.toRecord(deps.getVoicePlaybackState()),
        });
        return true;
    }
    if (deps.commandType === 'stop_voice') {
        const stopped = await deps.stopVoicePlayback('user_requested');
        deps.emitFor('stop_voice_response', {
            success: true,
            stopped,
            state: deps.toRecord(deps.getVoicePlaybackState()),
        });
        return true;
    }
    if (deps.commandType === 'get_voice_provider_status') {
        const effectiveProviderMode = parseVoiceProviderMode(deps.payload.providerMode);
        deps.emitFor('get_voice_provider_status_response', {
            success: true,
            ...deps.toRecord(deps.getVoiceProviderStatus(effectiveProviderMode)),
        });
        return true;
    }
    if (deps.commandType === 'transcribe_voice') {
        const audioBase64 = deps.getString(deps.payload.audioBase64) ?? '';
        if (!audioBase64) {
            deps.emitFor('transcribe_voice_response', {
                success: false,
                error: 'invalid_payload',
            });
            return true;
        }
        const effectiveProviderMode = parseVoiceProviderMode(deps.payload.providerMode);
        deps.emitFor('transcribe_voice_response', await deps.transcribeWithCustomAsr({
            audioBase64,
            mimeType: deps.getString(deps.payload.mimeType) ?? undefined,
            language: deps.getString(deps.payload.language) ?? undefined,
            providerMode: effectiveProviderMode,
        }));
        return true;
    }

    const unsupportedAutonomous = buildUnsupportedAutonomousResponse(
        deps.commandType,
        deps.payload,
        deps.getString,
    );
    if (unsupportedAutonomous) {
        deps.emitFor(unsupportedAutonomous.type, unsupportedAutonomous.payload);
        return true;
    }

    if (deps.commandType !== 'time_travel_workflow_run') {
        return false;
    }

    if (!deps.replayWorkflowRunTimeTravel) {
        deps.emitCurrent({
            success: false,
            error: 'unsupported_in_mastra_runtime',
        });
        return true;
    }

    const workflowId = deps.getString(deps.payload.workflowId) ?? deps.getString(deps.payload.workflow) ?? '';
    const runId = deps.getString(deps.payload.runId) ?? '';
    const steps = Array.isArray(deps.payload.steps)
        ? deps.payload.steps.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];
    const singleStep = deps.getString(deps.payload.step);
    const replaySteps = steps.length > 0
        ? steps
        : (singleStep ? [singleStep] : []);
    if (!workflowId || !runId || replaySteps.length === 0) {
        deps.emitCurrentInvalidPayload({
            workflowId,
            runId,
        });
        return true;
    }
    try {
        const replay = await deps.replayWorkflowRunTimeTravel({
            workflowId,
            runId,
            steps: replaySteps,
            taskId: deps.getString(deps.payload.taskId) ?? undefined,
            resourceId: deps.getString(deps.payload.resourceId) ?? undefined,
            threadId: deps.getString(deps.payload.threadId) ?? undefined,
            workspacePath: deps.getString(deps.payload.workspacePath)
                ?? deps.getString(deps.toRecord(deps.payload.context).workspacePath)
                ?? undefined,
            inputData: Object.prototype.hasOwnProperty.call(deps.payload, 'inputData') ? deps.payload.inputData : undefined,
            resumeData: Object.prototype.hasOwnProperty.call(deps.payload, 'resumeData') ? deps.payload.resumeData : undefined,
            perStep: typeof deps.payload.perStep === 'boolean' ? deps.payload.perStep : undefined,
        });
        deps.emitCurrent({
            success: replay.success,
            workflowId: replay.workflowId,
            runId: replay.runId,
            status: replay.status,
            steps: replay.steps,
            traceId: replay.traceId,
            sampled: replay.sampled,
            result: replay.result ?? null,
            error: replay.error ?? null,
        });
    } catch (error) {
        deps.emitCurrent({
            success: false,
            workflowId,
            runId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    return true;
}
