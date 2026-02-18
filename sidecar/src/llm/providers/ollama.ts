/**
 * Ollama Provider
 *
 * Ollama local model integration for the LLM Router
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

const OLLAMA_DEFAULT_URL = 'http://localhost:11434/api/chat';

/**
 * Convert unified messages to Ollama format
 */
function toOllamaMessages(messages: Message[], systemPrompt?: string): any[] {
    const result: any[] = [];

    // Add system message if provided
    if (systemPrompt) {
        result.push({
            role: 'system',
            content: systemPrompt,
        });
    }

    for (const m of messages) {
        if (m.role === 'system') continue;

        if (typeof m.content === 'string') {
            result.push({
                role: m.role === 'tool' ? 'assistant' : m.role,
                content: m.content,
            });
            continue;
        }

        // Ollama has limited support for content blocks, convert to text
        const textParts: string[] = [];
        const images: string[] = [];

        for (const block of m.content) {
            if (block.type === 'text') {
                textParts.push(block.text);
            } else if (block.type === 'image' && block.source.type === 'base64') {
                images.push(block.source.data!);
            } else if (block.type === 'tool_use') {
                textParts.push(`[Tool: ${block.name}] ${JSON.stringify(block.input)}`);
            } else if (block.type === 'tool_result') {
                const content =
                    typeof block.content === 'string'
                        ? block.content
                        : block.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
                textParts.push(`[Tool Result: ${block.tool_use_id}] ${content}`);
            }
        }

        const message: any = {
            role: m.role === 'tool' ? 'assistant' : m.role,
            content: textParts.join('\n'),
        };

        if (images.length > 0) {
            message.images = images;
        }

        result.push(message);
    }

    return result;
}

/**
 * Convert Ollama response to unified format
 */
function fromOllamaResponse(response: any): ChatResponse {
    const content: ContentBlock[] = [];

    if (response.message?.content) {
        content.push({ type: 'text', text: response.message.content });
    }

    return {
        id: response.created_at || `ollama-${Date.now()}`,
        model: response.model,
        content,
        stopReason: response.done ? 'end_turn' : 'max_tokens',
        usage: {
            inputTokens: response.prompt_eval_count || 0,
            outputTokens: response.eval_count || 0,
        },
    };
}

export class OllamaProvider implements LlmProviderInterface {
    name = 'ollama';

    isConfigured(): boolean {
        // Ollama runs locally, check if URL is reachable
        // For now, assume it's configured if env var or default is set
        return true;
    }

    async chat(request: ChatRequest, config: LlmProviderConfig): Promise<ChatResponse> {
        const baseUrl = config.baseUrl || process.env.OLLAMA_URL || OLLAMA_DEFAULT_URL;

        const body: Record<string, unknown> = {
            model: config.modelId,
            messages: toOllamaMessages(request.messages, request.systemPrompt),
            stream: false,
        };

        // Ollama options
        const options: Record<string, unknown> = {};

        if (request.maxTokens) {
            options.num_predict = request.maxTokens;
        }

        if (request.temperature !== undefined) {
            options.temperature = request.temperature;
        }

        if (request.topP !== undefined) {
            options.top_p = request.topP;
        }

        if (request.stopSequences) {
            options.stop = request.stopSequences;
        }

        if (Object.keys(options).length > 0) {
            body.options = options;
        }

        // Note: Ollama has limited tool support, using format hint instead
        if (request.tools && request.tools.length > 0) {
            body.format = 'json';
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...config.headers,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(config.timeout || 120000), // Longer timeout for local models
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Ollama API error (${response.status}): ${error}`);
        }

        const data = await response.json();
        return fromOllamaResponse(data);
    }

    async *chatStream(
        request: ChatRequest,
        config: LlmProviderConfig
    ): AsyncGenerator<StreamChunk, void, unknown> {
        const baseUrl = config.baseUrl || process.env.OLLAMA_URL || OLLAMA_DEFAULT_URL;

        const body: Record<string, unknown> = {
            model: config.modelId,
            messages: toOllamaMessages(request.messages, request.systemPrompt),
            stream: true,
        };

        // Ollama options
        const options: Record<string, unknown> = {};

        if (request.maxTokens) {
            options.num_predict = request.maxTokens;
        }

        if (request.temperature !== undefined) {
            options.temperature = request.temperature;
        }

        if (Object.keys(options).length > 0) {
            body.options = options;
        }

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...config.headers,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const error = await response.text();
            yield { type: 'error', error: `Ollama API error (${response.status}): ${error}` };
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            yield { type: 'error', error: 'No response body' };
            return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                        const event = JSON.parse(line);

                        if (event.message?.content) {
                            yield { type: 'text', text: event.message.content };
                        }

                        if (event.done) {
                            yield {
                                type: 'done',
                                stopReason: 'end_turn',
                                usage: {
                                    inputTokens: event.prompt_eval_count || 0,
                                    outputTokens: event.eval_count || 0,
                                },
                            };
                            return;
                        }
                    } catch (e) {
                        // Skip invalid JSON
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        yield { type: 'done' };
    }
}
