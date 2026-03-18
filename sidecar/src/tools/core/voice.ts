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

// Singleton instance with lazy initialization
let voiceInterface = createVoiceInterface();
let initialized = false;
let voicePlaybackReporter: ((state: VoicePlaybackState) => void) | null = null;

async function ensureInitialized(): Promise<void> {
    if (!initialized) {
        await voiceInterface.initialize();
        voiceInterface.subscribeToPlaybackState((state) => {
            voicePlaybackReporter?.(state);
        });
        initialized = true;
    }
}

export function setVoicePlaybackReporter(reporter: ((state: VoicePlaybackState) => void) | null): void {
    voicePlaybackReporter = reporter;
    if (reporter) {
        reporter(voiceInterface.getPlaybackState());
    }
}

export async function speakText(
    text: string,
    context: ToolContext,
    source = 'tool',
): Promise<{ success: boolean; message?: string; text_spoken?: string; error?: string }> {
    await ensureInitialized();

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
    return voiceInterface.stopSpeaking(reason);
}

export function getVoicePlaybackState(): VoicePlaybackState {
    return voiceInterface.getPlaybackState();
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
