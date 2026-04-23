import { describe, expect, test } from 'bun:test';
import {
    getLatestPendingEffectRequestId,
    hasPendingEffectApproval,
    isSuspendedForApproval,
} from '../src/lib/taskRetryPolicy';

describe('task retry policy', () => {
    test('blocks retry when session is suspended for approval_required', () => {
        expect(isSuspendedForApproval({
            status: 'suspended',
            suspension: {
                reason: 'approval_required',
                userMessage: 'Awaiting approval',
                canAutoResume: false,
            },
        })).toBe(true);
    });

    test('blocks retry when suspension reason contains checkpoint_approval_required', () => {
        expect(isSuspendedForApproval({
            status: 'suspended',
            suspension: {
                reason: 'checkpoint_approval_required',
                userMessage: 'Checkpoint approval needed',
                canAutoResume: false,
            },
        })).toBe(true);
    });

    test('allows retry for other suspended reasons', () => {
        expect(isSuspendedForApproval({
            status: 'suspended',
            suspension: {
                reason: 'provider_retry_timeout',
                userMessage: 'Timed out',
                canAutoResume: false,
            },
        })).toBe(false);
    });

    test('allows retry when session is not suspended', () => {
        expect(isSuspendedForApproval({
            status: 'failed',
            suspension: {
                reason: 'approval_required',
                userMessage: 'Awaiting approval',
                canAutoResume: false,
            },
        })).toBe(false);
    });

    test('approval-suspended session without pending effect request is not pending-approval-blocked', () => {
        const session = {
            status: 'suspended' as const,
            suspension: {
                reason: 'approval_required',
                userMessage: 'Awaiting approval',
                canAutoResume: false,
            },
            effects: [],
            events: [],
        };
        expect(isSuspendedForApproval(session)).toBe(true);
        expect(hasPendingEffectApproval(session)).toBe(false);
        expect(getLatestPendingEffectRequestId(session)).toBeNull();
    });

    test('detects pending effect approval from session effects', () => {
        const session = {
            effects: [
                {
                    requestId: 'req-1',
                    effectType: 'shell:write',
                    riskLevel: 7,
                },
            ],
            events: [],
        };
        expect(hasPendingEffectApproval(session)).toBe(true);
        expect(getLatestPendingEffectRequestId(session)).toBe('req-1');
    });

    test('detects resolved effect approval from events', () => {
        const session = {
            effects: [],
            events: [
                {
                    id: '1',
                    taskId: 'task-1',
                    sequence: 1,
                    timestamp: '2026-01-01T00:00:00.000Z',
                    type: 'EFFECT_REQUESTED',
                    payload: {
                        request: {
                            id: 'req-1',
                            effectType: 'shell:write',
                        },
                        riskLevel: 7,
                    },
                },
                {
                    id: '2',
                    taskId: 'task-1',
                    sequence: 2,
                    timestamp: '2026-01-01T00:00:01.000Z',
                    type: 'EFFECT_APPROVED',
                    payload: {
                        response: {
                            requestId: 'req-1',
                            approved: true,
                        },
                    },
                },
            ],
        };
        expect(hasPendingEffectApproval(session)).toBe(false);
        expect(getLatestPendingEffectRequestId(session)).toBeNull();
    });

    test('detects pending effect approval from events when effects array is empty', () => {
        const session = {
            effects: [],
            events: [
                {
                    id: '1',
                    taskId: 'task-1',
                    sequence: 1,
                    timestamp: '2026-01-01T00:00:00.000Z',
                    type: 'EFFECT_REQUESTED',
                    payload: {
                        request: {
                            id: 'req-1',
                            effectType: 'shell:write',
                        },
                        riskLevel: 7,
                    },
                },
            ],
        };
        expect(hasPendingEffectApproval(session)).toBe(true);
        expect(getLatestPendingEffectRequestId(session)).toBe('req-1');
    });

    test('returns latest pending request id when multiple approvals exist', () => {
        const session = {
            effects: [],
            events: [
                {
                    id: '1',
                    taskId: 'task-1',
                    sequence: 1,
                    timestamp: '2026-01-01T00:00:00.000Z',
                    type: 'EFFECT_REQUESTED',
                    payload: { request: { id: 'req-1', effectType: 'shell:write' }, riskLevel: 7 },
                },
                {
                    id: '2',
                    taskId: 'task-1',
                    sequence: 2,
                    timestamp: '2026-01-01T00:00:01.000Z',
                    type: 'EFFECT_REQUESTED',
                    payload: { request: { id: 'req-2', effectType: 'shell:write' }, riskLevel: 7 },
                },
                {
                    id: '3',
                    taskId: 'task-1',
                    sequence: 3,
                    timestamp: '2026-01-01T00:00:02.000Z',
                    type: 'EFFECT_APPROVED',
                    payload: { response: { requestId: 'req-2', approved: true } },
                },
            ],
        };
        expect(hasPendingEffectApproval(session)).toBe(true);
        expect(getLatestPendingEffectRequestId(session)).toBe('req-1');
    });
});
