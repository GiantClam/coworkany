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
});
