import { afterEach, describe, expect, test } from 'bun:test';
import { resolveMissingApiKeyForModel } from '../src/ipc/streaming';

const ORIGINAL_ENV = {
    COWORKANY_LLM_CONFIG_PROVIDER: process.env.COWORKANY_LLM_CONFIG_PROVIDER,
    COWORKANY_LLM_CUSTOM_API_FORMAT: process.env.COWORKANY_LLM_CUSTOM_API_FORMAT,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
};

afterEach(() => {
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
    if (typeof ORIGINAL_ENV.OPENAI_API_KEY === 'string') {
        process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
    } else {
        delete process.env.OPENAI_API_KEY;
    }
    if (typeof ORIGINAL_ENV.ANTHROPIC_API_KEY === 'string') {
        process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV.ANTHROPIC_API_KEY;
    } else {
        delete process.env.ANTHROPIC_API_KEY;
    }
    if (typeof ORIGINAL_ENV.GOOGLE_GENERATIVE_AI_API_KEY === 'string') {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = ORIGINAL_ENV.GOOGLE_GENERATIVE_AI_API_KEY;
    } else {
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    }
});

describe('resolveMissingApiKeyForModel', () => {
    test('uses OPENAI_API_KEY for aiberm profile even with routed provider model name', () => {
        process.env.COWORKANY_LLM_CONFIG_PROVIDER = 'aiberm';
        delete process.env.OPENAI_API_KEY;
        expect(resolveMissingApiKeyForModel('google/gemini-2.5-flash')).toBe('OPENAI_API_KEY');

        process.env.OPENAI_API_KEY = 'sk-aiberm';
        expect(resolveMissingApiKeyForModel('google/gemini-2.5-flash')).toBeNull();
    });

    test('uses ANTHROPIC_API_KEY for custom anthropic format', () => {
        process.env.COWORKANY_LLM_CONFIG_PROVIDER = 'custom';
        process.env.COWORKANY_LLM_CUSTOM_API_FORMAT = 'anthropic';
        delete process.env.ANTHROPIC_API_KEY;
        expect(resolveMissingApiKeyForModel('anthropic/claude-sonnet-4-5')).toBe('ANTHROPIC_API_KEY');

        process.env.ANTHROPIC_API_KEY = 'sk-ant';
        expect(resolveMissingApiKeyForModel('anthropic/claude-sonnet-4-5')).toBeNull();
    });

    test('falls back to model provider mapping when no profile provider is configured', () => {
        delete process.env.COWORKANY_LLM_CONFIG_PROVIDER;
        delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        expect(resolveMissingApiKeyForModel('google/gemini-2.5-flash')).toBe('GOOGLE_GENERATIVE_AI_API_KEY');
    });
});
