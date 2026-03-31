import { describe, expect, test } from 'bun:test';
import { buildRoutedEntrySourceText, parseRouteCommand } from '../src/components/Chat/ChatInterface';

describe('chat entry routing helpers', () => {
    test('parses explicit /ask command as chat route', () => {
        const parsed = parseRouteCommand('/ask summarize this');
        expect(parsed.mode).toBe('chat');
        expect(parsed.normalizedQuery).toBe('summarize this');
    });

    test('parses explicit /task command as task route', () => {
        const parsed = parseRouteCommand('/task generate report');
        expect(parsed.mode).toBe('task');
        expect(parsed.normalizedQuery).toBe('generate report');
    });

    test('parses explicit /schedule command as task route', () => {
        const parsed = parseRouteCommand('/schedule every monday remind me');
        expect(parsed.mode).toBe('task');
        expect(parsed.normalizedQuery).toBe('every monday remind me');
    });

    test('keeps plain text unchanged when no explicit command is provided', () => {
        const parsed = parseRouteCommand('hello world');
        expect(parsed.mode).toBeNull();
        expect(parsed.normalizedQuery).toBe('hello world');
    });

    test('builds routed wrapper for plain text entries', () => {
        expect(buildRoutedEntrySourceText('整理会议纪要', 'task')).toBe('原始任务：整理会议纪要\n用户路由：task');
    });

    test('preserves slash command and synthetic route tokens', () => {
        expect(buildRoutedEntrySourceText('/task build api', 'chat')).toBe('/task build api');
        expect(buildRoutedEntrySourceText('__route_chat__', 'task')).toBe('__route_chat__');
    });
});
