import { describe, expect, test } from 'bun:test';
import { isDelegatedAgentToolName, upsertAgentTaskFromNotification } from '../src/mastra/agentTaskStore';

describe('agent task store', () => {
    test('upserts notification lifecycle and keeps startedAt across updates', () => {
        const started = upsertAgentTaskFromNotification({
            existing: [],
            notification: {
                taskId: 'subtask-1',
                status: 'running',
                summary: 'running',
            },
            at: '2026-04-14T00:00:00.000Z',
            runId: 'run-1',
        });

        const completed = upsertAgentTaskFromNotification({
            existing: started,
            notification: {
                taskId: 'subtask-1',
                status: 'completed',
                summary: 'completed',
            },
            at: '2026-04-14T00:00:05.000Z',
            runId: 'run-1',
        });

        expect(completed).toHaveLength(1);
        expect(completed[0]?.status).toBe('completed');
        expect(completed[0]?.startedAt).toBe('2026-04-14T00:00:00.000Z');
        expect(completed[0]?.completedAt).toBe('2026-04-14T00:00:05.000Z');
    });

    test('caps records to configured max size', () => {
        const result = upsertAgentTaskFromNotification({
            existing: [
                {
                    taskId: 'a',
                    status: 'completed',
                    summary: 'a',
                    startedAt: '2026-04-14T00:00:00.000Z',
                    updatedAt: '2026-04-14T00:00:00.000Z',
                    completedAt: '2026-04-14T00:00:00.000Z',
                },
                {
                    taskId: 'b',
                    status: 'completed',
                    summary: 'b',
                    startedAt: '2026-04-14T00:00:01.000Z',
                    updatedAt: '2026-04-14T00:00:01.000Z',
                    completedAt: '2026-04-14T00:00:01.000Z',
                },
            ],
            notification: {
                taskId: 'c',
                status: 'completed',
                summary: 'c',
            },
            at: '2026-04-14T00:00:02.000Z',
            maxRecords: 2,
        });

        expect(result.map((item) => item.taskId)).toEqual(['b', 'c']);
    });

    test('detects delegated agent tool names', () => {
        expect(isDelegatedAgentToolName('agent-researcher')).toBe(true);
        expect(isDelegatedAgentToolName('agent_task_notification')).toBe(true);
        expect(isDelegatedAgentToolName('search_web')).toBe(false);
    });
});
