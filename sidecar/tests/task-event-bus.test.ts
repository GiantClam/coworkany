import { describe, expect, test } from 'bun:test';
import { TaskEventBus } from '../src/execution/taskEventBus';

describe('task event bus', () => {
    test('increments per-task sequence numbers independently and supports reset', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitChatMessage('task-a', { role: 'user', content: 'hello' });
        bus.emitStatus('task-a', { status: 'running' });
        bus.emitChatMessage('task-b', { role: 'system', content: 'world' });
        bus.reset('task-a');
        bus.emitFinished('task-a', { summary: 'done', duration: 5 });

        expect(events.map((event) => [event.taskId, event.sequence, event.type])).toEqual([
            ['task-a', 1, 'CHAT_MESSAGE'],
            ['task-a', 2, 'TASK_STATUS'],
            ['task-b', 1, 'CHAT_MESSAGE'],
            ['task-a', 1, 'TASK_FINISHED'],
        ]);
    });

    test('emits raw task events with generated ids and timestamps', () => {
        let captured: any = null;
        const bus = new TaskEventBus({
            emit: (event) => {
                captured = event;
            },
        });

        bus.emitRaw('task-x', 'TASK_HISTORY_CLEARED', { reason: 'user_requested' });

        expect(captured.taskId).toBe('task-x');
        expect(captured.sequence).toBe(1);
        expect(captured.type).toBe('TASK_HISTORY_CLEARED');
        expect(captured.payload).toEqual({ reason: 'user_requested' });
        expect(typeof captured.id).toBe('string');
        expect(typeof captured.timestamp).toBe('string');
    });

    test('supports explicit sequence overrides without rewinding future sequence numbers', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitChatMessage('task-a', { role: 'user', content: 'hello' });
        bus.emitTextDelta('task-a', { role: 'assistant', delta: 'forced' }, { sequence: 0 });
        bus.emitStatus('task-a', { status: 'finished' }, { sequence: 0 });
        bus.emitRaw('task-a', 'TASK_HISTORY_CLEARED', { reason: 'higher' }, { sequence: 5 });
        bus.emitFinished('task-a', { summary: 'done', duration: 1 });

        expect(events.map((event) => [event.type, event.sequence])).toEqual([
            ['CHAT_MESSAGE', 1],
            ['TEXT_DELTA', 0],
            ['TASK_STATUS', 0],
            ['TASK_HISTORY_CLEARED', 5],
            ['TASK_FINISHED', 6],
        ]);
    });

    test('rewrites TASK_FINISHED to TASK_FAILED when blocking user action is pending', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitUserActionRequired('task-a', {
            actionId: 'action-1',
            title: 'Need approval',
            kind: 'confirm_plan',
            description: 'Approve the plan',
            riskTier: 'high',
            executionPolicy: 'hard_block',
            blocking: true,
            questions: [],
            instructions: [],
        });
        bus.emitFinished('task-a', { summary: 'done', duration: 3 });

        expect(events[0]?.type).toBe('TASK_USER_ACTION_REQUIRED');
        expect(events[1]?.type).toBe('TASK_FAILED');
        expect(events[1]?.payload?.errorCode).toBe('E_PROTOCOL_TERMINAL_CONFLICT');
    });

    test('allows TASK_FINISHED after user action is resolved and status returns to running', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitUserActionRequired('task-a', {
            actionId: 'action-1',
            title: 'Need approval',
            kind: 'confirm_plan',
            description: 'Approve the plan',
            riskTier: 'high',
            executionPolicy: 'hard_block',
            blocking: true,
            questions: [],
            instructions: [],
        });
        bus.emitStatus('task-a', { status: 'running' });
        bus.emitFinished('task-a', { summary: 'done', duration: 3 });

        expect(events.map((event) => event.type)).toEqual([
            'TASK_USER_ACTION_REQUIRED',
            'TASK_STATUS',
            'TASK_FINISHED',
        ]);
    });

    test('rewrites TASK_USER_ACTION_REQUIRED to TASK_FAILED after completion', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitFinished('task-a', { summary: 'done', duration: 1 });
        bus.emitUserActionRequired('task-a', {
            actionId: 'action-2',
            title: 'Need approval',
            kind: 'confirm_plan',
            description: 'Approve the plan',
            riskTier: 'high',
            executionPolicy: 'hard_block',
            blocking: true,
            questions: [],
            instructions: [],
        });

        expect(events[0]?.type).toBe('TASK_FINISHED');
        expect(events[1]?.type).toBe('TASK_FAILED');
        expect(events[1]?.payload?.errorCode).toBe('E_PROTOCOL_INVALID_TRANSITION');
    });

    test('allows follow-up contract reopen and plan-ready after a failed terminal state', () => {
        const events: any[] = [];
        const bus = new TaskEventBus({
            emit: (event) => {
                events.push(event);
            },
        });

        bus.emitFailed('task-a', {
            error: 'artifact unmet',
            recoverable: true,
            errorCode: 'ARTIFACT_CONTRACT_UNMET',
        });
        bus.emitContractReopened('task-a', {
            summary: 'Follow-up changed scope.',
            reason: 'Follow-up changed scope.',
            trigger: 'new_scope_signal',
        });
        bus.emitPlanReady('task-a', {
            summary: 'Plan ready after follow-up.',
            deliverables: [],
            checkpoints: [],
            userActionsRequired: [],
            missingInfo: [],
        });

        expect(events.map((event) => event.type)).toEqual([
            'TASK_FAILED',
            'TASK_CONTRACT_REOPENED',
            'TASK_PLAN_READY',
        ]);
    });
});
