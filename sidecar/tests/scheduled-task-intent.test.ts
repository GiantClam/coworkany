import { describe, expect, test } from 'bun:test';
import { detectScheduledIntent } from '../src/scheduling/scheduledTasks';

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
});
