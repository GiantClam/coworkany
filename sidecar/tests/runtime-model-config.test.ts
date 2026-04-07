import { afterEach, describe, expect, test } from 'bun:test';
import {
    resolveRuntimeModelConfig,
    shouldUseOpenAICompatibleChatModel,
} from '../src/mastra/model/runtimeModel';

const ORIGINAL_ENV = {
    COWORKANY_MODEL: process.env.COWORKANY_MODEL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    COWORKANY_LLM_CONFIG_PROVIDER: process.env.COWORKANY_LLM_CONFIG_PROVIDER,
    COWORKANY_LLM_CUSTOM_API_FORMAT: process.env.COWORKANY_LLM_CUSTOM_API_FORMAT,
};

afterEach(() => {
    if (typeof ORIGINAL_ENV.COWORKANY_MODEL === 'string') {
        process.env.COWORKANY_MODEL = ORIGINAL_ENV.COWORKANY_MODEL;
    } else {
        delete process.env.COWORKANY_MODEL;
    }
    if (typeof ORIGINAL_ENV.OPENAI_BASE_URL === 'string') {
        process.env.OPENAI_BASE_URL = ORIGINAL_ENV.OPENAI_BASE_URL;
    } else {
        delete process.env.OPENAI_BASE_URL;
    }
    if (typeof ORIGINAL_ENV.OPENAI_API_KEY === 'string') {
        process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
    } else {
        delete process.env.OPENAI_API_KEY;
    }
    if (typeof ORIGINAL_ENV.COWORKANY_LLM_CONFIG_PROVIDER === 'string') {
        process.env.COWORKANY_LLM_CONFIG_PROVIDER = ORIGINAL_ENV.COWORKANY_LLM_CONFIG_PROVIDER;
    } else {
        delete process.env.COWORKANY_LLM_CONFIG_PROVIDER;
    }
    if (typeof ORIGINAL_ENV.COWORKANY_LLM_CUSTOM_API_FORMAT === 'string') {
        process.env.COWORKANY_LLM_CUSTOM_API_FORMAT = ORIGINAL_ENV.COWORKANY_LLM_CUSTOM_API_FORMAT;
    } else {
        delete process.env.COWORKANY_LLM_CUSTOM_API_FORMAT;
    }
});

describe('runtime model resolver', () => {
    test('enables openai-compatible chat model for aiberm claude models', () => {
        expect(shouldUseOpenAICompatibleChatModel({
            modelId: 'aiberm/claude-sonnet-4-6',
            openAiBaseUrl: 'https://aiberm.com/v1',
            llmConfigProvider: 'aiberm',
        })).toBe(true);
    });

    test('enables openai-compatible chat model for non-claude aiberm models', () => {
        expect(shouldUseOpenAICompatibleChatModel({
            modelId: 'aiberm/gpt-5.3-codex',
            openAiBaseUrl: 'https://aiberm.com/v1',
            llmConfigProvider: 'aiberm',
        })).toBe(true);
    });

    test('enables openai-compatible chat model for aiberm-prefixed model without provider metadata', () => {
        expect(shouldUseOpenAICompatibleChatModel({
            modelId: 'aiberm/gpt-5.3-codex',
            openAiBaseUrl: 'https://aiberm.com/v1',
        })).toBe(true);
    });

    test('enables openai-compatible chat model for custom openai-format providers', () => {
        expect(shouldUseOpenAICompatibleChatModel({
            modelId: 'openai/gpt-5.3-codex',
            openAiBaseUrl: 'https://api.example.com/v1',
            llmConfigProvider: 'custom',
            llmCustomApiFormat: 'openai',
        })).toBe(true);
    });

    test('does not enable openai-compatible chat model for custom anthropic-format providers', () => {
        expect(shouldUseOpenAICompatibleChatModel({
            modelId: 'anthropic/claude-sonnet-4-5',
            openAiBaseUrl: 'https://api.example.com/v1',
            llmConfigProvider: 'custom',
            llmCustomApiFormat: 'anthropic',
        })).toBe(false);
    });

    test('returns openai-compatible config for aiberm claude runtime', () => {
        process.env.COWORKANY_MODEL = 'aiberm/claude-sonnet-4-6';
        process.env.OPENAI_BASE_URL = 'https://aiberm.com/v1';
        process.env.OPENAI_API_KEY = 'test-key';

        const resolved = resolveRuntimeModelConfig();
        expect(typeof resolved).toBe('object');
        expect(resolved).toEqual({
            id: 'aiberm/claude-sonnet-4-6',
            url: 'https://aiberm.com/v1',
            apiKey: 'test-key',
        });
    });

    test('returns openai-compatible config for aiberm gpt runtime', () => {
        process.env.COWORKANY_MODEL = 'aiberm/gpt-5.3-codex';
        process.env.OPENAI_BASE_URL = 'https://aiberm.com/v1';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.COWORKANY_LLM_CONFIG_PROVIDER = 'aiberm';

        const resolved = resolveRuntimeModelConfig();
        expect(typeof resolved).toBe('object');
        expect(resolved).toEqual({
            id: 'aiberm/gpt-5.3-codex',
            url: 'https://aiberm.com/v1',
            apiKey: 'test-key',
        });
    });

    test('returns openai-compatible config for custom provider runtime', () => {
        process.env.COWORKANY_MODEL = 'openai/gpt-5.3-codex';
        process.env.OPENAI_BASE_URL = 'https://api.example.com/v1';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.COWORKANY_LLM_CONFIG_PROVIDER = 'custom';
        process.env.COWORKANY_LLM_CUSTOM_API_FORMAT = 'openai';

        const resolved = resolveRuntimeModelConfig();
        expect(typeof resolved).toBe('object');
        expect(resolved).toEqual({
            id: 'openai/gpt-5.3-codex',
            url: 'https://api.example.com/v1',
            apiKey: 'test-key',
        });
    });

    test('keeps routed provider model names for openai-compatible providers', () => {
        process.env.COWORKANY_MODEL = 'aiberm/google/gemini-2.5-flash';
        process.env.OPENAI_BASE_URL = 'https://aiberm.com/v1';
        process.env.COWORKANY_LLM_CONFIG_PROVIDER = 'aiberm';

        const resolved = resolveRuntimeModelConfig();
        expect(typeof resolved).toBe('object');
        expect(resolved).toEqual({
            id: 'aiberm/google/gemini-2.5-flash',
            url: 'https://aiberm.com/v1',
        });
    });

    test('returns plain model id for custom anthropic-format runtime', () => {
        process.env.COWORKANY_MODEL = 'anthropic/claude-sonnet-4-5';
        process.env.OPENAI_BASE_URL = 'https://api.example.com/v1';
        process.env.OPENAI_API_KEY = 'test-key';
        process.env.COWORKANY_LLM_CONFIG_PROVIDER = 'custom';
        process.env.COWORKANY_LLM_CUSTOM_API_FORMAT = 'anthropic';

        const resolved = resolveRuntimeModelConfig();
        expect(resolved).toBe('anthropic/claude-sonnet-4-5');
    });
});
