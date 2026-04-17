import { describe, expect, test } from 'bun:test';
import {
    buildAgentTaskNotificationXml,
    coerceAgentTaskNotification,
    tryBuildAgentTaskNotificationFromEvent,
} from '../src/mastra/agentTaskNotification';

describe('agent task notification', () => {
    test('builds notification from completed agent event payload', () => {
        const notification = tryBuildAgentTaskNotificationFromEvent(
            'agent-execution-event-agent-finish',
            {
                agentId: 'agent-a1b',
                summary: 'Agent "Investigate auth bug" completed',
                result: 'Found null pointer in src/auth/validate.ts:42',
                usage: {
                    totalTokens: 320,
                    toolUses: 4,
                    durationMs: 1120,
                },
            },
        );
        expect(notification).toEqual({
            taskId: 'agent-a1b',
            status: 'completed',
            summary: 'Agent "Investigate auth bug" completed',
            result: 'Found null pointer in src/auth/validate.ts:42',
            usage: {
                totalTokens: 320,
                toolUses: 4,
                durationMs: 1120,
            },
        });
    });

    test('builds xml payload with escaped values', () => {
        const xml = buildAgentTaskNotificationXml({
            taskId: 'agent-<1>',
            status: 'failed',
            summary: 'failed with "reason"',
            result: 'error: <bad>',
        });
        expect(xml).toContain('<task-notification>');
        expect(xml).toContain('&lt;1&gt;');
        expect(xml).toContain('&quot;reason&quot;');
        expect(xml).toContain('&lt;bad&gt;');
    });

    test('coerces runtime payload into normalized notification', () => {
        const notification = coerceAgentTaskNotification({
            taskId: 'subtask-1',
            status: 'completed',
            summary: 'Subtask complete',
            result: 'wrote report.md',
            usage: {
                totalTokens: 42,
                toolUses: 1,
                durationMs: 360,
            },
        });
        expect(notification).toEqual({
            taskId: 'subtask-1',
            status: 'completed',
            summary: 'Subtask complete',
            result: 'wrote report.md',
            usage: {
                totalTokens: 42,
                toolUses: 1,
                durationMs: 360,
            },
        });
    });

    test('returns null for invalid runtime payload', () => {
        expect(coerceAgentTaskNotification({
            taskId: 'subtask-2',
            summary: 'missing status',
        })).toBeNull();
    });
});
