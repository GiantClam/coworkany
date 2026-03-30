import type { StoredSkill } from '../../storage/skillStore';
import type { ToolContext, ToolDefinition } from '../standard';
export type SpeechProviderKind = 'asr' | 'tts';
export type VoiceProviderMode = 'auto' | 'system' | 'custom';
export type SpeechProviderRegistration = {
    id: string;
    kind: SpeechProviderKind;
    toolName: string;
    stopToolName?: string;
    priority: number;
    sourceSkill: string;
    displayName: string;
};
type MetadataNode = Record<string, unknown>;
type SpeechProviderConfig = {
    id?: string;
    tool?: string;
    stopTool?: string;
    priority?: number;
    displayName?: string;
};
function asRecord(value: unknown): MetadataNode | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as MetadataNode
        : null;
}
function readString(record: MetadataNode, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
}
function readNumber(record: MetadataNode, ...keys: string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return undefined;
}
function parseProviderConfig(skill: StoredSkill, kind: SpeechProviderKind): SpeechProviderConfig | null {
    const metadata = asRecord(skill.manifest.metadata);
    const voice = asRecord(metadata?.voice ?? metadata?.speech);
    const config = asRecord(voice?.[kind]);
    if (!config) {
        return null;
    }
    return {
        id: readString(config, 'id'),
        tool: readString(config, 'tool', 'toolName'),
        stopTool: readString(config, 'stopTool', 'stop_tool', 'stopToolName'),
        priority: readNumber(config, 'priority'),
        displayName: readString(config, 'displayName', 'name'),
    };
}
export function listSpeechProviders(
    skills: StoredSkill[],
    kind: SpeechProviderKind,
    getTool: (toolName: string) => ToolDefinition | undefined,
): SpeechProviderRegistration[] {
    return skills
        .filter((skill) => skill.enabled)
        .flatMap((skill) => {
            const config = parseProviderConfig(skill, kind);
            if (!config?.tool || !getTool(config.tool)) {
                return [];
            }
            return [{
                id: config.id || `${skill.manifest.name}:${kind}`,
                kind,
                toolName: config.tool,
                stopToolName: config.stopTool,
                priority: config.priority ?? 100,
                sourceSkill: skill.manifest.name,
                displayName: config.displayName || skill.manifest.name,
            }];
        })
        .sort((left, right) => {
            if (right.priority !== left.priority) {
                return right.priority - left.priority;
            }
            return left.sourceSkill.localeCompare(right.sourceSkill);
        });
}
export function getPreferredSpeechProvider(
    skills: StoredSkill[],
    kind: SpeechProviderKind,
    getTool: (toolName: string) => ToolDefinition | undefined,
    mode: VoiceProviderMode = 'auto',
): SpeechProviderRegistration | null {
    if (mode === 'system') {
        return null;
    }
    return listSpeechProviders(skills, kind, getTool)[0] ?? null;
}
export function getSpeechProviderStatus(
    skills: StoredSkill[],
    getTool: (toolName: string) => ToolDefinition | undefined,
    mode: VoiceProviderMode = 'auto',
): {
    preferredAsr: 'custom' | 'system';
    preferredTts: 'custom' | 'system';
    hasCustomAsr: boolean;
    hasCustomTts: boolean;
    providers: {
        asr: SpeechProviderRegistration[];
        tts: SpeechProviderRegistration[];
    };
} {
    const asr = listSpeechProviders(skills, 'asr', getTool);
    const tts = listSpeechProviders(skills, 'tts', getTool);
    const customAllowed = mode !== 'system';
    return {
        preferredAsr: customAllowed && asr.length > 0 ? 'custom' : 'system',
        preferredTts: customAllowed && tts.length > 0 ? 'custom' : 'system',
        hasCustomAsr: asr.length > 0,
        hasCustomTts: tts.length > 0,
        providers: { asr, tts },
    };
}
export async function invokeCustomAsrProvider(
    skills: StoredSkill[],
    getTool: (toolName: string) => ToolDefinition | undefined,
    input: {
        audioBase64: string;
        mimeType?: string;
        language?: string;
    },
    context: ToolContext,
    mode: VoiceProviderMode = 'auto',
): Promise<{ success: boolean; text?: string; providerId?: string; providerName?: string; error?: string }> {
    const provider = getPreferredSpeechProvider(skills, 'asr', getTool, mode);
    if (!provider) {
        return {
            success: false,
            error: 'transcription_unavailable',
        };
    }
    const tool = getTool(provider.toolName);
    if (!tool) {
        return {
            success: false,
            error: 'transcription_unavailable',
        };
    }
    const result = await tool.handler({
        audio_base64: input.audioBase64,
        mime_type: input.mimeType,
        language: input.language,
    }, context);
    if (result?.success === false) {
        return {
            success: false,
            error: typeof result.error === 'string' ? result.error : 'transcription_failed',
            providerId: provider.id,
            providerName: provider.displayName,
        };
    }
    const text = typeof result?.text === 'string'
        ? result.text.trim()
        : typeof result?.transcript === 'string'
            ? result.transcript.trim()
            : '';
    if (!text) {
        return {
            success: false,
            error: 'no_speech',
            providerId: provider.id,
            providerName: provider.displayName,
        };
    }
    return {
        success: true,
        text,
        providerId: provider.id,
        providerName: provider.displayName,
    };
}
export async function invokeCustomTtsProvider(
    skills: StoredSkill[],
    getTool: (toolName: string) => ToolDefinition | undefined,
    input: {
        text: string;
        language?: string;
        voice?: string;
        rate?: number;
    },
    context: ToolContext,
    mode: VoiceProviderMode = 'auto',
): Promise<{ success: boolean; provider?: SpeechProviderRegistration; error?: string }> {
    const provider = getPreferredSpeechProvider(skills, 'tts', getTool, mode);
    if (!provider) {
        return { success: false };
    }
    const tool = getTool(provider.toolName);
    if (!tool) {
        return {
            success: false,
            error: 'tts_unavailable',
        };
    }
    const result = await tool.handler({
        text: input.text,
        language: input.language,
        voice: input.voice,
        rate: input.rate,
    }, context);
    if (result?.success === false) {
        return {
            success: false,
            provider,
            error: typeof result.error === 'string' ? result.error : 'tts_failed',
        };
    }
    return {
        success: true,
        provider,
    };
}
