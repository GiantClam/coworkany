import { describe, expect, test } from 'bun:test';
import {
    createInitialTaskProtocolStateSnapshot,
    reduceTaskProtocolState,
} from '../src/mastra/taskRuntime/taskProtocolStateMachine';

describe('taskProtocolStateMachine', () => {
    test('marks blocking user actions as pending and clears on running status', () => {
        const initial = createInitialTaskProtocolStateSnapshot();
        const withBlockingAction = reduceTaskProtocolState(initial, {
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: {
                blocking: true,
            },
        });
        expect(withBlockingAction.nextState.pendingBlockingAction).toBe(true);
        expect(withBlockingAction.nextState.pendingBlockingUserActions).toBe(1);

        const resumed = reduceTaskProtocolState(withBlockingAction.nextState, {
            type: 'TASK_STATUS',
            payload: {
                status: 'running',
            },
        });
        expect(resumed.nextState.pendingBlockingAction).toBe(false);
        expect(resumed.nextState.pendingBlockingUserActions).toBe(0);
    });

    test('rewrites TASK_FINISHED when blocking action is still pending', () => {
        const pending = reduceTaskProtocolState(createInitialTaskProtocolStateSnapshot(), {
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: { blocking: true },
        });
        const reduction = reduceTaskProtocolState(pending.nextState, {
            type: 'TASK_FINISHED',
            payload: {},
        });

        expect(reduction.violation?.rewriteType).toBe('TASK_FAILED');
        expect(reduction.violation?.payload.errorCode).toBe('E_PROTOCOL_TERMINAL_CONFLICT');
        expect(reduction.nextState.terminal).toBe('failed');
    });

    test('rejects post-terminal TASK_USER_ACTION_REQUIRED transitions', () => {
        const finished = reduceTaskProtocolState(createInitialTaskProtocolStateSnapshot(), {
            type: 'TASK_FINISHED',
            payload: {},
        });
        const reduction = reduceTaskProtocolState(finished.nextState, {
            type: 'TASK_USER_ACTION_REQUIRED',
            payload: { blocking: true },
        });

        expect(reduction.violation?.rewriteType).toBe('TASK_FAILED');
        expect(reduction.violation?.payload.errorCode).toBe('E_PROTOCOL_INVALID_TRANSITION');
        expect(reduction.nextState.terminal).toBe('failed');
    });

    test('increments state version on every reduction', () => {
        const initial = createInitialTaskProtocolStateSnapshot();
        const step1 = reduceTaskProtocolState(initial, {
            type: 'TASK_STATUS',
            payload: { status: 'running' },
        });
        const step2 = reduceTaskProtocolState(step1.nextState, {
            type: 'TASK_FINISHED',
            payload: {},
        });

        expect(step1.nextState.stateVersion).toBe(1);
        expect(step2.nextState.stateVersion).toBe(2);
    });
});
