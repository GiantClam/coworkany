import { describe, expect, test } from 'bun:test';
import {
    getSchedulingDirective,
    isExecutionScheduleRequest,
    isRecurringScheduleRequest,
    isReminderOnlyRequest,
    shouldSuppressTriggeredSkillForScheduling,
} from '../src/agent/schedulingIntent';

describe('scheduling intent', () => {
    test('detects chinese recurring schedule phrases', () => {
        expect(isRecurringScheduleRequest('每小时帮我检索一次 AI 新闻并回复我')).toBe(true);
        expect(isRecurringScheduleRequest('定时帮我检查邮箱')).toBe(true);
        expect(isRecurringScheduleRequest('每天早上 8 点提醒我开会')).toBe(true);
    });

    test('detects english recurring schedule phrases', () => {
        expect(isRecurringScheduleRequest('every hour check the inbox and tell me')).toBe(true);
        expect(isRecurringScheduleRequest('create a recurring task to run daily')).toBe(true);
        expect(isRecurringScheduleRequest('use cron to run this every week')).toBe(true);
    });

    test('distinguishes reminder-only requests from execution scheduling', () => {
        expect(isReminderOnlyRequest('提醒我明天下午三点开会')).toBe(true);
        expect(isExecutionScheduleRequest('提醒我明天下午三点开会')).toBe(false);
        expect(isReminderOnlyRequest('2分钟后总结 reddit 关于 AI 的热点信息')).toBe(false);
    });

    test('detects one-off delayed execution requests', () => {
        expect(isExecutionScheduleRequest('2分钟之后，总结reddit关于ai的热点信息，发给我')).toBe(true);
        expect(isExecutionScheduleRequest('in 2 hours search Reddit for AI news and send me a summary')).toBe(true);
        expect(isExecutionScheduleRequest('明天帮我检查邮箱并汇总未读')).toBe(true);
    });

    test('suppresses stock research auto-trigger for execution scheduling requests', () => {
        expect(shouldSuppressTriggeredSkillForScheduling('stock-research', '每小时帮我看一下股票新闻')).toBe(true);
        expect(shouldSuppressTriggeredSkillForScheduling('stock-research', '2分钟之后，总结reddit关于ai的热点信息，发给我')).toBe(true);
        expect(shouldSuppressTriggeredSkillForScheduling('stock-research', '帮我分析一下股票')).toBe(false);
    });

    test('builds recurring scheduling directive for recurring execution requests', () => {
        const directive = getSchedulingDirective('每小时检查一次邮箱并总结未读');
        expect(directive).toContain('scheduled_task_create');
        expect(directive).toContain('scheduleType: "interval"');
    });

    test('builds one-off scheduling directive for delayed execution requests', () => {
        const directive = getSchedulingDirective('2分钟之后，总结reddit关于ai的热点信息，发给我');
        expect(directive).toContain('scheduled_task_create');
        expect(directive).toContain('scheduleType: "date"');
        expect(directive).not.toContain('Use `set_reminder` only for one-off reminder requests.');
    });

    test('does not build scheduling directive for pure reminders', () => {
        expect(getSchedulingDirective('提醒我明天开会')).toBe('');
    });
});
