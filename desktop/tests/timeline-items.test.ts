import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { TaskEvent, TaskSession } from '../src/types/events';

function makeSession(events: TaskEvent[]): TaskSession {
    return {
        taskId: 'task-1',
        status: 'running',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        messages: [],
        events,
        createdAt: '2026-03-15T10:00:00.000Z',
        updatedAt: '2026-03-15T10:00:00.000Z',
    };
}

function makeEvent(type: TaskEvent['type'], payload: Record<string, unknown>, sequence: number): TaskEvent {
    return {
        id: `event-${sequence}`,
        taskId: 'task-1',
        timestamp: `2026-03-15T10:00:${String(sequence).padStart(2, '0')}.000Z`,
        sequence,
        type,
        payload,
    };
}

describe('buildTimelineItems', () => {
    test('merges consecutive identical tool calls into a single card', () => {
        const session = makeSession([
            makeEvent('TOOL_CALLED', {
                toolId: 'tool-1',
                toolName: 'run_command',
                input: { command: 'dir' },
            }, 1),
            makeEvent('TOOL_RESULT', {
                toolId: 'tool-1',
                success: true,
                result: 'ok',
            }, 2),
            makeEvent('TOOL_CALLED', {
                toolId: 'tool-2',
                toolName: 'run_command',
                input: { command: 'dir' },
            }, 3),
            makeEvent('TOOL_RESULT', {
                toolId: 'tool-2',
                success: true,
                result: 'ok again',
            }, 4),
        ]);

        const { items } = buildTimelineItems(session);
        const toolItems = items.filter((item) => item.type === 'tool_call');

        expect(toolItems).toHaveLength(1);
        expect(toolItems[0]?.repeatCount).toBe(2);
        expect(toolItems[0]?.status).toBe('success');
        expect(toolItems[0]?.result).toBe('ok again');
    });
});
