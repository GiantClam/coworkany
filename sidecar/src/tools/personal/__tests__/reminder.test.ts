import { describe, expect, mock, test } from 'bun:test';
import { createSetReminderTool } from '../reminder';
import type { ToolContext } from '../../standard';

const context: ToolContext = {
    workspacePath: '/tmp/workspace',
    taskId: 'task-1',
};

describe('createSetReminderTool', () => {
    test('maps one-time reminder to schedule_task', async () => {
        const scheduleTask = mock(async (args: any) => ({
            success: true,
            scheduledTaskId: 'scheduled-1',
            scheduledAt: args.time,
        }));
        const tool = createSetReminderTool({ scheduleTask });

        const result = await tool.handler({
            message: '喝水',
            time: '2026-03-25T10:00:00.000Z',
            recurring: 'none',
        }, context);

        expect(scheduleTask).toHaveBeenCalledTimes(1);
        const scheduleArgs = scheduleTask.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(scheduleArgs.task_query).toBe('提醒你喝水');
        expect(scheduleArgs.time).toBe('2026-03-25T10:00:00.000Z');
        expect(scheduleArgs.speak_result).toBe(false);

        expect((result as any).success).toBe(true);
        expect((result as any).reminder_id).toBe('scheduled-1');
    });

    test('normalizes imperative reminder phrasing before scheduling', async () => {
        const scheduleTask = mock(async (args: any) => ({
            success: true,
            scheduledTaskId: 'scheduled-normalized',
            scheduledAt: args.time,
        }));
        const tool = createSetReminderTool({ scheduleTask });

        await tool.handler({
            message: '叫我喝水一次',
            time: '2026-03-25T10:00:00.000Z',
            recurring: 'none',
        }, context);

        const scheduleArgs = scheduleTask.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(scheduleArgs.task_query).toBe('提醒你喝水');
    });

    test('converts english first-person reminder intent to assistant perspective', async () => {
        const scheduleTask = mock(async (args: any) => ({
            success: true,
            scheduledTaskId: 'scheduled-en',
            scheduledAt: args.time,
        }));
        const tool = createSetReminderTool({ scheduleTask });

        await tool.handler({
            message: 'remind me to drink water',
            time: '2026-03-25T10:00:00.000Z',
            recurring: 'none',
        }, context);

        const scheduleArgs = scheduleTask.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(scheduleArgs.task_query).toBe('remind you to drink water');
    });

    test('maps daily reminder to recurring schedule query', async () => {
        const scheduleTask = mock(async (args: any) => ({
            success: true,
            scheduledTaskId: 'scheduled-2',
            scheduledAt: args.time,
        }));
        const tool = createSetReminderTool({ scheduleTask });

        await tool.handler({
            message: '喝水',
            time: '2026-03-25T10:00:00.000Z',
            recurring: 'daily',
        }, context);

        const scheduleArgs = scheduleTask.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(scheduleArgs.task_query).toBe('2026-03-25T10:00:00.000Z every day 提醒你喝水');
    });

    test('interprets relative-minute daily reminders as minute intervals', async () => {
        const scheduleTask = mock(async (args: any) => ({
            success: true,
            scheduledTaskId: 'scheduled-interval',
            scheduledAt: args.time,
        }));
        const tool = createSetReminderTool({ scheduleTask });

        const result = await tool.handler({
            message: '喝水',
            time: 'in 1 minute',
            recurring: 'daily',
        }, context);

        const scheduleArgs = scheduleTask.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(String(scheduleArgs.task_query)).toContain('every 1 minute 提醒你喝水');
        expect((result as any).recurring_note).toContain('interpreted as an interval');
    });

    test('maps weekly and monthly reminders to day-based approximation', async () => {
        const scheduleTask = mock(async (args: any) => ({
            success: true,
            scheduledTaskId: 'scheduled-3',
            scheduledAt: args.time,
        }));
        const tool = createSetReminderTool({ scheduleTask });

        const weeklyResult = await tool.handler({
            message: '喝水',
            time: '2026-03-25T10:00:00.000Z',
            recurring: 'weekly',
        }, context);
        const weeklyArgs = scheduleTask.mock.calls[0]?.[0] as Record<string, unknown>;
        expect(weeklyArgs.task_query).toBe('2026-03-25T10:00:00.000Z every 7 days 提醒你喝水');
        expect((weeklyResult as any).recurring_note).toContain('every 7 days');

        const monthlyResult = await tool.handler({
            message: '喝水',
            time: '2026-03-25T10:00:00.000Z',
            recurring: 'monthly',
        }, context);
        const monthlyArgs = scheduleTask.mock.calls[1]?.[0] as Record<string, unknown>;
        expect(monthlyArgs.task_query).toBe('2026-03-25T10:00:00.000Z every 30 days 提醒你喝水');
        expect((monthlyResult as any).recurring_note).toContain('every 30 days');
    });
});
