import type { RemoteSessionGovernancePolicy } from './remoteSessionGovernance';
import type { RemoteSessionState } from './remoteSessionStore';

type RemoteSessionScope = 'managed' | 'project' | 'user';
type RemoteSessionArbitrationAction = 'none' | 'takeover' | 'takeover_stale';

type RemoteSessionArbitration = {
    action: RemoteSessionArbitrationAction;
    previousTaskId?: string;
    previousEndpointId?: string;
    staleMs?: number;
};

type CreateEntrypointRemoteSessionGovernanceEvaluatorInput = {
    remoteSessionGovernancePolicy: RemoteSessionGovernancePolicy;
    parseRemoteSessionScope: (
        payload: Record<string, unknown>,
        metadata?: Record<string, unknown>,
    ) => RemoteSessionScope;
    pickRemoteTenantId: (metadata?: Record<string, unknown>) => string | undefined;
    pickRemoteEndpointId: (metadata?: Record<string, unknown>) => string | undefined;
    pickTenantFromPayloadOrMetadata: (payload: Record<string, unknown>) => string | undefined;
    resolveRemoteSessionState: (remoteSessionId: string) => RemoteSessionState | undefined;
    getNowIso: () => string;
};

export function createEntrypointRemoteSessionGovernanceEvaluator(
    input: CreateEntrypointRemoteSessionGovernanceEvaluatorInput,
) {
    const evaluateRemoteSessionGovernance = (request: {
        remoteSessionId: string;
        targetTaskId: string;
        scope: RemoteSessionScope;
        metadata?: Record<string, unknown>;
    }): {
        allowed: boolean;
        error?: string;
        existingState?: RemoteSessionState;
        arbitration?: RemoteSessionArbitration;
    } => {
        const existingState = input.resolveRemoteSessionState(request.remoteSessionId);
        const targetTenantId = input.pickRemoteTenantId(request.metadata);
        const targetEndpointId = input.pickRemoteEndpointId(request.metadata);
        const existingScope = existingState
            ? input.parseRemoteSessionScope({}, existingState.metadata)
            : null;
        const managedContext = request.scope === 'managed' || existingScope === 'managed';
        if (
            input.remoteSessionGovernancePolicy.requireTenantIdForManaged
            && managedContext
            && !targetTenantId
        ) {
            return {
                allowed: false,
                error: 'remote_session_tenant_required',
                existingState,
            };
        }
        if (
            input.remoteSessionGovernancePolicy.requireEndpointIdForManaged
            && managedContext
            && !targetEndpointId
        ) {
            return {
                allowed: false,
                error: 'remote_session_endpoint_required',
                existingState,
            };
        }
        if (!existingState || existingState.status !== 'active') {
            return {
                allowed: true,
                existingState,
                arbitration: {
                    action: 'none',
                },
            };
        }
        const existingTenantId = input.pickRemoteTenantId(existingState.metadata);
        const existingEndpointId = input.pickRemoteEndpointId(existingState.metadata);
        if (
            input.remoteSessionGovernancePolicy.enforceManagedIdentityImmutable
            && managedContext
        ) {
            if (
                existingTenantId
                && targetTenantId
                && existingTenantId !== targetTenantId
            ) {
                return {
                    allowed: false,
                    error: 'remote_session_tenant_conflict_immutable',
                    existingState,
                };
            }
            if (
                existingEndpointId
                && targetEndpointId
                && existingEndpointId !== targetEndpointId
            ) {
                return {
                    allowed: false,
                    error: 'remote_session_endpoint_conflict_immutable',
                    existingState,
                };
            }
        }
        if (
            input.remoteSessionGovernancePolicy.enforceTenantIsolation
            && existingTenantId
            && targetTenantId
            && existingTenantId !== targetTenantId
        ) {
            return {
                allowed: false,
                error: 'remote_session_tenant_conflict',
                existingState,
            };
        }
        const crossTaskConflict = existingState.taskId !== request.targetTaskId;
        const endpointConflict = (
            input.remoteSessionGovernancePolicy.enforceEndpointIsolation
            && !crossTaskConflict
            && existingEndpointId
            && targetEndpointId
            && existingEndpointId !== targetEndpointId
        );
        if (!crossTaskConflict && !endpointConflict) {
            return {
                allowed: true,
                existingState,
                arbitration: {
                    action: 'none',
                },
            };
        }
        if (input.remoteSessionGovernancePolicy.conflictStrategy === 'takeover') {
            return {
                allowed: true,
                existingState,
                arbitration: {
                    action: 'takeover',
                    previousTaskId: existingState.taskId,
                    previousEndpointId: existingEndpointId,
                },
            };
        }
        if (input.remoteSessionGovernancePolicy.conflictStrategy === 'takeover_if_stale') {
            const lastSeenAtMs = Date.parse(existingState.lastSeenAt);
            const nowMs = Date.parse(input.getNowIso());
            const staleMs = (
                Number.isFinite(lastSeenAtMs)
                && Number.isFinite(nowMs)
            )
                ? Math.max(0, nowMs - lastSeenAtMs)
                : Number.POSITIVE_INFINITY;
            if (staleMs >= input.remoteSessionGovernancePolicy.staleAfterMs) {
                return {
                    allowed: true,
                    existingState,
                    arbitration: {
                        action: 'takeover_stale',
                        previousTaskId: existingState.taskId,
                        previousEndpointId: existingEndpointId,
                        staleMs,
                    },
                };
            }
            return {
                allowed: false,
                error: endpointConflict
                    ? 'remote_session_endpoint_conflict_active'
                    : 'remote_session_task_conflict_active',
                existingState,
            };
        }
        return {
            allowed: false,
            error: endpointConflict
                ? 'remote_session_endpoint_conflict'
                : 'remote_session_task_conflict',
            existingState,
        };
    };

    const evaluateManagedTenantCommandGovernance = (
        payload: Record<string, unknown>,
        remoteSessionId?: string,
    ): { allowed: true } | { allowed: false; error: string; remoteSession: RemoteSessionState | null } => {
        if (!input.remoteSessionGovernancePolicy.requireTenantIdForManagedCommands) {
            return { allowed: true };
        }
        if (!remoteSessionId) {
            return { allowed: true };
        }
        const existingState = input.resolveRemoteSessionState(remoteSessionId);
        if (!existingState) {
            return { allowed: true };
        }
        const scope = input.parseRemoteSessionScope({}, existingState.metadata);
        if (scope !== 'managed') {
            return { allowed: true };
        }
        const existingTenantId = input.pickRemoteTenantId(existingState.metadata);
        if (!existingTenantId) {
            return { allowed: true };
        }
        const providedTenantId = input.pickTenantFromPayloadOrMetadata(payload);
        if (!providedTenantId) {
            return {
                allowed: false,
                error: 'remote_session_tenant_command_required',
                remoteSession: existingState,
            };
        }
        if (providedTenantId !== existingTenantId) {
            return {
                allowed: false,
                error: 'remote_session_tenant_command_mismatch',
                remoteSession: existingState,
            };
        }
        return { allowed: true };
    };

    return {
        evaluateRemoteSessionGovernance,
        evaluateManagedTenantCommandGovernance,
    };
}
