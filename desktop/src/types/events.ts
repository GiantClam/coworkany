/**
 * Event Types - Unified Type Definitions
 *
 * Centralizes all event-related type definitions used across the application.
 */

// ============================================================================
// Base Event Types
// ============================================================================

export interface BaseEvent {
    id: string;
    timestamp: string;
}

export interface TaskEvent extends BaseEvent {
    taskId: string;
    sequence: number;
    type: TaskEventType;
    payload: Record<string, unknown>;
}

export type TaskEventType =
    | 'TASK_STARTED'
    | 'TASK_FINISHED'
    | 'TASK_FAILED'
    | 'TASK_STATUS'
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
    | 'MCP_GATEWAY_DECISION'
    | 'RUNTIME_SECURITY_ALERT'
    | 'RATE_LIMITED'
    | 'TOKEN_USAGE';

// ============================================================================
// Task & Session Types
// ============================================================================

export type TaskStatus = 'idle' | 'running' | 'finished' | 'failed';

export interface PlanStep {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'complete' | 'skipped' | 'failed';
}

export interface ToolCall {
    toolName: string;
    toolId: string;
    source: string;
}

export interface Effect {
    requestId: string;
    effectType: string;
    riskLevel: number;
    approved?: boolean;
}

export interface Patch {
    patchId: string;
    filePath?: string;
    status: string;
}

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: string;
}

export interface AuditEvent {
    timestamp: string;
    action: string;
    id: string;
    originalPath?: string;
    targetPath?: string;
    status?: string;
}

export interface IpcResponse {
    type: string;
    commandId: string;
    timestamp: string;
    payload: Record<string, unknown>;
}

export interface SkillRecommendation {
    skillName: string;
    confidence: number;
    reason: string;
    autoLoad: boolean;
    priority: number;
}

export interface TaskSession {
    taskId: string;
    status: TaskStatus;
    title?: string;
    summary?: string;
    planSummary?: string;
    planSteps: PlanStep[];
    toolCalls: ToolCall[];
    effects: Effect[];
    patches: Patch[];
    messages: ChatMessage[];
    assistantDraft?: string;
    skillRecommendations?: SkillRecommendation[];
    events: TaskEvent[];
    workspacePath?: string;
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        estimatedCost?: number;
    };
    createdAt: string;
    updatedAt: string;
}

// ============================================================================
// Timeline Item Types (UI Representation)
// ============================================================================

export type TimelineItemType =
    | UserMessageItem
    | AssistantMessageItem
    | ToolCallItem
    | SystemEventItem
    | EffectRequestItem
    | PatchItem;

export interface UserMessageItem extends BaseEvent {
    type: 'user_message';
    content: string;
}

export interface AssistantMessageItem extends BaseEvent {
    type: 'assistant_message';
    content: string;
    isStreaming?: boolean;
}

export interface ToolCallItem extends BaseEvent {
    type: 'tool_call';
    toolName: string;
    args: any;
    status: ToolCallStatus;
    result?: string;
}

export type ToolCallStatus = 'running' | 'success' | 'failed';

export interface SystemEventItem extends BaseEvent {
    type: 'system_event';
    content: string;
}

export interface EffectRequestItem extends BaseEvent {
    type: 'effect_request';
    effectType: string;
    risk: number;
    approved?: boolean;
}

export interface PatchItem extends BaseEvent {
    type: 'patch';
    filePath: string;
    status: 'proposed' | 'applied' | 'rejected';
}

// ============================================================================
// Event Payload Types (for specific events)
// ============================================================================

export interface TaskStartedPayload {
    title: string;
    description?: string;
    context?: {
        userQuery?: string;
        workspacePath?: string;
        [key: string]: unknown;
    };
}

export interface PlanUpdatedPayload {
    summary: string;
    steps: PlanStep[];
}

export interface ChatMessagePayload {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface TextDeltaPayload {
    role?: 'thinking' | 'assistant';
    delta: string;
}

export interface ToolCalledPayload {
    toolId: string;
    toolName: string;
    args: Record<string, unknown>;
    source: string;
}

export interface ToolResultPayload {
    toolId: string;
    success: boolean;
    result?: string;
    error?: string;
    resultSummary?: string;
}

export interface EffectRequestedPayload {
    request: {
        id: string;
        effectType: string;
        [key: string]: unknown;
    };
    riskLevel: number;
}

export interface EffectResponsePayload {
    response: {
        requestId: string;
        approved: boolean;
        [key: string]: unknown;
    };
}

export interface PatchProposedPayload {
    patch: {
        id: string;
        filePath: string;
        [key: string]: unknown;
    };
}

export interface PatchAppliedPayload {
    patchId: string;
    filePath: string;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isUserMessage(item: TimelineItemType): item is UserMessageItem {
    return item.type === 'user_message';
}

export function isAssistantMessage(item: TimelineItemType): item is AssistantMessageItem {
    return item.type === 'assistant_message';
}

export function isToolCall(item: TimelineItemType): item is ToolCallItem {
    return item.type === 'tool_call';
}

export function isSystemEvent(item: TimelineItemType): item is SystemEventItem {
    return item.type === 'system_event';
}

export function isEffectRequest(item: TimelineItemType): item is EffectRequestItem {
    return item.type === 'effect_request';
}

export function isPatch(item: TimelineItemType): item is PatchItem {
    return item.type === 'patch';
}
