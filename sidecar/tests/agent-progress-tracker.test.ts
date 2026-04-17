import { describe, expect, test } from 'bun:test';
import { buildAgentTaskProgressSnapshot } from '../src/mastra/agentProgressTracker';
import type { TaskRuntimeAgentTask } from '../src/mastra/taskRuntimeState';

describe('agent progress tracker', () => {
    test('aggregates task status counts and usage totals', () => {
        const tasks: TaskRuntimeAgentTask[] = [
            {
                taskId: 'a',
                status: 'running',
                summary: 'running',
                updatedAt: '2026-04-14T00:00:00.000Z',
                usage: { totalTokens: 10, toolUses: 1, durationMs: 50 },
            },
            {
                taskId: 'b',
                status: 'completed',
                summary: 'done',
                updatedAt: '2026-04-14T00:00:10.000Z',
                usage: { totalTokens: 20, toolUses: 2, durationMs: 70 },
            },
            {
                taskId: 'c',
                status: 'failed',
                summary: 'failed',
                updatedAt: '2026-04-14T00:00:20.000Z',
            },
        ];
        const progress = buildAgentTaskProgressSnapshot({
            agentTasks: tasks,
            at: '2026-04-14T00:00:21.000Z',
        });
        expect(progress).toBeDefined();
        expect(progress?.total).toBe(3);
        expect(progress?.running).toBe(1);
        expect(progress?.completed).toBe(1);
        expect(progress?.failed).toBe(1);
        expect(progress?.killed).toBe(0);
        expect(progress?.terminal).toBe(2);
        expect(progress?.usageTotals?.totalTokens).toBe(30);
        expect(progress?.usageTotals?.toolUses).toBe(3);
        expect(progress?.usageTotals?.durationMs).toBe(120);
    });

    test('tracks latest notification and bounded recent activity', () => {
        const initial = buildAgentTaskProgressSnapshot({
            agentTasks: [],
            previous: {
                total: 0,
                running: 0,
                completed: 0,
                failed: 0,
                killed: 0,
                terminal: 0,
                lastUpdatedAt: '2026-04-14T00:00:00.000Z',
                recentActivity: [
                    {
                        taskId: 'x',
                        status: 'running',
                        summary: 'x',
                        at: '2026-04-14T00:00:00.000Z',
                    },
                ],
            },
            latestNotification: {
                taskId: 'y',
                status: 'completed',
                summary: 'y done',
            },
            at: '2026-04-14T00:00:01.000Z',
            maxRecentActivity: 1,
        });
        expect(initial?.lastEvent?.taskId).toBe('y');
        expect(initial?.recentActivity).toHaveLength(1);
        expect(initial?.recentActivity[0]?.taskId).toBe('y');
    });

    test('returns undefined when no data exists', () => {
        const progress = buildAgentTaskProgressSnapshot({
            agentTasks: [],
            at: '2026-04-14T00:00:00.000Z',
        });
        expect(progress).toBeUndefined();
    });
});
