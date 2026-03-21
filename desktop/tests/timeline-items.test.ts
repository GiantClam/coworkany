import { describe, expect, test } from 'bun:test';
import { buildTimelineItems } from '../src/components/Chat/Timeline/hooks/useTimelineItems';
import type { TaskEvent, TaskSession } from '../src/types';

function makeEvent(overrides: Partial<TaskEvent>): TaskEvent {
    return {
        id: overrides.id ?? crypto.randomUUID(),
        taskId: overrides.taskId ?? 'task-1',
        sequence: overrides.sequence ?? 1,
        type: overrides.type ?? 'TASK_PLAN_READY',
        timestamp: overrides.timestamp ?? new Date().toISOString(),
        payload: overrides.payload ?? {},
    };
}

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? 'task-1',
        status: overrides.status ?? 'idle',
        planSteps: overrides.planSteps ?? [],
        toolCalls: overrides.toolCalls ?? [],
        effects: overrides.effects ?? [],
        patches: overrides.patches ?? [],
        messages: overrides.messages ?? [],
        events: overrides.events ?? [],
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        summary: overrides.summary,
        title: overrides.title,
        workspacePath: overrides.workspacePath,
    };
}

describe('buildTimelineItems', () => {
    test('merges task update events into a single task card message', () => {
        const session = makeSession({
            status: 'idle',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_CONTRACT_REOPENED',
                    payload: {
                        summary: 'User follow-up introduced a new task scope: deliverables changed.',
                        reason: 'User follow-up introduced a new task scope: deliverables or output targets changed.',
                        trigger: 'new_scope_signal',
                        diff: {
                            changedFields: ['deliverables', 'execution_targets'],
                        },
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_RESEARCH_UPDATED',
                    payload: {
                        summary: 'Research updated after reopen: 3/3 queries processed.',
                        sourcesChecked: ['conversation', 'workspace'],
                        completedQueries: 3,
                        pendingQueries: 0,
                        blockingUnknowns: [],
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Replanned contract now saves a PDF artifact.',
                    },
                }),
                makeEvent({
                    sequence: 4,
                    type: 'TASK_USER_ACTION_REQUIRED',
                    payload: {
                        actionId: 'action-new',
                        title: 'Grant PDF export access',
                        kind: 'manual_step',
                        description: 'Allow Coworkany to continue the PDF export.',
                        blocking: true,
                        questions: [],
                        instructions: ['Grant filesystem access, then continue.'],
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const taskCards = result.items
            .filter((item) => item.type === 'task_card')
            .map((item) => item);

        expect(taskCards).toHaveLength(1);
        expect(taskCards[0]?.title).toBe('Task update');
        expect(taskCards[0]?.subtitle).toBe('Allow Coworkany to continue the PDF export.');
        expect(taskCards[0]?.sections.some((section) => section.label === 'Contract · Changed fields')).toBe(true);
        expect(taskCards[0]?.sections.some((section) => section.label === 'Research · Sources checked')).toBe(true);
        expect(taskCards[0]?.sections.some((section) => section.label === 'Action · Instructions')).toBe(true);
    });

    test('respects recent-event truncation while reporting hidden count', () => {
        const session = makeSession({
            status: 'idle',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_CONTRACT_REOPENED',
                    payload: {
                        summary: 'Contract reopened.',
                        reason: 'Old reason.',
                        trigger: 'execution_infeasible',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_RESEARCH_UPDATED',
                    payload: {
                        summary: 'Research updated.',
                        sourcesChecked: ['conversation'],
                        completedQueries: 1,
                        pendingQueries: 0,
                        blockingUnknowns: [],
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TASK_PLAN_READY',
                    payload: {
                        summary: 'Plan ready.',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session, 2);

        expect(result.hiddenEventCount).toBe(1);
        expect(result.items).toHaveLength(1);
        expect(result.items[0]?.type).toBe('task_card');
    });

    test('adds a final assistant message when a task finishes without streamed assistant output', () => {
        const session = makeSession({
            status: 'finished',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'CHAT_MESSAGE',
                    payload: {
                        role: 'user',
                        content: '从 skillhub 中安装 skill-vetter',
                    },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TOOL_RESULT',
                    payload: {
                        toolId: 'tool-1',
                        success: false,
                        error: 'temporary fallback',
                    },
                }),
                makeEvent({
                    sequence: 3,
                    type: 'TASK_FINISHED',
                    payload: {
                        summary: '已从 skillhub 安装并启用技能 `skill-vetter`。',
                    },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const assistantContents = result.items
            .filter((item) => item.type === 'assistant_message')
            .map((item) => item.content);

        expect(assistantContents).toEqual(['已从 skillhub 安装并启用技能 `skill-vetter`。']);
    });

    test('renders task status updates as system events', () => {
        const session = makeSession({
            status: 'running',
            events: [
                makeEvent({
                    sequence: 1,
                    type: 'TASK_STATUS',
                    payload: { status: 'running' },
                }),
                makeEvent({
                    sequence: 2,
                    type: 'TASK_STATUS',
                    payload: { status: 'idle' },
                }),
            ],
        });

        const result = buildTimelineItems(session);
        const systemContents = result.items
            .filter((item) => item.type === 'system_event')
            .map((item) => item.content);

        expect(systemContents).toEqual([
            'Status updated: in progress',
            'Status updated: waiting',
        ]);
    });
});
