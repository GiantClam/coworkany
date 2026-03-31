import type {
    AgentDelegation,
    AgentIdentity,
    McpGatewayDecision,
    RuntimeSecurityAlert,
} from '../src/protocol/security';
import type { EffectRequest, EffectResponse } from '../src/protocol/effects';

export type TaskEventType =
    | 'TASK_STARTED'
    | 'TASK_FINISHED'
    | 'TASK_FAILED'
    | 'TASK_STATUS'
    | 'TASK_SUSPENDED'
    | 'TASK_RESUMED'
    | 'TASK_CLARIFICATION_REQUIRED'
    | 'TASK_RESEARCH_UPDATED'
    | 'TASK_CONTRACT_REOPENED'
    | 'TASK_PLAN_READY'
    | 'TASK_CHECKPOINT_REACHED'
    | 'TASK_USER_ACTION_REQUIRED'
    | 'TASK_HISTORY_CLEARED'
    | 'PLAN_UPDATED'
    | 'CHAT_MESSAGE'
    | 'TEXT_DELTA'
    | 'TOOL_CALLED'
    | 'TOOL_RESULT'
    | 'EFFECT_REQUESTED'
    | 'EFFECT_APPROVED'
    | 'EFFECT_DENIED'
    | 'PATCH_PROPOSED'
    | 'PATCH_APPLIED'
    | 'PATCH_REJECTED'
    | 'SKILL_RECOMMENDATION'
    | 'AGENT_IDENTITY_ESTABLISHED'
    | 'AGENT_DELEGATED'
    | 'MCP_GATEWAY_DECISION'
    | 'RUNTIME_SECURITY_ALERT'
    | 'RATE_LIMITED'
    | 'TOKEN_USAGE';

export type TaskEvent = {
    id: string;
    timestamp: string;
    taskId: string;
    sequence: number;
    type: TaskEventType;
    payload: Record<string, unknown>;
};

export type TaskStartedPayload = {
    title?: string;
    description?: string;
};

export type TaskFinishedPayload = {
    summary?: string;
    artifacts?: string[];
    files?: string[];
};

export type TaskFailedPayload = {
    error?: string;
    suggestion?: string;
};

export type TaskStatusPayload = {
    status?: 'idle' | 'running' | 'finished' | 'failed';
    message?: string;
};

export type TaskClarificationRequiredPayload = {
    reason?: string;
    questions?: string[];
    instructions?: string[];
    clarificationType?: string;
    routeChoices?: Array<{ label: string; value: string }>;
};

export type PlanUpdatedPayload = {
    summary?: string;
    steps?: Array<{
        id: string;
        description: string;
        status: string;
    }>;
    taskProgress?: Array<{
        taskId: string;
        title: string;
        status: string;
        dependencies: string[];
    }>;
};

export type ChatMessagePayload = {
    role?: 'user' | 'assistant' | 'system';
    content?: string;
};

export type TextDeltaPayload = {
    delta?: string;
    text?: string;
    content?: string;
    role?: 'assistant' | 'thinking';
    messageId?: string;
    correlationId?: string;
};

export type ToolCalledPayload = {
    toolId?: string;
    toolName?: string;
    source?: string;
    args?: unknown;
};

export type ToolResultPayload = {
    toolId?: string;
    result?: unknown;
    resultSummary?: string;
    success?: boolean;
    isError?: boolean;
};

export type EffectRequestedPayload = {
    request?: EffectRequest;
    riskLevel?: number;
};

export type EffectDecisionPayload = {
    response?: EffectResponse;
};

export type PatchPayload = {
    patch?: {
        id?: string;
        filePath?: string;
    };
    patchId?: string;
    filePath?: string;
};

export type AgentIdentityEstablishedPayload = {
    identity: AgentIdentity;
};

export type AgentDelegatedPayload = AgentDelegation;
export type McpGatewayDecisionPayload = McpGatewayDecision;
export type RuntimeSecurityAlertPayload = RuntimeSecurityAlert;
