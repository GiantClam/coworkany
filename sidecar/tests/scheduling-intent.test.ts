import { describe, expect, test } from 'bun:test';
import {
    getSchedulingDirective,
    isRecurringScheduleRequest,
    shouldSuppressTriggeredSkillForScheduling,
} from '../src/agent/schedulingIntent';

describe('scheduling intent', () => {
    test('detects chinese recurring schedule phrases', () => {
        expect(isRecurringScheduleRequest('每小时帮我搜索一次 AI 新闻并回复我')).toBe(true);
        expect(isRecurringScheduleRequest('定时帮我检查邮箱')).toBe(true);
        expect(isRecurringScheduleRequest('每天早上 8 点提醒我开会')).toBe(true);
    });

    test('detects english recurring schedule phrases', () => {
        expect(isRecurringScheduleRequest('every hour check the inbox and tell me')).toBe(true);
        expect(isRecurringScheduleRequest('create a recurring task to run daily')).toBe(true);
        expect(isRecurringScheduleRequest('use cron to run this every week')).toBe(true);
    });

    test('does not flag one-off requests as recurring', () => {
        expect(isRecurringScheduleRequest('提醒我明天下午三点开会')).toBe(false);
        expect(isRecurringScheduleRequest('帮我分析一下英伟达股票')).toBe(false);
    });

    test('suppresses stock research auto-trigger for recurring requests', () => {
        expect(shouldSuppressTriggeredSkillForScheduling('stock-research', '每小时帮我看一下股票新闻')).toBe(true);
        expect(shouldSuppressTriggeredSkillForScheduling('stock-research', '帮我分析一下股票')).toBe(false);
    });

    test('builds scheduling directive only for recurring requests', () => {
        expect(getSchedulingDirective('每小时检查一次邮箱')).toContain('scheduled_task_create');
        expect(getSchedulingDirective('提醒我明天开会')).toBe('');
    });
});
