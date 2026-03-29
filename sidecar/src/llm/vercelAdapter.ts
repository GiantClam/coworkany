import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { jsonSchema } from 'ai';
import { createTlsAwareFetch } from '../utils/tls';

export type LlmProvider =
    | 'anthropic'
    | 'openrouter'
    | 'openai'
    | 'aiberm'
    | 'nvidia'
    | 'siliconflow'
    | 'gemini'
    | 'qwen'
    | 'minimax'
    | 'kimi'
    | 'ollama'
    | 'custom';
export type LlmApiFormat = 'anthropic' | 'openai';

export type LlmProviderConfig = {
    provider: LlmProvider;
    apiFormat: LlmApiFormat;
    apiKey: string;
    baseUrl: string;
    modelId: string;
    allowInsecureTls?: boolean;
};

export type AnthropicMessage = {
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
};

export type ToolDefinitionLike = {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
};

export type EnterpriseGatewayConfig = {
    enabled?: boolean;
    url?: string;
    virtualKey?: string;
};

export function normalizeOpenAICompatibleBaseUrl(baseUrl: string): string {
    return baseUrl
        .replace(/\/chat\/completions\/?$/i, '')
        .replace(/\/responses\/?$/i, '');
}

export function createLanguageModel(
    config: LlmProviderConfig,
    gateway?: EnterpriseGatewayConfig
): any {
    const tlsAwareFetch = createTlsAwareFetch(config.allowInsecureTls);

    if (gateway?.enabled && gateway.url && gateway.virtualKey) {
        const normalizedGatewayUrl = normalizeOpenAICompatibleBaseUrl(gateway.url);
        const provider = createOpenAI({
            baseURL: normalizedGatewayUrl,
            apiKey: gateway.virtualKey,
            ...(tlsAwareFetch ? { fetch: tlsAwareFetch } : {}),
        });
        return provider.chat(config.modelId);
    }

    if (config.provider === 'anthropic') {
        const provider = createAnthropic({
            apiKey: config.apiKey,
            baseURL: config.baseUrl.includes('/messages')
                ? config.baseUrl.replace(/\/messages$/, '')
                : config.baseUrl,
            ...(tlsAwareFetch ? { fetch: tlsAwareFetch } : {}),
        });
        return provider(config.modelId);
    }

    const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(config.baseUrl);

    const provider = createOpenAI({
        apiKey: config.apiKey,
        baseURL: normalizedBaseUrl,
        ...(tlsAwareFetch ? { fetch: tlsAwareFetch } : {}),
    });
    return provider.chat(config.modelId);
}

export function convertMessagesToAi(messages: AnthropicMessage[]): Array<Record<string, unknown>> {
    const aiMessages: Array<Record<string, unknown>> = [];
    const toolNameById = new Map<string, string>();
    const toolResultIds = new Set<string>();

    for (const message of messages) {
        if (!Array.isArray(message.content) || message.role !== 'user') continue;
        for (const block of message.content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
                toolResultIds.add(String(block.tool_use_id));
            }
        }
    }

    for (const message of messages) {
        if (typeof message.content === 'string') {
            aiMessages.push({ role: message.role, content: message.content });
            continue;
        }

        const blocks = message.content;

        if (message.role === 'assistant') {
            const assistantContent: Array<Record<string, unknown>> = [];

            for (const block of blocks) {
                if (block.type === 'text' && typeof block.text === 'string') {
                    assistantContent.push({ type: 'text', text: block.text });
                }
                if (block.type === 'tool_use') {
                    const toolCallId = String(block.id ?? '');
                    if (!toolResultIds.has(toolCallId)) {
                        continue;
                    }
                    const toolName = String(block.name ?? '');
                    toolNameById.set(toolCallId, toolName);
                    assistantContent.push({
                        type: 'tool-call',
                        toolCallId: String(block.id ?? ''),
                        toolName: toolName,
                        input: (block.input as Record<string, unknown>) ?? {},
                    });
                }
            }

            if (assistantContent.length > 0) {
                aiMessages.push({
                    role: 'assistant',
                    content: assistantContent,
                });
            }
            continue;
        }

        const toolResults = blocks.filter((block) => block.type === 'tool_result');
        if (toolResults.length > 0) {
            const toolContent: Array<Record<string, unknown>> = [];
            for (const toolResult of toolResults) {
                const content = toolResult.content;
                const toolCallId = String(toolResult.tool_use_id ?? '');
                const toolName = toolNameById.get(toolCallId) ?? 'unknown_tool';
                toolContent.push({
                    type: 'tool-result',
                    toolCallId: String(toolResult.tool_use_id ?? ''),
                    toolName,
                    output: {
                        type: 'text',
                        value: typeof content === 'string' ? content : JSON.stringify(content),
                    },
                });
            }
            aiMessages.push({ role: 'tool', content: toolContent });
            continue;
        }

        const text = blocks
            .filter((block) => block.type === 'text')
            .map((block) => String(block.text ?? ''))
            .join('\n');

        aiMessages.push({ role: 'user', content: text });
    }

    return aiMessages;
}

export function convertToolDefinitionsToAiTools(
    tools: ToolDefinitionLike[]
): Record<string, Record<string, unknown>> {
    return Object.fromEntries(
        tools.map((toolDef) => [
            toolDef.name,
            {
                description: toolDef.description,
                inputSchema: jsonSchema(toolDef.input_schema as Parameters<typeof jsonSchema>[0]),
            },
        ])
    );
}

export function extractAssistantMessageFromAiResult(
    text: string,
    toolCalls: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>
): AnthropicMessage {
    const content: Array<Record<string, unknown>> = [];

    if (text.trim().length > 0) {
        content.push({ type: 'text', text });
    }

    for (const toolCall of toolCalls) {
        content.push({
            type: 'tool_use',
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            input: toolCall.input,
        });
    }

    if (content.length === 1 && content[0].type === 'text') {
        return { role: 'assistant', content: String(content[0].text ?? '') };
    }

    return { role: 'assistant', content };
}
