import { describe, expect, test } from 'bun:test';
import { handleEntrypointFollowupCorrection } from '../src/mastra/entrypointFollowupCorrection';

describe('entrypointFollowupCorrection', () => {
    test('ignores non-send_task_message commands', () => {
        const handled = handleEntrypointFollowupCorrection({
            commandType: 'start_task',
            commandId: 'cmd-1',
            payload: {},
            getString: () => null,
            getTaskState: () => undefined,
            getLegacyDeliverables: () => undefined,
            setLegacyDeliverables: () => undefined,
            extractSaveTargetFromMessage: () => null,
            emitTaskEvent: () => undefined,
            upsertTaskState: () => ({}),
            buildTaskTurnContract: () => ({}),
            emitFor: () => undefined,
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            defaultWorkspacePath: () => '/tmp',
        });

        expect(handled).toBe(false);
    });

    test('reopens finished task contract when follow-up changes deliverable path', () => {
        const emittedTaskEvents: Array<{ type: string; taskId: string; payload: Record<string, unknown> }> = [];
        const emittedResponses: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const deliverablesByTaskId = new Map<string, string[]>();
        let updatedState: Record<string, unknown> | null = null;

        const handled = handleEntrypointFollowupCorrection({
            commandType: 'send_task_message',
            commandId: 'cmd-2',
            payload: {
                taskId: 'task-1',
                content: 'Actually, save it to reports/new.md',
            },
            getString: (value) => (typeof value === 'string' ? value : null),
            getTaskState: () => ({
                status: 'finished',
                workspacePath: '/workspace',
                lastUserMessage: 'Save it to reports/old.md',
            }),
            getLegacyDeliverables: (taskId) => deliverablesByTaskId.get(taskId),
            setLegacyDeliverables: (taskId, deliverables) => {
                deliverablesByTaskId.set(taskId, deliverables);
            },
            extractSaveTargetFromMessage: (message) => {
                if (message?.includes('new.md')) {
                    return 'reports/new.md';
                }
                if (message?.includes('old.md')) {
                    return 'reports/old.md';
                }
                return null;
            },
            emitTaskEvent: (taskId, type, payload) => {
                emittedTaskEvents.push({ taskId, type, payload });
            },
            upsertTaskState: (_taskId, patch) => {
                updatedState = patch;
                return patch;
            },
            buildTaskTurnContract: (input) => ({
                mode: input.mode,
                route: input.route,
                message: input.message,
            }),
            emitFor: (type, payload) => {
                emittedResponses.push({ type, payload });
            },
            getNowIso: () => '2026-04-23T00:00:00.000Z',
            defaultWorkspacePath: () => '/tmp',
        });

        expect(handled).toBe(true);
        expect(deliverablesByTaskId.get('task-1')).toEqual(['reports/new.md']);
        expect(emittedTaskEvents.map((event) => event.type)).toEqual([
            'TASK_CONTRACT_REOPENED',
            'TASK_RESEARCH_UPDATED',
            'TASK_PLAN_READY',
        ]);
        expect(updatedState).toMatchObject({
            status: 'idle',
            executionPath: 'direct',
            lastUserMessage: 'Actually, save it to reports/new.md',
        });
        expect(emittedResponses).toEqual([{
            type: 'send_task_message_response',
            payload: {
                success: true,
                taskId: 'task-1',
                accepted: true,
                queuePosition: 0,
                turnId: 'cmd-2',
            },
        }]);
    });
});
