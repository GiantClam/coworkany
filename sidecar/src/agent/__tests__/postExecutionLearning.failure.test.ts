import { describe, expect, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { createPostExecutionLearningManager } from '../postExecutionLearning';

function makeEvent(type: string, payload: Record<string, unknown>, taskId: string) {
    return {
        id: randomUUID(),
        taskId,
        timestamp: new Date().toISOString(),
        sequence: 1,
        type,
        payload,
    } as any;
}

describe('PostExecutionLearningManager failure recovery', () => {
    test('triggers quickLearnFromError for actionable database failures', async () => {
        const precipitateCalls: Array<{ knowledge: any; experiment: any }> = [];
        const quickLearnCalls: Array<{ error: string; query: string; attempts: number }> = [];

        const manager = createPostExecutionLearningManager(
            {
                precipitate: async (knowledge: any, experiment: any) => {
                    precipitateCalls.push({ knowledge, experiment });
                    return {
                        success: true,
                        type: 'knowledge_entry',
                        path: '/tmp/failure.md',
                        entityId: 'failed-test',
                    };
                },
            } as any,
            {
                recordUsage: () => undefined,
            } as any,
            {
                minToolCallsForSkill: 1,
                minDurationForLearning: 0,
                valueKeywords: ['database'],
            }
        );

        manager.setSelfLearningController({
            quickLearnFromError: async (errorMessage: string, originalQuery: string, attemptCount: number) => {
                quickLearnCalls.push({ error: errorMessage, query: originalQuery, attempts: attemptCount });
                return {
                    learned: true,
                    suggestion: 'Use sqlite3 --json and validate DB path before query.',
                };
            },
        } as any);

        const taskId = randomUUID();

        manager.handleEvent(makeEvent('TASK_STARTED', {
            title: 'db op',
            context: { userQuery: '请帮我查询数据库用户信息' },
        }, taskId));

        manager.handleEvent(makeEvent('TOOL_CALLED', {
            toolName: 'database_query',
            args: { connection: 'default', query: 'select * from users' },
        }, taskId));

        manager.handleEvent(makeEvent('TOOL_RESULT', {
            success: false,
            result: { error: 'database connection refused: timeout' },
        }, taskId));

        manager.handleEvent(makeEvent('TASK_FAILED', {
            error: 'query failed',
            recoverable: true,
            duration: 1200,
        }, taskId));

        // analyzeFailure runs asynchronously via void call in handleEvent
        await new Promise(resolve => setTimeout(resolve, 20));

        expect(quickLearnCalls.length).toBe(1);
        expect(quickLearnCalls[0]?.query).toContain('数据库');
        expect(quickLearnCalls[0]?.error).toContain('database');

        // Ensure failure knowledge is still precipitated for future reuse
        expect(precipitateCalls.length).toBe(1);
        expect(precipitateCalls[0]?.knowledge?.type).toBe('failure_knowledge');
    });
});
