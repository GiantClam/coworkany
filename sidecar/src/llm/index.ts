/**
 * LLM Module
 *
 * Unified LLM routing with multi-provider support and automatic failover.
 */

// Types
export type {
    LlmProvider,
    LlmProviderConfig,
    RouterConfig,
    Message,
    MessageRole,
    ContentBlock,
    TextContent,
    ImageContent,
    ToolUseContent,
    ToolResultContent,
    ToolDefinition,
    ChatRequest,
    ChatResponse,
    StreamChunk,
    LlmProviderInterface,
    RouterEvent,
    RouterEventCallback,
} from './types';

export {
    LlmProviderSchema,
    LlmProviderConfigSchema,
    RouterConfigSchema,
    MessageRoleSchema,
} from './types';

// Router
export {
    LlmRouter,
    createRouter,
    createRouterFromEnv,
    getProvider,
    registerProvider,
} from './router';

// Providers
export {
    AnthropicProvider,
    OpenAIProvider,
    OpenRouterProvider,
    OllamaProvider,
} from './providers';
