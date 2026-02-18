import { describe, expect, test } from 'bun:test';
import { recoverMainLoopToolFailure } from '../mainLoopRecovery';

describe('Main loop failure recovery', () => {
    test('injects self-learning suggestion after threshold failures', async () => {
        const toolErrorTracker = new Map<string, number>();
        let quickLearnCalled = 0;

        const result = await recoverMainLoopToolFailure({
            errorResult: 'database timeout',
            toolName: 'database_query',
            toolArgs: { connection: 'main', query: 'select 1' },
            lastUserQuery: '查询数据库是否可用',
            consecutiveToolErrors: 1,
            toolErrorTracker,
            selfLearningThreshold: 2,
            formatErrorForAI: (stderr) => `ENHANCED: ${stderr}`,
            quickLearnFromError: async () => {
                quickLearnCalled++;
                return {
                    learned: true,
                    suggestion: 'Use a shorter timeout and verify DB host/port before retry.',
                };
            },
            logger: {
                log: () => undefined,
                error: () => undefined,
            },
        });

        expect(quickLearnCalled).toBe(1);
        expect(result.consecutiveToolErrors).toBe(2);
        expect(result.result).toContain('ENHANCED: database timeout');
        expect(result.result).toContain('[Self-Learning Recovery]');
        expect(result.result).toContain('verify DB host/port');
        expect(toolErrorTracker.get('database_query')).toBe(1);
    });

    test('returns enhanced error only when below threshold', async () => {
        const toolErrorTracker = new Map<string, number>();
        let quickLearnCalled = 0;

        const result = await recoverMainLoopToolFailure({
            errorResult: { error: 'network refused' },
            toolName: 'search_web',
            toolArgs: { query: 'postgres connect refused' },
            lastUserQuery: '搜索数据库连接失败解决方案',
            consecutiveToolErrors: 0,
            toolErrorTracker,
            selfLearningThreshold: 2,
            formatErrorForAI: () => 'FORMATTED_ERROR',
            quickLearnFromError: async () => {
                quickLearnCalled++;
                return { learned: false };
            },
            logger: {
                log: () => undefined,
                error: () => undefined,
            },
        });

        expect(quickLearnCalled).toBe(0);
        expect(result.consecutiveToolErrors).toBe(1);
        expect(result.result).toBe('FORMATTED_ERROR');
        expect(toolErrorTracker.get('search_web')).toBe(1);
    });
});
