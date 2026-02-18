/**
 * Anthropic Provider
 *
 * Claude API integration for the LLM Router
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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Convert unified messages to Anthropic format
 */
function toAnthropicMessages(messages: Message[]): any[] {
    return messages
        .filter((m) => m.role !== 'system') // System is handled separately
        .map((m) => {
            if (typeof m.content === 'string') {
                return {
                    role: m.role === 'tool' ? 'user' : m.role,
                    content: m.content,
                };
            }

            // Convert content blocks
            const content = m.content.map((block) => {
                if (block.type === 'text') {
                    return { type: 'text', text: block.text };
                }
                if (block.type === 'image') {
                    return {
                        type: 'image',
                        source: block.source,
                    };
                }
                if (block.type === 'tool_use') {
                    return {
                        type: 'tool_use',
                        id: block.id,
                        name: block.name,
                        input: block.input,
                    };
                }
                if (block.type === 'tool_result') {
                    return {
                        type: 'tool_result',
                        tool_use_id: block.tool_use_id,
                        content:
                            typeof block.content === 'string'
                                ? block.content
                                : block.content.map((c) => {
                                      if (c.type === 'text') return { type: 'text', text: c.text };
                                      return c;
                                  }),
                        is_error: block.is_error,
                    };
                }
                return block;
            });

            return {
                role: m.role === 'tool' ? 'user' : m.role,
                content,
            };
        });
}

/**
 * Convert Anthropic response to unified format
 */
function fromAnthropicResponse(response: any): ChatResponse {
    const content: ContentBlock[] = response.content.map((block: any) => {
        if (block.type === 'text') {
            return { type: 'text', text: block.text };
        }
        if (block.type === 'tool_use') {
            return {
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
            };
        }
        return block;
    });

    return {
        id: response.id,
        model: response.model,
        content,
        stopReason: response.stop_reason,
        usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
        },
    };
}

export class AnthropicProvider implements LlmProviderInterface {
    name = 'anthropic';

    isConfigured(): boolean {
        return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
    }

    async chat(request: ChatRequest, config: LlmProviderConfig): Promise<ChatResponse> {
        const apiKey =
            config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

        if (!apiKey) {
            throw new Error('Anthropic API key not configured');
        }

        const baseUrl = config.baseUrl || ANTHROPIC_API_URL;

        const body: Record<string, unknown> = {
            model: config.modelId,
            max_tokens: request.maxTokens || 4096,
            messages: toAnthropicMessages(request.messages),
        };

        if (request.systemPrompt) {
            body.system = request.systemPrompt;
        }

        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.input_schema,
            }));
        }

        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }

        if (request.topP !== undefined) {
            body.top_p = request.topP;
        }

        if (request.stopSequences) {
            body.stop_sequences = request.stopSequences;
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                ...config.headers,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(config.timeout || 30000),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Anthropic API error (${response.status}): ${error}`);
        }

        const data = await response.json();
        return fromAnthropicResponse(data);
    }

    async *chatStream(
        request: ChatRequest,
        config: LlmProviderConfig
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const apiKey =
            config.apiKey || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

        if (!apiKey) {
            throw new Error('Anthropic API key not configured');
        }

        const baseUrl = config.baseUrl || ANTHROPIC_API_URL;

        const body: Record<string, unknown> = {
            model: config.modelId,
            max_tokens: request.maxTokens || 4096,
            messages: toAnthropicMessages(request.messages),
            stream: true,
        };

        if (request.systemPrompt) {
            body.system = request.systemPrompt;
        }

        if (request.tools && request.tools.length > 0) {
            body.tools = request.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.input_schema,
            }));
        }

        if (request.temperature !== undefined) {
            body.temperature = request.temperature;
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': ANTHROPIC_VERSION,
                ...config.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.text();
            yield { type: 'error', error: `Anthropic API error (${response.status}): ${error}` };
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            yield { type: 'error', error: 'No response body' };
            return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let currentToolUse: { id: string; name: string; input: string } | null = null;

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
                            yield { type: 'done' };
                            return;
                        }

                        try {
                            const event = JSON.parse(data);

                            if (event.type === 'content_block_start') {
                                if (event.content_block.type === 'tool_use') {
                                    currentToolUse = {
                                        id: event.content_block.id,
                                        name: event.content_block.name,
                                        input: '',
                                    };
                                    yield {
                                        type: 'tool_use_start',
                                        toolUse: {
                                            id: currentToolUse.id,
                                            name: currentToolUse.name,
                                        },
                                    };
                                }
                            } else if (event.type === 'content_block_delta') {
                                if (event.delta.type === 'text_delta') {
                                    yield { type: 'text', text: event.delta.text };
                                } else if (event.delta.type === 'input_json_delta') {
                                    if (currentToolUse) {
                                        currentToolUse.input += event.delta.partial_json;
                                        yield {
                                            type: 'tool_use_delta',
                                            toolUse: {
                                                id: currentToolUse.id,
                                                name: currentToolUse.name,
                                                input: event.delta.partial_json,
                                            },
                                        };
                                    }
                                }
                            } else if (event.type === 'content_block_stop') {
                                if (currentToolUse) {
                                    yield {
                                        type: 'tool_use_end',
                                        toolUse: {
                                            id: currentToolUse.id,
                                            name: currentToolUse.name,
                                            input: currentToolUse.input,
                                        },
                                    };
                                    currentToolUse = null;
                                }
                            } else if (event.type === 'message_delta') {
                                if (event.usage) {
                                    yield {
                                        type: 'done',
                                        stopReason: event.delta?.stop_reason,
                                        usage: {
                                            inputTokens: event.usage.input_tokens || 0,
                                            outputTokens: event.usage.output_tokens || 0,
                                        },
                                    };
                                }
                            } else if (event.type === 'message_stop') {
                                yield { type: 'done' };
                            } else if (event.type === 'error') {
                                yield { type: 'error', error: event.error?.message || 'Unknown error' };
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
