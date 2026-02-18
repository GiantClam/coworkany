/**
 * LLM Router Types
 *
 * Unified types for multi-provider LLM routing (LiteLLM-inspired)
 */

import { z } from 'zod';

// ============================================================================
// Provider Configuration
// ============================================================================

export const LlmProviderSchema = z.enum([
    'anthropic',
    'openai',
    'azure',
    'openrouter',
    'ollama',
    'bedrock',
    'vertex',
    'custom',
]);

export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmProviderConfigSchema = z.object({
    /** Provider identifier */
    provider: LlmProviderSchema,
    /** API key (can also be set via env vars) */
    apiKey: z.string().optional(),
    /** Base URL for API requests */
    baseUrl: z.string().url().optional(),
    /** Model identifier (provider-specific) */
    modelId: z.string(),
    /** Optional organization ID (OpenAI, Azure) */
    organization: z.string().optional(),
    /** API format for custom providers */
    apiFormat: z.enum(['openai', 'anthropic']).optional(),
    /** Request timeout in milliseconds */
    timeout: z.number().positive().optional(),
    /** Additional headers for requests */
    headers: z.record(z.string()).optional(),
});

export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;

// ============================================================================
// Router Configuration
// ============================================================================

export const RouterConfigSchema = z.object({
    /** Primary provider to use */
    primary: LlmProviderConfigSchema,
    /** Fallback providers (tried in order if primary fails) */
    fallbacks: z.array(LlmProviderConfigSchema).optional(),
    /** Number of retry attempts before failing over */
    retryCount: z.number().min(0).max(5).default(2),
    /** Timeout for individual requests (ms) */
    timeout: z.number().positive().default(30000),
    /** Maximum tokens for responses */
    maxTokens: z.number().positive().optional(),
});

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

// ============================================================================
// Message Types (Unified across providers)
// ============================================================================

export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export interface TextContent {
    type: 'text';
    text: string;
}

export interface ImageContent {
    type: 'image';
    source: {
        type: 'base64' | 'url';
        mediaType?: string;
        data?: string;
        url?: string;
    };
}

export interface ToolUseContent {
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
}

export interface ToolResultContent {
    type: 'tool_result';
    tool_use_id: string;
    content: string | Array<TextContent | ImageContent>;
    is_error?: boolean;
}

export type ContentBlock = TextContent | ImageContent | ToolUseContent | ToolResultContent;

export interface Message {
    role: MessageRole;
    content: string | ContentBlock[];
    name?: string; // For tool results
}

// ============================================================================
// Tool Definitions
// ============================================================================

export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, unknown>;
        required?: string[];
    };
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface StreamChunk {
    type: 'text' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'error' | 'done';
    text?: string;
    toolUse?: {
        id: string;
        name: string;
        input?: string; // Partial JSON
    };
    error?: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface ChatRequest {
    messages: Message[];
    systemPrompt?: string;
    tools?: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    stopSequences?: string[];
    stream?: boolean;
}

export interface ChatResponse {
    id: string;
    model: string;
    content: ContentBlock[];
    stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
}

// ============================================================================
// Provider Interface
// ============================================================================

export interface LlmProviderInterface {
    /** Provider name for logging */
    name: string;

    /** Check if provider is configured correctly */
    isConfigured(): boolean;

    /** Send a chat request (non-streaming) */
    chat(request: ChatRequest, config: LlmProviderConfig): Promise<ChatResponse>;

    /** Send a streaming chat request */
    chatStream(
        request: ChatRequest,
        config: LlmProviderConfig
    ): AsyncGenerator<StreamChunk, void, unknown>;
}

// ============================================================================
// Router Events
// ============================================================================

export interface RouterEvent {
    type: 'provider_attempt' | 'provider_success' | 'provider_error' | 'fallback';
    provider: string;
    modelId: string;
    error?: string;
    latencyMs?: number;
}

export type RouterEventCallback = (event: RouterEvent) => void;
