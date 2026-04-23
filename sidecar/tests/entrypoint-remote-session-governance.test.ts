import { describe, expect, test } from 'bun:test';
import {
    DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY,
    type RemoteSessionGovernancePolicy,
} from '../src/mastra/remoteSessionGovernance';
import { createEntrypointRemoteSessionGovernanceEvaluator } from '../src/mastra/entrypointRemoteSessionGovernance';
import type { RemoteSessionState } from '../src/mastra/remoteSessionStore';

function createEvaluator(input?: {
    policy?: Partial<RemoteSessionGovernancePolicy>;
    nowIso?: string;
    states?: Record<string, RemoteSessionState>;
}) {
    const policy: RemoteSessionGovernancePolicy = {
        ...DEFAULT_REMOTE_SESSION_GOVERNANCE_POLICY,
        ...(input?.policy ?? {}),
    };
    const statesById = new Map<string, RemoteSessionState>(
        Object.entries(input?.states ?? {}),
    );
    return createEntrypointRemoteSessionGovernanceEvaluator({
        remoteSessionGovernancePolicy: policy,
        parseRemoteSessionScope: (_payload, metadata) => {
            const scope = metadata?.scope;
            return scope === 'managed' ? 'managed' : 'project';
        },
        pickRemoteTenantId: (metadata) => {
            return typeof metadata?.tenantId === 'string' ? metadata.tenantId : undefined;
        },
        pickRemoteEndpointId: (metadata) => {
            return typeof metadata?.endpointId === 'string' ? metadata.endpointId : undefined;
        },
        pickTenantFromPayloadOrMetadata: (payload) => {
            if (typeof payload.tenantId === 'string') {
                return payload.tenantId;
            }
            const metadata = payload.metadata as Record<string, unknown> | undefined;
            return typeof metadata?.tenantId === 'string' ? metadata.tenantId : undefined;
        },
        resolveRemoteSessionState: (remoteSessionId) => statesById.get(remoteSessionId),
        getNowIso: () => input?.nowIso ?? '2026-04-23T00:00:00.000Z',
    });
}

describe('entrypointRemoteSessionGovernance', () => {
    test('requires tenant id for managed sessions when policy demands it', () => {
        const evaluator = createEvaluator({
            policy: {
                requireTenantIdForManaged: true,
            },
        });
        const decision = evaluator.evaluateRemoteSessionGovernance({
            remoteSessionId: 'remote-1',
            targetTaskId: 'task-1',
            scope: 'managed',
            metadata: {
                endpointId: 'endpoint-1',
            },
        });
        expect(decision.allowed).toBe(false);
        expect(decision.error).toBe('remote_session_tenant_required');
    });

    test('allows stale takeover for takeover_if_stale strategy', () => {
        const evaluator = createEvaluator({
            policy: {
                conflictStrategy: 'takeover_if_stale',
                staleAfterMs: 1_000,
            },
            nowIso: '2026-04-23T00:00:05.000Z',
            states: {
                'remote-1': {
                    remoteSessionId: 'remote-1',
                    taskId: 'task-existing',
                    status: 'active',
                    linkedAt: '2026-04-23T00:00:00.000Z',
                    lastSeenAt: '2026-04-23T00:00:00.000Z',
                    metadata: {
                        endpointId: 'endpoint-existing',
                    },
                },
            },
        });
        const decision = evaluator.evaluateRemoteSessionGovernance({
            remoteSessionId: 'remote-1',
            targetTaskId: 'task-new',
            scope: 'project',
            metadata: {
                endpointId: 'endpoint-new',
            },
        });
        expect(decision.allowed).toBe(true);
        expect(decision.arbitration?.action).toBe('takeover_stale');
        expect(decision.arbitration?.previousTaskId).toBe('task-existing');
        expect(decision.arbitration?.staleMs).toBe(5_000);
    });

    test('blocks active endpoint conflict when endpoint isolation is enabled', () => {
        const evaluator = createEvaluator({
            policy: {
                conflictStrategy: 'takeover_if_stale',
                staleAfterMs: 30_000,
                enforceEndpointIsolation: true,
            },
            nowIso: '2026-04-23T00:00:05.000Z',
            states: {
                'remote-1': {
                    remoteSessionId: 'remote-1',
                    taskId: 'task-1',
                    status: 'active',
                    linkedAt: '2026-04-23T00:00:00.000Z',
                    lastSeenAt: '2026-04-23T00:00:04.800Z',
                    metadata: {
                        endpointId: 'endpoint-existing',
                    },
                },
            },
        });
        const decision = evaluator.evaluateRemoteSessionGovernance({
            remoteSessionId: 'remote-1',
            targetTaskId: 'task-1',
            scope: 'project',
            metadata: {
                endpointId: 'endpoint-new',
            },
        });
        expect(decision.allowed).toBe(false);
        expect(decision.error).toBe('remote_session_endpoint_conflict_active');
    });

    test('managed tenant command governance enforces tenant match', () => {
        const evaluator = createEvaluator({
            policy: {
                requireTenantIdForManagedCommands: true,
            },
            states: {
                'remote-1': {
                    remoteSessionId: 'remote-1',
                    taskId: 'task-1',
                    status: 'active',
                    linkedAt: '2026-04-23T00:00:00.000Z',
                    lastSeenAt: '2026-04-23T00:00:00.000Z',
                    metadata: {
                        scope: 'managed',
                        tenantId: 'tenant-1',
                    },
                },
            },
        });

        const missing = evaluator.evaluateManagedTenantCommandGovernance({}, 'remote-1');
        expect(missing.allowed).toBe(false);
        if (!missing.allowed) {
            expect(missing.error).toBe('remote_session_tenant_command_required');
        }

        const mismatch = evaluator.evaluateManagedTenantCommandGovernance({ tenantId: 'tenant-2' }, 'remote-1');
        expect(mismatch.allowed).toBe(false);
        if (!mismatch.allowed) {
            expect(mismatch.error).toBe('remote_session_tenant_command_mismatch');
        }

        const ok = evaluator.evaluateManagedTenantCommandGovernance({ tenantId: 'tenant-1' }, 'remote-1');
        expect(ok).toEqual({ allowed: true });
    });
});
