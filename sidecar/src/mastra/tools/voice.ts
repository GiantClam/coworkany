import { createTool } from '@mastra/core/tools';
import { z } from 'zod/v4';
import { speakText } from '../../tools/core/voice';

export const voiceSpeakTool = createTool({
    id: 'voice_speak',
    description: 'Speak text aloud using CoworkAny TTS capability.',
    inputSchema: z.object({
        text: z.string().min(1),
    }),
    outputSchema: z.object({
        success: z.boolean(),
        message: z.string().optional(),
        text_spoken: z.string().optional(),
        error: z.string().optional(),
    }),
    execute: async ({ text }) => {
        return await speakText(text, {
            workspacePath: process.cwd(),
            taskId: `voice-speak-${Date.now()}`,
        }, 'mastra_tool');
    },
});

