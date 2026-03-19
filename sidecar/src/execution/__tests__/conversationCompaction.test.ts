import { describe, expect, test } from 'bun:test';
import { adjustCompactionRemoveCount, type ConversationMessage } from '../conversationCompaction';

describe('conversationCompaction', () => {
    test('keeps assistant tool calls paired with following tool results', () => {
        const conversation: ConversationMessage[] = [
            { role: 'user', content: 'older context' },
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Need to search.' },
                    { type: 'tool_use', id: 'call-1', name: 'search_web', input: { query: 'MiniMax stock' } },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'call-1', content: 'search results', is_error: false },
                ],
            },
            { role: 'assistant', content: 'analysis' },
        ];

        expect(adjustCompactionRemoveCount(conversation, 2)).toBe(1);
    });

    test('leaves compaction boundary unchanged when no tool pair is split', () => {
        const conversation: ConversationMessage[] = [
            { role: 'user', content: 'older context' },
            {
                role: 'assistant',
                content: [
                    { type: 'text', text: 'Need to search.' },
                    { type: 'tool_use', id: 'call-1', name: 'search_web', input: { query: 'MiniMax stock' } },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'call-1', content: 'search results', is_error: false },
                ],
            },
            { role: 'assistant', content: 'analysis' },
        ];

        expect(adjustCompactionRemoveCount(conversation, 3)).toBe(3);
    });

    test('rewinds across consecutive split tool-call boundaries', () => {
        const conversation: ConversationMessage[] = [
            { role: 'user', content: 'older context' },
            {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'call-1', name: 'search_web', input: { query: 'first' } },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'call-1', content: 'first result', is_error: false },
                ],
            },
            {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'call-2', name: 'view_file', input: { path: 'foo.ts' } },
                ],
            },
            {
                role: 'user',
                content: [
                    { type: 'tool_result', tool_use_id: 'call-2', content: 'second result', is_error: false },
                ],
            },
        ];

        expect(adjustCompactionRemoveCount(conversation, 4)).toBe(3);
    });
});
