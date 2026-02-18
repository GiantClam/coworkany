/**
 * LLM Router
 *
 * Unified LLM routing with multi-provider support and automatic failover.
 * Inspired by LiteLLM's provider abstraction pattern.
 */

import type {
    LlmProviderConfig,
    RouterConfig,
    ChatRequest,
    ChatResponse,
    StreamChunk,
    LlmProviderInterface,
    RouterEvent,
    RouterEventCallback,
} from './types';

// Import providers (will be implemented separately)
import { AnthropicProvider } from './providers/anthropic';
import { OpenAIProvider } from './providers/openai';
import { OpenRouterProvider } from './providers/openrouter';
import { OllamaProvider } from './providers/ollama';

// ============================================================================
// Provider Registry
// ============================================================================

const providers: Record<string, LlmProviderInterface> = {
    anthropic: new AnthropicProvider(),
    openai: new OpenAIProvider(),
    openrouter: new OpenRouterProvider(),
    ollama: new OllamaProvider(),
    // azure: new AzureProvider(),
    // bedrock: new BedrockProvider(),
    // vertex: new VertexProvider(),
};

/**
 * Get a provider instance by name
 */
export function getProvider(name: string): LlmProviderInterface | undefined {
    return providers[name];
}

/**
 * Register a custom provider
 */
export function registerProvider(name: string, provider: LlmProviderInterface): void {
    providers[name] = provider;
}

// ============================================================================
// LLM Router Class
// ============================================================================

export class LlmRouter {
    private config: RouterConfig;
    private eventCallback?: RouterEventCallback;

    constructor(config: RouterConfig, onEvent?: RouterEventCallback) {
        this.config = config;
        this.eventCallback = onEvent;
    }

    /**
     * Emit a router event
     */
    private emit(event: RouterEvent): void {
        if (this.eventCallback) {
            this.eventCallback(event);
        }
    }

    /**
     * Get all providers to try (primary + fallbacks)
     */
    private getProviderChain(): LlmProviderConfig[] {
        return [this.config.primary, ...(this.config.fallbacks || [])];
    }

    /**
     * Execute a chat request with automatic failover
     */
    async chat(request: ChatRequest): Promise<ChatResponse> {
        const chain = this.getProviderChain();
        let lastError: Error | null = null;

        for (let i = 0; i < chain.length; i++) {
            const providerConfig = chain[i];
            const provider = getProvider(providerConfig.provider);

            if (!provider) {
                console.warn(`[LlmRouter] Unknown provider: ${providerConfig.provider}`);
                continue;
            }

            if (!provider.isConfigured()) {
                console.warn(`[LlmRouter] Provider not configured: ${providerConfig.provider}`);
                continue;
            }

            // Attempt with retries
            for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
                const startTime = Date.now();

                this.emit({
                    type: 'provider_attempt',
                    provider: providerConfig.provider,
                    modelId: providerConfig.modelId,
                });

                try {
                    const response = await provider.chat(
                        {
                            ...request,
                            maxTokens: request.maxTokens ?? this.config.maxTokens,
                        },
                        providerConfig
                    );

                    this.emit({
                        type: 'provider_success',
                        provider: providerConfig.provider,
                        modelId: providerConfig.modelId,
                        latencyMs: Date.now() - startTime,
                    });

                    return response;
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error(String(error));

                    this.emit({
                        type: 'provider_error',
                        provider: providerConfig.provider,
                        modelId: providerConfig.modelId,
                        error: lastError.message,
                        latencyMs: Date.now() - startTime,
                    });

                    // Check if error is retryable
                    if (!this.isRetryableError(lastError) || attempt === this.config.retryCount) {
                        break;
                    }

                    // Exponential backoff
                    const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
                    await this.sleep(delay);
                }
            }

            // If we're not on the last provider, emit fallback event
            if (i < chain.length - 1) {
                this.emit({
                    type: 'fallback',
                    provider: chain[i + 1].provider,
                    modelId: chain[i + 1].modelId,
                });
            }
        }

        throw lastError || new Error('All providers failed');
    }

    /**
     * Execute a streaming chat request with automatic failover
     */
    async *chatStream(request: ChatRequest): AsyncGenerator<StreamChunk, void, unknown> {
        const chain = this.getProviderChain();
        let lastError: Error | null = null;

        for (let i = 0; i < chain.length; i++) {
            const providerConfig = chain[i];
            const provider = getProvider(providerConfig.provider);

            if (!provider) {
                console.warn(`[LlmRouter] Unknown provider: ${providerConfig.provider}`);
                continue;
            }

            if (!provider.isConfigured()) {
                console.warn(`[LlmRouter] Provider not configured: ${providerConfig.provider}`);
                continue;
            }

            const startTime = Date.now();

            this.emit({
                type: 'provider_attempt',
                provider: providerConfig.provider,
                modelId: providerConfig.modelId,
            });

            try {
                const stream = provider.chatStream(
                    {
                        ...request,
                        maxTokens: request.maxTokens ?? this.config.maxTokens,
                    },
                    providerConfig
                );

                let hasYielded = false;

                for await (const chunk of stream) {
                    hasYielded = true;
                    yield chunk;

                    if (chunk.type === 'error') {
                        throw new Error(chunk.error);
                    }
                }

                if (hasYielded) {
                    this.emit({
                        type: 'provider_success',
                        provider: providerConfig.provider,
                        modelId: providerConfig.modelId,
                        latencyMs: Date.now() - startTime,
                    });
                    return;
                }
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));

                this.emit({
                    type: 'provider_error',
                    provider: providerConfig.provider,
                    modelId: providerConfig.modelId,
                    error: lastError.message,
                    latencyMs: Date.now() - startTime,
                });

                // If we're not on the last provider, emit fallback event
                if (i < chain.length - 1) {
                    this.emit({
                        type: 'fallback',
                        provider: chain[i + 1].provider,
                        modelId: chain[i + 1].modelId,
                    });
                }
            }
        }

        yield {
            type: 'error',
            error: lastError?.message || 'All providers failed',
        };
    }

    /**
     * Check if an error is retryable
     */
    private isRetryableError(error: Error): boolean {
        const message = error.message.toLowerCase();

        // Rate limiting
        if (message.includes('rate limit') || message.includes('429')) {
            return true;
        }

        // Temporary server errors
        if (message.includes('500') || message.includes('502') || message.includes('503')) {
            return true;
        }

        // Network errors
        if (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('econnrefused')
        ) {
            return true;
        }

        return false;
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /**
     * Update router configuration
     */
    updateConfig(config: Partial<RouterConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): RouterConfig {
        return { ...this.config };
    }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a router from a simple configuration
 */
export function createRouter(
    primary: LlmProviderConfig,
    options?: {
        fallbacks?: LlmProviderConfig[];
        retryCount?: number;
        timeout?: number;
        maxTokens?: number;
        onEvent?: RouterEventCallback;
    }
): LlmRouter {
    return new LlmRouter(
        {
            primary,
            fallbacks: options?.fallbacks,
            retryCount: options?.retryCount ?? 2,
            timeout: options?.timeout ?? 30000,
            maxTokens: options?.maxTokens,
        },
        options?.onEvent
    );
}

/**
 * Create a router from environment variables and config file
 */
export function createRouterFromEnv(configPath?: string): LlmRouter {
    // Try to load from config file
    let fileConfig: Record<string, unknown> = {};
    if (configPath) {
        try {
            const fs = require('fs');
            if (fs.existsSync(configPath)) {
                fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            }
        } catch (e) {
            console.warn(`[LlmRouter] Failed to load config from ${configPath}`);
        }
    }

    // Determine primary provider from env or config
    const provider =
        process.env.LLM_PROVIDER ||
        (fileConfig.provider as string) ||
        (fileConfig.router as any)?.primary?.provider ||
        'anthropic';

    // Build primary config
    const primary: LlmProviderConfig = {
        provider: provider as any,
        modelId:
            process.env.LLM_MODEL ||
            (fileConfig[provider] as any)?.model ||
            (fileConfig.router as any)?.primary?.modelId ||
            'claude-sonnet-4-5',
        apiKey:
            process.env[`${provider.toUpperCase()}_API_KEY`] ||
            (fileConfig[provider] as any)?.apiKey,
        baseUrl:
            process.env[`${provider.toUpperCase()}_BASE_URL`] ||
            (fileConfig[provider] as any)?.baseUrl,
    };

    // Build fallbacks from config
    const fallbacks: LlmProviderConfig[] = [];
    const configFallbacks = (fileConfig.router as any)?.fallbacks;
    if (Array.isArray(configFallbacks)) {
        for (const fb of configFallbacks) {
            fallbacks.push({
                provider: fb.provider,
                modelId: fb.modelId,
                apiKey: fb.apiKey || process.env[`${fb.provider.toUpperCase()}_API_KEY`],
                baseUrl: fb.baseUrl,
            });
        }
    }

    return createRouter(primary, {
        fallbacks: fallbacks.length > 0 ? fallbacks : undefined,
        retryCount: (fileConfig.router as any)?.retryCount ?? 2,
        timeout: (fileConfig.router as any)?.timeout ?? 30000,
        maxTokens: (fileConfig as any)?.maxTokens,
    });
}
