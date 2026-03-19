/**
 * Core Voice Skill
 * 
 * Provides Text-to-Speech (TTS) capabilities to the system.
 * Part of the Unified Capability Model.
 */

import { ToolDefinition, ToolContext } from '../standard';
import {
    createVoiceInterface,
    type VoicePlaybackState,
} from '../../agent/jarvis/voiceInterface';
import type { StoredSkill } from '../../storage/skillStore';
import { globalToolRegistry } from '../registry';
import { invokeCustomTtsProvider } from './speechProviders';

// Singleton instance with lazy initialization
let voiceInterface = createVoiceInterface();
let initialized = false;
let voicePlaybackReporter: ((state: VoicePlaybackState) => void) | null = null;
let listEnabledSkills: (() => StoredSkill[]) | null = null;
let customPlaybackState: VoicePlaybackState | null = null;
let activeCustomStopToolName: string | null = null;
let activeCustomContext: ToolContext | null = null;

function currentPlaybackState(): VoicePlaybackState {
    return customPlaybackState ?? voiceInterface.getPlaybackState();
}

function emitPlaybackState(): void {
    voicePlaybackReporter?.(currentPlaybackState());
}

function buildPreviewText(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= 120) {
        return normalized;
    }
    return `${normalized.slice(0, 117)}...`;
}

async function ensureInitialized(): Promise<void> {
    if (!initialized) {
        await voiceInterface.initialize();
        voiceInterface.subscribeToPlaybackState((state) => {
            if (!customPlaybackState?.isSpeaking) {
                voicePlaybackReporter?.(state);
            }
        });
        initialized = true;
    }
}

export function configureVoiceProviders(input: { listEnabledSkills: () => StoredSkill[] }): void {
    listEnabledSkills = input.listEnabledSkills;
}

export function setVoicePlaybackReporter(reporter: ((state: VoicePlaybackState) => void) | null): void {
    voicePlaybackReporter = reporter;
    if (reporter) {
        reporter(currentPlaybackState());
    }
}

export async function speakText(
    text: string,
    context: ToolContext,
    source = 'tool',
): Promise<{ success: boolean; message?: string; text_spoken?: string; error?: string }> {
    await ensureInitialized();

    const enabledSkills = listEnabledSkills?.() ?? [];
    if (enabledSkills.length > 0) {
        customPlaybackState = {
            isSpeaking: true,
            canStop: false,
            previewText: buildPreviewText(text),
            fullTextLength: text.length,
            taskId: context.taskId,
            source,
            startedAt: new Date().toISOString(),
        };
        emitPlaybackState();

        const customResult = await invokeCustomTtsProvider(
            enabledSkills,
            (toolName) => globalToolRegistry.getTool(toolName),
            { text },
            context,
        );

        if (customResult.success && customResult.provider) {
            activeCustomStopToolName = customResult.provider.stopToolName ?? null;
            activeCustomContext = context;
            customPlaybackState = {
                ...customPlaybackState,
                isSpeaking: false,
                canStop: false,
                endedAt: new Date().toISOString(),
                reason: 'completed',
                source: `${source}:custom:${customResult.provider.id}`,
            };
            emitPlaybackState();
            return {
                success: true,
                message: `Speech synthesized successfully via ${customResult.provider.displayName}`,
                text_spoken: text,
            };
        }

        customPlaybackState = null;
        activeCustomStopToolName = null;
        activeCustomContext = null;
        emitPlaybackState();
    }

    const availability = voiceInterface.isAvailable();
    if (!availability.tts) {
        return {
            success: false,
            error: `TTS unavailable on platform: ${availability.platform}`,
        };
    }

    await voiceInterface.forcedSpeak(text, {
        taskId: context.taskId,
        source,
    });

    return {
        success: true,
        message: 'Speech synthesized successfully',
        text_spoken: text,
    };
}

export async function stopVoicePlayback(reason = 'user_requested'): Promise<boolean> {
    await ensureInitialized();

    if (customPlaybackState?.isSpeaking && activeCustomStopToolName) {
        const stopTool = globalToolRegistry.getTool(activeCustomStopToolName);
        if (stopTool) {
            await stopTool.handler({ reason }, activeCustomContext ?? {
                workspacePath: process.cwd(),
                taskId: 'voice-playback',
            });
            customPlaybackState = {
                ...customPlaybackState,
                isSpeaking: false,
                canStop: false,
                endedAt: new Date().toISOString(),
                reason,
            };
            emitPlaybackState();
            activeCustomStopToolName = null;
            activeCustomContext = null;
            return true;
        }
    }

    return voiceInterface.stopSpeaking(reason);
}

export function getVoicePlaybackState(): VoicePlaybackState {
    return currentPlaybackState();
}

export const voiceSpeakTool: ToolDefinition = {
    name: 'voice_speak',
    description: 'Speak text aloud using the system\'s Text-to-Speech (TTS) engine. CALL THIS TOOL when the user asks to speak, read aloud, add TTS, 说话, 朗读, 读出来, or any voice/speech request. Do NOT view source code — just call this tool directly.',
    effects: ['ui:notify'], // Correct effect type for UI/Audio notification
    input_schema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                description: 'The text to speak.',
            },
        },
        required: ['text'],
    },
    handler: async (args: { text: string }, context: ToolContext) => {
        try {
            return await speakText(args.text, context, 'tool');
        } catch (error) {
            console.error('[VoiceTool] Error speaking:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};
