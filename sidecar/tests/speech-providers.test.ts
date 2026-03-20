import { describe, expect, test } from 'bun:test';
import {
    getPreferredSpeechProvider,
    getSpeechProviderStatus,
    invokeCustomAsrProvider,
} from '../src/tools/core/speechProviders';
import type { StoredSkill } from '../src/storage/skillStore';
import type { ToolDefinition } from '../src/tools/standard';

function makeSkill(name: string, metadata: Record<string, unknown>): StoredSkill {
    return {
        enabled: true,
        installedAt: new Date().toISOString(),
        manifest: {
            name,
            version: '1.0.0',
            description: name,
            directory: `/tmp/${name}`,
            metadata,
        },
    };
}

function makeTool(name: string, handler?: ToolDefinition['handler']): ToolDefinition {
    return {
        name,
        description: name,
        effects: [],
        input_schema: { type: 'object', properties: {} },
        handler: handler ?? (async () => ({ success: true })),
    };
}

describe('speechProviders', () => {
    test('prefers the highest-priority custom ASR provider', () => {
        const skills = [
            makeSkill('alpha-speech', { voice: { asr: { tool: 'alpha_asr', priority: 50 } } }),
            makeSkill('beta-speech', { voice: { asr: { tool: 'beta_asr', priority: 200 } } }),
        ];
        const tools = new Map([
            ['alpha_asr', makeTool('alpha_asr')],
            ['beta_asr', makeTool('beta_asr')],
        ]);

        const provider = getPreferredSpeechProvider(skills, 'asr', (toolName) => tools.get(toolName));
        expect(provider?.toolName).toBe('beta_asr');
        expect(provider?.sourceSkill).toBe('beta-speech');
    });

    test('only reports a custom provider when the backing tool exists', () => {
        const skills = [
            makeSkill('custom-voice', { voice: { asr: { tool: 'missing_asr' }, tts: { tool: 'custom_tts' } } }),
        ];
        const tools = new Map([
            ['custom_tts', makeTool('custom_tts')],
        ]);

        const status = getSpeechProviderStatus(skills, (toolName) => tools.get(toolName));
        expect(status.preferredAsr).toBe('system');
        expect(status.preferredTts).toBe('custom');
        expect(status.hasCustomAsr).toBe(false);
        expect(status.hasCustomTts).toBe(true);
    });

    test('system mode suppresses custom provider preference without hiding availability', () => {
        const skills = [
            makeSkill('custom-voice', { voice: { asr: { tool: 'custom_asr' }, tts: { tool: 'custom_tts' } } }),
        ];
        const tools = new Map([
            ['custom_asr', makeTool('custom_asr')],
            ['custom_tts', makeTool('custom_tts')],
        ]);

        const status = getSpeechProviderStatus(
            skills,
            (toolName) => tools.get(toolName),
            'system',
        );

        expect(status.preferredAsr).toBe('system');
        expect(status.preferredTts).toBe('system');
        expect(status.hasCustomAsr).toBe(true);
        expect(status.hasCustomTts).toBe(true);
    });

    test('invokes the preferred ASR tool with normalized audio payload', async () => {
        const skills = [
            makeSkill('custom-asr', { voice: { asr: { tool: 'custom_asr' } } }),
        ];
        const tools = new Map([
            ['custom_asr', makeTool('custom_asr', async (args) => ({
                success: true,
                text: `${args.language}:${args.mime_type}:${args.audio_base64.slice(0, 4)}`,
            }))],
        ]);

        const result = await invokeCustomAsrProvider(
            skills,
            (toolName) => tools.get(toolName),
            {
                audioBase64: 'YWJjZA==',
                mimeType: 'audio/webm',
                language: 'zh-CN',
            },
            {
                workspacePath: '/tmp/project',
                taskId: 'voice-test',
            },
        );

        expect(result.success).toBe(true);
        expect(result.text).toBe('zh-CN:audio/webm:YWJj');
        expect(result.providerName).toBe('custom-asr');
    });

    test('system mode skips custom ASR invocation', async () => {
        const skills = [
            makeSkill('custom-asr', { voice: { asr: { tool: 'custom_asr' } } }),
        ];
        const tools = new Map([
            ['custom_asr', makeTool('custom_asr')],
        ]);

        const result = await invokeCustomAsrProvider(
            skills,
            (toolName) => tools.get(toolName),
            {
                audioBase64: 'YWJjZA==',
                mimeType: 'audio/webm',
                language: 'en-US',
            },
            {
                workspacePath: '/tmp/project',
                taskId: 'voice-test',
            },
            'system',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('transcription_unavailable');
    });
});
