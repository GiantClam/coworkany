import { describe, expect, test } from 'bun:test';
import { buildInvalidCommandResponse, summarizeValidationIssues } from '../src/ipc/commandValidation';

describe('ipc command validation helpers', () => {
    test('summarizeValidationIssues renders max five issues with dotted paths', () => {
        const summary = summarizeValidationIssues({
            issues: [
                { path: ['payload', 'taskId'], message: 'Expected string' },
                { path: ['payload', 'config', 0], message: 'Invalid entry' },
                { path: [], message: 'Invalid command shape' },
                { path: ['payload', 'model'], message: 'Required' },
                { path: ['payload', 'tools'], message: 'Expected array' },
                { path: ['payload', 'extra'], message: 'Unexpected key' },
            ],
        });

        expect(summary).toContain('payload.taskId: Expected string');
        expect(summary).toContain('payload.config.0: Invalid entry');
        expect(summary).toContain('command: Invalid command shape');
        expect(summary).toContain('payload.model: Required');
        expect(summary).toContain('payload.tools: Expected array');
        expect(summary).not.toContain('payload.extra: Unexpected key');
    });

    test('buildInvalidCommandResponse creates typed response when id exists', () => {
        const response = buildInvalidCommandResponse(
            {
                id: 'cmd-1',
                type: 'start_task',
            },
            'payload.taskId: Expected string',
            () => '2026-03-29T00:00:00.000Z',
        );

        expect(response).toEqual({
            type: 'start_task_response',
            commandId: 'cmd-1',
            timestamp: '2026-03-29T00:00:00.000Z',
            payload: {
                success: false,
                error: 'invalid_command: payload.taskId: Expected string',
                details: 'payload.taskId: Expected string',
            },
        });
    });

    test('buildInvalidCommandResponse falls back type and returns null without id', () => {
        const fallback = buildInvalidCommandResponse(
            { id: 'cmd-2' },
            'bad',
            () => '2026-03-29T00:00:00.000Z',
        );
        expect(fallback?.type).toBe('transport_error_response');

        expect(buildInvalidCommandResponse({ type: 'start_task' }, 'bad')).toBeNull();
        expect(buildInvalidCommandResponse(null, 'bad')).toBeNull();
    });
});
