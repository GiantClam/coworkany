import { describe, expect, test } from 'bun:test';
import { buildBoardTasks } from '../src/components/jarvis/TaskListView';
import type { TaskSession } from '../src/types';

function makeSession(overrides: Partial<TaskSession> = {}): TaskSession {
    const now = new Date().toISOString();
    return {
        taskId: overrides.taskId ?? crypto.randomUUID(),
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

describe('buildBoardTasks', () => {
    test('includes tasks from every workspace in the board overview', () => {
        const tasks = buildBoardTasks([
            makeSession({
                taskId: 'task-a',
                title: 'Workspace task',
                workspacePath: '/workspace/a',
                updatedAt: '2026-03-20T09:38:43.002Z',
            }),
            makeSession({
                taskId: 'task-b',
                title: 'Scheduled sidecar task',
                workspacePath: '/workspace/b',
                updatedAt: '2026-03-20T09:44:45.437Z',
            }),
        ]);

        expect(tasks.map((task) => task.id)).toEqual(['task-b', 'task-a']);
    });

    test('prefers finished summary over trailing system tool messages', () => {
        const [task] = buildBoardTasks([
            makeSession({
                taskId: 'task-summary',
                title: 'Old title',
                status: 'finished',
                summary: 'Installed skill-vetter successfully.',
                messages: [
                    {
                        id: 'user-1',
                        role: 'user',
                        content: 'Install skill-vetter',
                        timestamp: '2026-03-21T03:54:25.238Z',
                    },
                    {
                        id: 'system-1',
                        role: 'system',
                        content: 'Tool result: Tool failed',
                        timestamp: '2026-03-21T03:54:27.611Z',
                    },
                ],
            }),
        ]);

        expect(task?.result).toBe('Installed skill-vetter successfully.');
    });

    test('uses the latest user prompt as the board title for follow-up sessions', () => {
        const [task] = buildBoardTasks([
            makeSession({
                taskId: 'task-followup',
                title: '[Scheduled] Old task title',
                status: 'finished',
                summary: 'Installed skill-vetter successfully.',
                messages: [
                    {
                        id: 'user-1',
                        role: 'user',
                        content: 'Schedule the Reddit search',
                        timestamp: '2026-03-19T08:15:01.650Z',
                    },
                    {
                        id: 'user-2',
                        role: 'user',
                        content: '从 skillhub 中安装 skill-vetter',
                        timestamp: '2026-03-21T03:54:25.238Z',
                    },
                ],
            }),
        ]);

        expect(task?.title).toBe('从 skillhub 中安装 skill-vetter');
        expect(task?.description).toBe('从 skillhub 中安装 skill-vetter');
    });

    test('projects task center card for task-mode sessions', () => {
        const [task] = buildBoardTasks([
            makeSession({
                taskId: 'task-card',
                status: 'running',
                events: [
                    {
                        id: 'event-1',
                        taskId: 'task-card',
                        sequence: 1,
                        type: 'TASK_PLAN_READY',
                        timestamp: '2026-03-24T09:00:00.000Z',
                        payload: {
                            summary: 'Plan ready',
                            mode: 'immediate_task',
                            tasks: [
                                {
                                    id: 'subtask-1',
                                    title: 'Collect data',
                                    objective: 'Collect data',
                                    dependencies: [],
                                },
                            ],
                            deliverables: [],
                            checkpoints: [],
                            userActionsRequired: [],
                            missingInfo: [],
                        },
                    },
                ],
            }),
        ]);

        expect(task?.taskCard?.title).toBe('Task center');
        expect(task?.taskCard?.tasks?.length).toBe(1);
    });

    test('builds conversation card for chat-mode sessions', () => {
        const [task] = buildBoardTasks([
            makeSession({
                taskId: 'chat-task',
                status: 'finished',
                events: [
                    {
                        id: 'event-1',
                        taskId: 'chat-task',
                        sequence: 1,
                        type: 'TASK_PLAN_READY',
                        timestamp: '2026-03-24T09:00:00.000Z',
                        payload: {
                            summary: 'Chat mode plan',
                            mode: 'chat',
                            deliverables: [],
                            checkpoints: [],
                            userActionsRequired: [],
                            missingInfo: [],
                        },
                    },
                    {
                        id: 'event-2',
                        taskId: 'chat-task',
                        sequence: 2,
                        type: 'TEXT_DELTA',
                        timestamp: '2026-03-24T09:00:01.000Z',
                        payload: { role: 'assistant', delta: 'hello' },
                    },
                ],
            }),
        ]);

        expect(task?.taskCard?.title.length).toBeGreaterThan(0);
        expect(task?.taskCard?.sections.some((section) => section.label.startsWith('Conversation ·'))).toBe(true);
        expect(task?.taskCard?.tasks).toBeUndefined();
    });
});
