import type { StoredSkill } from '../storage/skillStore';
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
type VoiceProviderBindings = {
    getVoiceProviderStatus: (providerMode?: 'auto' | 'system' | 'custom') => ReturnType<typeof getSpeechProviderStatus>;
    transcribeWithCustomAsr: (request: {
        audioBase64: string;
        mimeType?: string;
        language?: string;
        providerMode?: 'auto' | 'system' | 'custom';
    }) => ReturnType<typeof invokeCustomAsrProvider>;
};
export function createVoiceProviderBindings(input: VoiceProviderInput): VoiceProviderBindings {
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
