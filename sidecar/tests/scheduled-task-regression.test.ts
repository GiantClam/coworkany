import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { taskCreateTool, taskListTool } from '../src/tools/core/tasks';
import { setReminderTool } from '../src/tools/personal/reminder';
import {
    scheduledTaskCreateTool,
    scheduledTaskDeleteTool,
    scheduledTaskListTool,
} from '../src/tools/core/scheduledTasks';
import { getHeartbeatEngine, setHeartbeatExecutorFactory, shutdownHeartbeatEngines } from '../src/proactive/runtime';

function createWorkspace(): string {
    const workspacePath = path.join(process.cwd(), '.tmp', `scheduler-${randomUUID()}`);
    fs.mkdirSync(workspacePath, { recursive: true });
    return workspacePath;
}

function removeWorkspace(workspacePath: string): void {
    try {
        fs.rmSync(workspacePath, { recursive: true, force: true });
    } catch {
        // ignore cleanup failures in tests
    }
}

afterEach(() => {
    shutdownHeartbeatEngines();
    setHeartbeatExecutorFactory(() => ({
        executeTask: async () => ({ success: true }),
        runSkill: async () => ({ success: true }),
        notify: async () => {},
    }));
});

describe('scheduled task regression', () => {
    test('task_create stores dueDate and metadata aliases', async () => {
        const workspacePath = createWorkspace();

        try {
            const result = await taskCreateTool.handler(
                {
                    title: 'Follow up',
                    due_date: '2026-03-10T08:00:00.000Z',
                    metadata: { type: 'reminder', recurring: 'none' },
                    tags: ['reminder'],
                },
                { workspacePath, taskId: 'task_create_test' }
            );

            expect(result.success).toBe(true);
            expect(result.taskId).toBeTruthy();
            expect(result.task_id).toBe(result.taskId);
            expect(result.task.dueDate).toBe('2026-03-10T08:00:00.000Z');
            expect(result.task.context.metadata.type).toBe('reminder');
        } finally {
            removeWorkspace(workspacePath);
        }
    });

    test('set_reminder creates a reminder task with stable id field', async () => {
        const workspacePath = createWorkspace();

        try {
            const result = await setReminderTool.handler(
                {
                    message: 'Review contract',
                    time: 'in 2 hours',
                },
                { workspacePath, taskId: 'reminder_test' }
            );

            expect(result.success).toBe(true);
            expect(result.reminder_id).toBeTruthy();

            const tasks = await taskListTool.handler({}, { workspacePath, taskId: 'reminder_test' });
            expect(tasks.success).toBe(true);
            expect(tasks.tasks.some((task: any) => task.id === result.reminder_id)).toBe(true);

            const triggerEngine = getHeartbeatEngine(workspacePath);
            expect(
                triggerEngine.getTriggers().some((trigger) => trigger.id === result.trigger_id && trigger.type === 'date')
            ).toBe(true);
        } finally {
            removeWorkspace(workspacePath);
        }
    });

    test('set_reminder fires a one-off heartbeat notification and removes the one-shot trigger', async () => {
        const workspacePath = createWorkspace();
        const notifications: string[] = [];

        setHeartbeatExecutorFactory(() => ({
            executeTask: async () => ({ success: true }),
            runSkill: async () => ({ success: true }),
            notify: async (message) => {
                notifications.push(message);
            },
        }));

        try {
            const runAt = new Date(Date.now() + 1200).toISOString();
            const result = await setReminderTool.handler(
                {
                    message: 'Join room 10',
                    time: runAt,
                },
                { workspacePath, taskId: 'reminder_fire_test' }
            );

            expect(result.success).toBe(true);

            await new Promise((resolve) => setTimeout(resolve, 1800));

            expect(notifications).toContain('Join room 10');

            const tasks = await taskListTool.handler({}, { workspacePath, taskId: 'reminder_fire_test' });
            const reminderTask = tasks.tasks.find((task: any) => task.id === result.reminder_id);
            expect(reminderTask).toBeTruthy();
            expect(reminderTask.status).toBe('pending');

            const triggerEngine = getHeartbeatEngine(workspacePath);
            expect(triggerEngine.getTriggers().some((trigger) => trigger.id === result.trigger_id)).toBe(false);
        } finally {
            removeWorkspace(workspacePath);
        }
    });

    test('scheduled task create/list/delete works and persists trigger data', async () => {
        const workspacePath = createWorkspace();

        try {
            const created = await scheduledTaskCreateTool.handler(
                {
                    title: 'Hourly AI digest',
                    taskQuery: '每小时搜索 AI 最新新闻并回复我',
                    scheduleType: 'interval',
                    intervalMinutes: 60,
                },
                { workspacePath, taskId: 'schedule_create_test' }
            );

            expect(created.success).toBe(true);
            expect(created.triggerId).toBeTruthy();

            const listed = await scheduledTaskListTool.handler(
                {},
                { workspacePath, taskId: 'schedule_list_test' }
            );
            expect(listed.success).toBe(true);
            expect(listed.triggers.some((trigger: any) => trigger.id === created.triggerId)).toBe(true);

            const triggerFile = path.join(workspacePath, '.coworkany', 'triggers.json');
            expect(fs.existsSync(triggerFile)).toBe(true);

            const deleted = await scheduledTaskDeleteTool.handler(
                { triggerId: created.triggerId },
                { workspacePath, taskId: 'schedule_delete_test' }
            );
            expect(deleted.success).toBe(true);
        } finally {
            removeWorkspace(workspacePath);
        }
    });

    test('scheduled interval trigger fires executor callback', async () => {
        const workspacePath = createWorkspace();
        const executedQueries: string[] = [];

        setHeartbeatExecutorFactory(() => ({
            executeTask: async (query) => {
                executedQueries.push(query);
                return { success: true, result: 'ok' };
            },
            runSkill: async () => ({ success: true, result: 'ok' }),
            notify: async () => {},
        }));

        try {
            const created = await scheduledTaskCreateTool.handler(
                {
                    title: 'Fast interval test',
                    taskQuery: 'ping scheduled task',
                    scheduleType: 'interval',
                    intervalMinutes: 0.02,
                },
                { workspacePath, taskId: 'schedule_fire_test' }
            );

            expect(created.success).toBe(true);

            await new Promise((resolve) => setTimeout(resolve, 1800));

            expect(executedQueries.length).toBeGreaterThan(0);
            expect(executedQueries[0]).toContain('ping scheduled task');
        } finally {
            removeWorkspace(workspacePath);
        }
    });
});
