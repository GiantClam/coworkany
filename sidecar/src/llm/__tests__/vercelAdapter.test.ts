import { describe, expect, test } from 'bun:test';
import {
    convertMessagesToAi,
    convertToolDefinitionsToAiTools,
    extractAssistantMessageFromAiResult,
    normalizeOpenAICompatibleBaseUrl,
} from '../vercelAdapter';

describe('vercelAdapter', () => {
    test('converts anthropic-style messages to AI SDK messages', () => {
        const messages = [
            {
                role: 'assistant' as const,
                content: [
                    { type: 'text', text: 'I will run a tool.' },
                    { type: 'tool_use', id: 'tool-1', name: 'list_dir', input: { path: '.' } },
                ],
            },
            {
                role: 'user' as const,
                content: [
                    { type: 'tool_result', tool_use_id: 'tool-1', content: '{"files":[]}', is_error: false },
                ],
            },
        ];

        const result = convertMessagesToAi(messages);

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ role: 'assistant' });
        expect(result[1]).toMatchObject({ role: 'tool' });
        const toolContent = (result[1]?.content as Array<Record<string, unknown>> | undefined) ?? [];
        expect(toolContent[0]?.toolCallId).toBe('tool-1');
        expect(toolContent[0]?.type).toBe('tool-result');
    });

    test('converts tool definitions to AI SDK tools object', () => {
        const tools = [
            {
                name: 'list_dir',
                description: 'List directory entries',
                input_schema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string' },
                    },
                    required: ['path'],
                },
            },
        ];

        const result = convertToolDefinitionsToAiTools(tools);
        expect(Object.keys(result)).toEqual(['list_dir']);
        expect(result.list_dir?.description).toBe('List directory entries');
        expect(result.list_dir?.inputSchema).toBeDefined();
    });

    test('extracts anthropic-style assistant content from AI SDK result', () => {
        const result = extractAssistantMessageFromAiResult('Done.', [
            {
                toolCallId: 'call-1',
                toolName: 'run_command',
                input: { command: 'pwd' },
            },
        ]);

        expect(result.role).toBe('assistant');
        expect(Array.isArray(result.content)).toBe(true);
        expect((result.content as Array<Record<string, unknown>>)[0]).toMatchObject({
            type: 'text',
            text: 'Done.',
        });
        expect((result.content as Array<Record<string, unknown>>)[1]).toMatchObject({
            type: 'tool_use',
            id: 'call-1',
            name: 'run_command',
        });
    });

    test('normalizes openai-compatible endpoint URLs to provider base URL', () => {
        expect(normalizeOpenAICompatibleBaseUrl('https://aiberm.com/v1/chat/completions'))
            .toBe('https://aiberm.com/v1');
        expect(normalizeOpenAICompatibleBaseUrl('https://api.openai.com/v1/responses'))
            .toBe('https://api.openai.com/v1');
        expect(normalizeOpenAICompatibleBaseUrl('https://openrouter.ai/api/v1'))
            .toBe('https://openrouter.ai/api/v1');
    });

    test('drops assistant tool calls that have no corresponding tool result', () => {
        const messages = [
            {
                role: 'assistant' as const,
                content: [
                    { type: 'text', text: 'calling tool' },
                    { type: 'tool_use', id: 'dangling-call', name: 'list_dir', input: { path: '.' } },
                ],
            },
            {
                role: 'user' as const,
                content: 'next question',
            },
        ];

        const converted = convertMessagesToAi(messages);
        const assistant = converted[0] as { role?: string; content?: Array<{ type?: string }> };

        expect(assistant.role).toBe('assistant');
        const content = Array.isArray(assistant.content) ? assistant.content : [];
        expect(content.some((part) => part.type === 'tool-call')).toBe(false);
    });
});
