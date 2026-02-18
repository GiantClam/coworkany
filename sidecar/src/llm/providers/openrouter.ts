/**
 * OpenRouter Provider
 *
 * OpenRouter API integration for the LLM Router
 * OpenRouter uses OpenAI-compatible format but routes to multiple providers
 */

import type {
    LlmProviderConfig,
    ChatRequest,
    ChatResponse,
    StreamChunk,
    LlmProviderInterface,
} from '../types';
import { OpenAIProvider } from './openai';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenRouter provider extends OpenAI provider since it uses the same format
 */
export class OpenRouterProvider implements LlmProviderInterface {
    name = 'openrouter';
    private openaiProvider = new OpenAIProvider();

    isConfigured(): boolean {
        return !!process.env.OPENROUTER_API_KEY;
    }

    async chat(request: ChatRequest, config: LlmProviderConfig): Promise<ChatResponse> {
        const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        // Use OpenAI provider with OpenRouter-specific config
        const openRouterConfig: LlmProviderConfig = {
            ...config,
            apiKey,
            baseUrl: config.baseUrl || OPENROUTER_API_URL,
            headers: {
                ...config.headers,
                'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'https://coworkany.app',
                'X-Title': process.env.OPENROUTER_TITLE || 'Coworkany AI Assistant',
            },
        };

        return this.openaiProvider.chat(request, openRouterConfig);
    }

    async *chatStream(
        request: ChatRequest,
        config: LlmProviderConfig
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = config.apiKey || process.env.OPENROUTER_API_KEY;

        if (!apiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        // Use OpenAI provider with OpenRouter-specific config
        const openRouterConfig: LlmProviderConfig = {
            ...config,
            apiKey,
            baseUrl: config.baseUrl || OPENROUTER_API_URL,
            headers: {
                ...config.headers,
                'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'https://coworkany.app',
                'X-Title': process.env.OPENROUTER_TITLE || 'Coworkany AI Assistant',
            },
        };

        yield* this.openaiProvider.chatStream(request, openRouterConfig);
    }
}
