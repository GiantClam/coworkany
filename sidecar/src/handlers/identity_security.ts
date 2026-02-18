import {
    type AgentDelegation,
    type AgentIdentity,
    type McpGatewayDecision,
    type RuntimeSecurityAlert,
} from '../protocol/security';
import {
    type AgentDelegationEvent,
    type AgentIdentityEstablishedEvent,
    type McpGatewayDecisionEvent,
    type RuntimeSecurityAlertEvent,
    type TaskEvent,
} from '../protocol/events';
import {
    type RecordAgentDelegationCommand,
    type RecordAgentDelegationResponse,
    type RegisterAgentIdentityCommand,
    type RegisterAgentIdentityResponse,
    type ReportMcpGatewayDecisionCommand,
    type ReportMcpGatewayDecisionResponse,
    type ReportRuntimeSecurityAlertCommand,
    type ReportRuntimeSecurityAlertResponse,
} from '../protocol/commands';

export type HandlerContext = {
    taskId: string;
    now: () => string;
    nextEventId: () => string;
    nextSequence: () => number;
};

export type HandlerResult<TResponse> = {
    response: TResponse;
    events: TaskEvent[];
};

export class AgentIdentityRegistry {
    private identities = new Map<string, AgentIdentity>();
    private delegations: AgentDelegation[] = [];

    register(identity: AgentIdentity): void {
        this.identities.set(identity.sessionId, identity);
    }

    delegate(delegation: AgentDelegation): void {
        this.delegations.push(delegation);
    }

    get(sessionId: string): AgentIdentity | undefined {
        return this.identities.get(sessionId);
    }

    list(): AgentIdentity[] {
        return Array.from(this.identities.values());
    }

    listDelegations(): AgentDelegation[] {
        return [...this.delegations];
    }
}

function baseEvent(ctx: HandlerContext) {
    return {
        id: ctx.nextEventId(),
        taskId: ctx.taskId,
        timestamp: ctx.now(),
        sequence: ctx.nextSequence(),
    };
}

function wrapEvent(event: TaskEvent): TaskEvent {
    return event;
}

export function handleRegisterAgentIdentity(
    command: RegisterAgentIdentityCommand,
    ctx: HandlerContext,
    registry: AgentIdentityRegistry
): HandlerResult<RegisterAgentIdentityResponse> {
    const identity = command.payload.identity;
    registry.register(identity);

    const event: AgentIdentityEstablishedEvent = {
        ...baseEvent(ctx),
        type: 'AGENT_IDENTITY_ESTABLISHED',
        payload: {
            identity,
        },
    };

    return {
        response: {
            type: 'register_agent_identity_response',
            commandId: command.id,
            timestamp: ctx.now(),
            payload: {
                success: true,
                sessionId: identity.sessionId,
            },
        },
        events: [wrapEvent(event)],
    };
}

export function handleRecordAgentDelegation(
    command: RecordAgentDelegationCommand,
    ctx: HandlerContext,
    registry: AgentIdentityRegistry
): HandlerResult<RecordAgentDelegationResponse> {
    const delegation = command.payload.delegation;
    registry.delegate(delegation);

    const event: AgentDelegationEvent = {
        ...baseEvent(ctx),
        type: 'AGENT_DELEGATED',
        payload: delegation,
    };

    return {
        response: {
            type: 'record_agent_delegation_response',
            commandId: command.id,
            timestamp: ctx.now(),
            payload: {
                success: true,
                parentSessionId: delegation.parentSessionId,
                childSessionId: delegation.childSessionId,
            },
        },
        events: [wrapEvent(event)],
    };
}

export function handleReportMcpGatewayDecision(
    command: ReportMcpGatewayDecisionCommand,
    ctx: HandlerContext
): HandlerResult<ReportMcpGatewayDecisionResponse> {
    const decision: McpGatewayDecision = command.payload.decision;

    const event: McpGatewayDecisionEvent = {
        ...baseEvent(ctx),
        type: 'MCP_GATEWAY_DECISION',
        payload: decision,
    };

    return {
        response: {
            type: 'report_mcp_gateway_decision_response',
            commandId: command.id,
            timestamp: ctx.now(),
            payload: {
                success: true,
            },
        },
        events: [wrapEvent(event)],
    };
}

export function handleReportRuntimeSecurityAlert(
    command: ReportRuntimeSecurityAlertCommand,
    ctx: HandlerContext
): HandlerResult<ReportRuntimeSecurityAlertResponse> {
    const alert: RuntimeSecurityAlert = command.payload.alert;

    const event: RuntimeSecurityAlertEvent = {
        ...baseEvent(ctx),
        type: 'RUNTIME_SECURITY_ALERT',
        payload: alert,
    };

    return {
        response: {
            type: 'report_runtime_security_alert_response',
            commandId: command.id,
            timestamp: ctx.now(),
            payload: {
                success: true,
            },
        },
        events: [wrapEvent(event)],
    };
}
