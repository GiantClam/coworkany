import type {
    AgentDelegation,
    AgentIdentity,
    McpGatewayDecision,
    RuntimeSecurityAlert,
    TaskEvent,
} from '../../../sidecar/src/protocol';

export type TaskUiState = {
    taskId: string;
    status: 'idle' | 'running' | 'finished' | 'failed';
    title?: string;
    summary?: string;
    planSummary?: string;
    planSteps: Array<{ id: string; description: string; status: string }>;
    toolCalls: Array<{ toolName: string; toolId: string; source: string }>;
    effects: Array<{ requestId: string; effectType: string; riskLevel: number; approved?: boolean }>;
    patches: Array<{ patchId: string; filePath?: string; status: string }>;
    identities: AgentIdentity[];
    delegations: AgentDelegation[];
    mcpDecisions: McpGatewayDecision[];
    securityAlerts: RuntimeSecurityAlert[];
    events: TaskEvent[];
};

export function createEmptyTaskState(taskId: string): TaskUiState {
    return {
        taskId,
        status: 'idle',
        planSteps: [],
        toolCalls: [],
        effects: [],
        patches: [],
        identities: [],
        delegations: [],
        mcpDecisions: [],
        securityAlerts: [],
        events: [],
    };
}

export function applyTaskEvent(state: TaskUiState, event: TaskEvent): TaskUiState {
    const next = { ...state, events: [...state.events, event] };

    switch (event.type) {
        case 'TASK_STARTED':
            return {
                ...next,
                status: 'running',
                title: event.payload.title,
            };
        case 'PLAN_UPDATED':
            return {
                ...next,
                planSummary: event.payload.summary,
                planSteps: event.payload.steps,
            };
        case 'TASK_FINISHED':
            return {
                ...next,
                status: 'finished',
                summary: event.payload.summary,
            };
        case 'TASK_FAILED':
            return {
                ...next,
                status: 'failed',
                summary: event.payload.error,
            };
        case 'TOOL_CALLED':
            return {
                ...next,
                toolCalls: [
                    ...next.toolCalls,
                    {
                        toolName: event.payload.toolName,
                        toolId: event.payload.toolId,
                        source: event.payload.source,
                    },
                ],
            };
        case 'EFFECT_REQUESTED':
            return {
                ...next,
                effects: [
                    ...next.effects,
                    {
                        requestId: event.payload.request.id,
                        effectType: event.payload.request.effectType,
                        riskLevel: event.payload.riskLevel,
                    },
                ],
            };
        case 'EFFECT_APPROVED':
            return {
                ...next,
                effects: next.effects.map((effect) =>
                    effect.requestId === event.payload.response.requestId
                        ? { ...effect, approved: true }
                        : effect
                ),
            };
        case 'EFFECT_DENIED':
            return {
                ...next,
                effects: next.effects.map((effect) =>
                    effect.requestId === event.payload.response.requestId
                        ? { ...effect, approved: false }
                        : effect
                ),
            };
        case 'PATCH_PROPOSED':
            return {
                ...next,
                patches: [
                    ...next.patches,
                    {
                        patchId: event.payload.patch.id,
                        filePath: event.payload.patch.filePath,
                        status: 'proposed',
                    },
                ],
            };
        case 'PATCH_APPLIED':
            return {
                ...next,
                patches: next.patches.map((patch) =>
                    patch.patchId === event.payload.patchId
                        ? { ...patch, status: 'applied', filePath: event.payload.filePath }
                        : patch
                ),
            };
        case 'PATCH_REJECTED':
            return {
                ...next,
                patches: next.patches.map((patch) =>
                    patch.patchId === event.payload.patchId
                        ? { ...patch, status: 'rejected' }
                        : patch
                ),
            };
        case 'AGENT_IDENTITY_ESTABLISHED':
            return {
                ...next,
                identities: [...next.identities, event.payload.identity],
            };
        case 'AGENT_DELEGATED':
            return {
                ...next,
                delegations: [...next.delegations, event.payload],
            };
        case 'MCP_GATEWAY_DECISION':
            return {
                ...next,
                mcpDecisions: [...next.mcpDecisions, event.payload],
            };
        case 'RUNTIME_SECURITY_ALERT':
            return {
                ...next,
                securityAlerts: [...next.securityAlerts, event.payload],
            };
        default:
            return next;
    }
}
