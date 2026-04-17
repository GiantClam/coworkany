import { describe, expect, test } from 'bun:test';
import { resolveSubagentFollowupMessage, SUBAGENT_FOLLOWUP_CONTRACT_MARKER } from '../src/mastra/subagentMessageRouter';
import type { TaskRuntimeState } from '../src/mastra/taskRuntimeState';

function buildTaskState(): TaskRuntimeState {
    return {
        taskId: 'task-1',
        conversationThreadId: 'thread-1',
        title: 'Task',
        workspacePath: '/tmp/ws',
        createdAt: '2026-04-14T00:00:00.000Z',
        status: 'idle',
        resourceId: 'employee-task-1',
        agentTasks: [
            {
                taskId: 'agent-subtask-1',
                status: 'running',
                summary: 'Investigating issue',
                startedAt: '2026-04-14T00:00:10.000Z',
                updatedAt: '2026-04-14T00:00:10.000Z',
            },
        ],
    };
}

describe('subagent message router', () => {
    test('resolves routed follow-up message for an addressable subagent task', () => {
        const taskStates = new Map<string, TaskRuntimeState>([['task-1', buildTaskState()]]);
        const result = resolveSubagentFollowupMessage({
            payload: {
                taskId: 'task-1',
                subagentTaskId: 'agent-subtask-1',
                content: '继续分析并给出结论',
            },
            taskStates,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) {
            throw new Error('expected resolved result');
        }
        expect(result.content.startsWith('__route_task__')).toBe(true);
        expect(result.content).toContain(SUBAGENT_FOLLOWUP_CONTRACT_MARKER);
        expect(result.content).toContain('target_subagent_task_id=agent-subtask-1');
        expect(result.content).toContain('继续分析并给出结论');
    });

    test('returns subagent_not_found with available candidates', () => {
        const taskStates = new Map<string, TaskRuntimeState>([['task-1', buildTaskState()]]);
        const result = resolveSubagentFollowupMessage({
            payload: {
                taskId: 'task-1',
                subagentTaskId: 'agent-subtask-unknown',
                content: '继续',
            },
            taskStates,
        });
        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('expected subagent_not_found');
        }
        expect(result.error).toBe('subagent_not_found');
        expect(result.availableSubagentTaskIds).toEqual(['agent-subtask-1']);
    });

    test('returns invalid payload when required fields are missing', () => {
        const taskStates = new Map<string, TaskRuntimeState>([['task-1', buildTaskState()]]);
        const result = resolveSubagentFollowupMessage({
            payload: {
                taskId: 'task-1',
                content: '',
            },
            taskStates,
        });
        expect(result.ok).toBe(false);
        if (result.ok) {
            throw new Error('expected invalid payload');
        }
        expect(result.error).toBe('invalid_payload');
    });
});
