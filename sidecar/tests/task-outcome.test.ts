import { describe, expect, test } from 'bun:test';
import {
    buildTaskCompletionSummary,
    extractLatestAssistantText,
    flattenAssistantContent,
} from '../src/agent/taskOutcome';

describe('task outcome helpers', () => {
    test('extracts text from string assistant messages', () => {
        expect(extractLatestAssistantText([
            { role: 'user', content: 'hello' },
            { role: 'assistant', content: 'final answer' },
        ])).toBe('final answer');
    });

    test('extracts text blocks from structured assistant messages', () => {
        expect(flattenAssistantContent([
            { type: 'thinking', text: 'internal' },
            { type: 'text', text: 'Step one' },
            { type: 'tool_use', name: 'list_dir' },
            { type: 'text', text: 'Step two' },
        ])).toBe('Step one\n\nStep two');
    });

    test('falls back when no assistant text is available', () => {
        expect(buildTaskCompletionSummary([
            { role: 'user', content: 'hello' },
        ], 'Task completed')).toBe('Task completed');
    });
});
