import type { RuntimeCommandDeps } from '../handlers';
import type { DesktopEvent as MastraDesktopEvent } from '../ipc/bridge';
import type { StoredSkill } from '../storage/skillStore';
import {
    handleApprovalResponse as handleMastraApprovalResponse,
    handleUserMessage as handleMastraUserMessage,
} from '../ipc/streaming';
import {
    getSpeechProviderStatus,
    invokeCustomAsrProvider,
} from '../tools/core/speechProviders';
import type { ToolDefinition } from '../tools/standard';

type VoiceProviderInput = {
    listEnabledSkills: () => StoredSkill[];
    getToolByName: (toolName: string) => ToolDefinition | undefined;
    workspaceRoot: string;
};

export function createVoiceProviderBindings(input: VoiceProviderInput): Pick<
    RuntimeCommandDeps,
    'getVoiceProviderStatus' | 'transcribeWithCustomAsr'
> {
    return {
        getVoiceProviderStatus: (providerMode) => getSpeechProviderStatus(
            input.listEnabledSkills(),
            (toolName) => input.getToolByName(toolName),
            providerMode,
        ),
        transcribeWithCustomAsr: (request) => invokeCustomAsrProvider(
            input.listEnabledSkills(),
            (toolName) => input.getToolByName(toolName),
            request,
            {
                workspacePath: input.workspaceRoot,
                taskId: 'voice-transcription',
            },
            request.providerMode,
        ),
    };
}

export function createMastraRuntimeBridge(input: {
    enabled: boolean;
}): RuntimeCommandDeps['mastraRuntime'] {
    if (!input.enabled) {
        return undefined;
    }

    return {
        enabled: true,
        sendMessage: async (request) => {
            return await handleMastraUserMessage(
                request.message,
                request.threadId,
                request.resourceId,
                (event: MastraDesktopEvent) => request.onEvent(event),
                {
                    requireToolApproval: request.requireToolApproval,
                    maxSteps: request.maxSteps,
                },
            );
        },
        approveToolCall: async (request) => {
            await handleMastraApprovalResponse(
                request.runId,
                request.toolCallId,
                request.approved,
                (event: MastraDesktopEvent) => request.onEvent(event),
            );
        },
        cancelTask: async () => ({ success: true }),
    };
}
