import { describe, expect, test } from 'bun:test';
import { computeNextRecurringExecuteAt, detectScheduledIntent } from '../src/scheduling/scheduledTasks';

describe('scheduled task intent parsing', () => {
    test('strips chinese voice directive variants without leaving dangling task text', () => {
        const parsed = detectScheduledIntent(
            '1分钟后，整理 10 篇高价值的reddit 上 AI 独立开发者相关的内容，例如 ai saas 产品、ai 使用经验、openclaw 等，并将结果用语音播报给我',
            new Date('2026-03-18T09:13:52+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe(
            '整理 10 篇高价值的reddit 上 AI 独立开发者相关的内容，例如 ai saas 产品、ai 使用经验、openclaw 等'
        );
        expect(parsed?.speakResult).toBe(true);
    });

    test('supports additional result-reading phrasings', () => {
        const parsed = detectScheduledIntent(
            '20秒后，只回复：HELLO，并把结果朗读给我听',
            new Date('2026-03-18T09:10:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('只回复：HELLO');
        expect(parsed?.speakResult).toBe(true);
    });

    test('removes speech directive even when followed by more task constraints', () => {
        const parsed = detectScheduledIntent(
            '20秒后，整理 3 篇 Reddit 内容，并将结果用语音播报给我。每篇只保留标题和一句启发。',
            new Date('2026-03-18T09:25:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('整理 3 篇 Reddit 内容。每篇只保留标题和一句启发。');
        expect(parsed?.speakResult).toBe(true);
    });

    test('supports chinese time expressions ending with 以后', () => {
        const parsed = detectScheduledIntent(
            '1 分钟以后，查询 minimax 的股价，给出深度分析',
            new Date('2026-03-20T09:17:12+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('查询 minimax 的股价，给出深度分析');
        expect(parsed?.speakResult).toBe(false);
        expect(parsed?.originalTimeExpression).toBe('1分钟以后');
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-20T01:18:12.000Z');
    });

    test('supports chinese time expressions ending with 之后', () => {
        const parsed = detectScheduledIntent(
            '1 分钟之后，查询 minimax 的股价，给出深度分析',
            new Date('2026-03-20T09:17:12+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('查询 minimax 的股价，给出深度分析');
        expect(parsed?.speakResult).toBe(false);
        expect(parsed?.originalTimeExpression).toBe('1分钟之后');
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-20T01:18:12.000Z');
    });

    test('supports explicit scheduled-task preamble before chinese relative time', () => {
        const parsed = detectScheduledIntent(
            '创建定时任务，1 分钟之后检索 openai 为什么关闭 sora，深度分析后回复我',
            new Date('2026-03-25T10:12:31+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('检索 openai 为什么关闭 sora，深度分析后回复我');
        expect(parsed?.speakResult).toBe(false);
        expect(parsed?.originalTimeExpression).toBe('1分钟之后');
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-25T02:13:31.000Z');
    });

    test('supports english scheduled-task preamble before english relative time', () => {
        const parsed = detectScheduledIntent(
            'Create scheduled task: in 2 minutes, summarize OpenAI release notes.',
            new Date('2026-03-25T10:00:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('summarize OpenAI release notes.');
        expect(parsed?.originalTimeExpression).toBe('in 2 minutes');
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-25T02:02:00.000Z');
    });

    test('extracts chained scheduled follow-up stages instead of folding them into constraints', () => {
        const parsed = detectScheduledIntent(
            '1 分钟以后，检索特朗普和伊朗是否有沟通停战的可能性，将结果保存到文件中。然后再等 1 分钟，将分析结果发布到 X 上',
            new Date('2026-03-23T21:34:08+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('检索特朗普和伊朗是否有沟通停战的可能性，将结果保存到文件中');
        expect(parsed?.chainedStages).toHaveLength(1);
        expect(parsed?.chainedStages?.[0]).toMatchObject({
            taskQuery: '分析结果发布到 X 上',
            originalTimeExpression: '1分钟',
            delayMsFromPrevious: 60_000,
        });
    });

    test('detects recurring chinese interval scheduling intent', () => {
        const parsed = detectScheduledIntent(
            '创建定时任务，从现在开始，每5分钟提醒我喝水',
            new Date('2026-03-25T10:00:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('提醒我喝水');
        expect(parsed?.recurrence).toEqual({ kind: 'rrule', value: 'FREQ=MINUTELY;INTERVAL=5' });
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-25T02:00:00.000Z');
    });

    test('defaults recurring chinese interval amount to 1 when omitted', () => {
        const parsed = detectScheduledIntent(
            '创建定时任务，每分钟叫我喝水一次',
            new Date('2026-03-25T10:00:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('叫我喝水一次');
        expect(parsed?.recurrence).toEqual({ kind: 'rrule', value: 'FREQ=MINUTELY;INTERVAL=1' });
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-25T02:00:00.000Z');
    });

    test('detects recurring english interval scheduling intent', () => {
        const parsed = detectScheduledIntent(
            'Create scheduled task: every 2 hours remind me to stretch.',
            new Date('2026-03-25T10:00:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('remind me to stretch.');
        expect(parsed?.recurrence).toEqual({ kind: 'rrule', value: 'FREQ=HOURLY;INTERVAL=2' });
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-25T02:00:00.000Z');
    });

    test('respects explicit start time for recurring chinese interval scheduling intent', () => {
        const parsed = detectScheduledIntent(
            '创建定时任务，10分钟后开始，每5分钟提醒我喝水',
            new Date('2026-03-25T10:00:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('提醒我喝水');
        expect(parsed?.recurrence).toEqual({ kind: 'rrule', value: 'FREQ=MINUTELY;INTERVAL=5' });
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-25T02:10:00.000Z');
    });

    test('respects explicit start time for recurring english interval scheduling intent', () => {
        const parsed = detectScheduledIntent(
            'Create scheduled task: in 30 minutes every 2 hours remind me to stretch.',
            new Date('2026-03-25T10:00:00+08:00')
        );

        expect(parsed).not.toBeNull();
        expect(parsed?.taskQuery).toBe('remind me to stretch.');
        expect(parsed?.recurrence).toEqual({ kind: 'rrule', value: 'FREQ=HOURLY;INTERVAL=2' });
        expect(parsed?.executeAt.toISOString()).toBe('2026-03-25T02:30:00.000Z');
    });

    test('computes the next recurring execution time from rrule interval', () => {
        const next = computeNextRecurringExecuteAt({
            recurrence: { kind: 'rrule', value: 'FREQ=MINUTELY;INTERVAL=5' },
            previousExecuteAt: '2026-03-25T02:00:00.000Z',
            now: new Date('2026-03-25T02:12:30.000Z'),
        });

        expect(next?.toISOString()).toBe('2026-03-25T02:15:00.000Z');
    });
});
