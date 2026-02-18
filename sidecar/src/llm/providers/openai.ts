/**
 * OpenAI Provider
 *
 * OpenAI/Azure API integration for the LLM Router
 */

import type {
    LlmProviderConfig,
    ChatRequest,
    ChatResponse,
    StreamChunk,
    LlmProviderInterface,
    ContentBlock,
    Message,
} from '../types';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Convert unified messages to OpenAI format
 */
function toOpenAIMessages(messages: Message[], systemPrompt?: string): any[] {
    const result: any[] = [];

    // Add system message if provided
    if (systemPrompt) {
        result.push({
            role: 'system',
            content: systemPrompt,
        });
    }

    for (const m of messages) {
        if (m.role === 'system') continue; // Already handled

        if (typeof m.content === 'string') {
            result.push({
                role: m.role === 'tool' ? 'tool' : m.role,
                content: m.content,
                ...(m.name && { name: m.name }),
            });
            continue;
        }

        // Handle content blocks
        const hasToolResult = m.content.some((b) => b.type === 'tool_result');
        if (hasToolResult) {
            // Tool results need to be separate messages
            for (const block of m.content) {
                if (block.type === 'tool_result') {
                    result.push({
                        role: 'tool',
                        tool_call_id: block.tool_use_id,
                        content:
                            typeof block.content === 'string'
                                ? block.content
                                : JSON.stringify(block.content),
                    });
                }
            }
            continue;
        }

        const hasToolUse = m.content.some((b) => b.type === 'tool_use');
        if (hasToolUse) {
            // Assistant messages with tool calls
            const textContent = m.content
                .filter((b) => b.type === 'text')
                .map((b) => (b as any).text)
                .join('');

            const toolCalls = m.content
                .filter((b) => b.type === 'tool_use')
                .map((b) => ({
                    id: (b as any).id,
                    type: 'function',
                    function: {
                        name: (b as any).name,
                        arguments: JSON.stringify((b as any).input),
                    },
                }));

            result.push({
                role: 'assistant',
                content: textContent || null,
                tool_calls: toolCalls,
            });
            continue;
        }

        // Regular message with mixed content
        const content = m.content.map((block) => {
            if (block.type === 'text') {
                return { type: 'text', text: block.text };
            }
            if (block.type === 'image') {
                if (block.source.type === 'url') {
                    return { type: 'image_url', image_url: { url: block.source.url } };
                }
                return {
                    type: 'image_url',
                    image_url: {
                        url: `data:${block.source.mediaType};base64,${block.source.data}`,
                    },
                };
            }
            return block;
        });

        result.push({
            role: m.role,
            content,
        });
    }

    return result;
}

/**
 * Convert OpenAI response to unified format
 */
function fromOpenAIResponse(response: any): ChatResponse {
    const choice = response.choices[0];
    const content: ContentBlock[] = [];

    if (choice.message.content) {
        content.push({ type: 'text', text: choice.message.content });
    }

    if (choice.message.tool_calls) {
        for (const tc of choice.message.tool_calls) {
            content.push({
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments || '{}'),
            });
        }
    }

    const stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason;

    return {
        id: response.id,
        model: response.model,
        content,
        stopReason: stopReason as any,
        usage: {
            inputTokens: response.usage?.prompt_tokens || 0,
            outputTokens: response.usage?.completion_tokens || 0,
        },
    };
}

export class OpenAIProvider implements LlmProviderInterface {
    name = 'openai';

    isConfigured(): boolean {
        return !!process.env.OPENAI_API_KEY;
    }

    async chat(request: ChatRequest, config: LlmProviderConfig): Promise<ChatResponse> {
        const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

        if (!apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const baseUrl = config.baseUrl || OPENAI_API_URL;

        const body: Record<string, unknown> = {
            model: config.modelId,
            messages: toOpenAIMessages(request.messages, request.systemPrompt),
        };

        if (request.maxTokens) {
            body.max_tokens = request.maxTokens;
        }

        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                },
            }));
        }

        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }

        if (request.topP !== undefined) {
            body.top_p = request.topP;
        }

        if (request.stopSequences) {
            body.stop = request.stopSequences;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...config.headers,
        };

        if (config.organization) {
            headers['OpenAI-Organization'] = config.organization;
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(config.timeout || 30000),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${error}`);
        }

        const data = await response.json();
        return fromOpenAIResponse(data);
    }

    async *chatStream(
        request: ChatRequest,
        config: LlmProviderConfig
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

        if (!apiKey) {
            throw new Error('OpenAI API key not configured');
        }

        const baseUrl = config.baseUrl || OPENAI_API_URL;

        const body: Record<string, unknown> = {
            model: config.modelId,
            messages: toOpenAIMessages(request.messages, request.systemPrompt),
            stream: true,
            stream_options: { include_usage: true },
        };

        if (request.maxTokens) {
            body.max_tokens = request.maxTokens;
        }

        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((t) => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.input_schema,
                },
            }));
        }

        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...config.headers,
        };

        if (config.organization) {
            headers['OpenAI-Organization'] = config.organization;
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.text();
            yield { type: 'error', error: `OpenAI API error (${response.status}): ${error}` };
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            yield { type: 'error', error: 'No response body' };
            return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        const toolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            // Emit any pending tool calls
                            for (const tc of toolCalls.values()) {
                                yield {
                                    type: 'tool_use_end',
                                    toolUse: {
                                        id: tc.id,
                                        name: tc.name,
                                        input: tc.args,
                                    },
                                };
                            }
                            yield { type: 'done' };
                            return;
                        }

                        try {
                            const event = JSON.parse(data);
                            const delta = event.choices?.[0]?.delta;

                            if (delta?.content) {
                                yield { type: 'text', text: delta.content };
                            }

                            if (delta?.tool_calls) {
                                for (const tc of delta.tool_calls) {
                                    const index = tc.index;
                                    if (!toolCalls.has(index)) {
                                        toolCalls.set(index, {
                                            id: tc.id || '',
                                            name: tc.function?.name || '',
                                            args: '',
                                        });
                                        if (tc.id && tc.function?.name) {
                                            yield {
                                                type: 'tool_use_start',
                                                toolUse: {
                                                    id: tc.id,
                                                    name: tc.function.name,
                                                },
                                            };
                                        }
                                    }

                                    const existing = toolCalls.get(index)!;
                                    if (tc.id) existing.id = tc.id;
                                    if (tc.function?.name) existing.name = tc.function.name;
                                    if (tc.function?.arguments) {
                                        existing.args += tc.function.arguments;
                                        yield {
                                            type: 'tool_use_delta',
                                            toolUse: {
                                                id: existing.id,
                                                name: existing.name,
                                                input: tc.function.arguments,
                                            },
                                        };
                                    }
                                }
                            }

                            if (event.usage) {
                                yield {
                                    type: 'done',
                                    usage: {
                                        inputTokens: event.usage.prompt_tokens,
                                        outputTokens: event.usage.completion_tokens,
                                    },
                                };
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
