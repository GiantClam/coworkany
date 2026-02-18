/**
 * Core Voice Skill
 * 
 * Provides Text-to-Speech (TTS) capabilities to the system.
 * Part of the Unified Capability Model.
 */

import { ToolDefinition, ToolContext } from '../standard';
import { createVoiceInterface } from '../../agent/jarvis/voiceInterface';

// Singleton instance with lazy initialization
let voiceInterface = createVoiceInterface();
let initialized = false;

async function ensureInitialized(): Promise<void> {
    if (!initialized) {
        await voiceInterface.initialize();
        initialized = true;
    }
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
    handler: async (args: { text: string }, _context: ToolContext) => {
        try {
            // Lazy initialize the voice interface on first use
            await ensureInitialized();

            const availability = voiceInterface.isAvailable();
            if (!availability.tts) {
                return {
                    success: false,
                    error: `TTS unavailable on platform: ${availability.platform}`,
                };
            }

            // Use forcedSpeak to bypass the enabled check — the user explicitly called this tool
            await voiceInterface.forcedSpeak(args.text);

            return {
                success: true,
                message: 'Speech synthesized successfully',
                text_spoken: args.text
            };
        } catch (error) {
            console.error('[VoiceTool] Error speaking:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    },
};
