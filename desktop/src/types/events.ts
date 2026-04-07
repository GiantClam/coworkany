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
    | 'MCP_GATEWAY_DECISION'
    | 'RUNTIME_SECURITY_ALERT'
    | 'RATE_LIMITED'
    | 'TOKEN_USAGE';

// ============================================================================
// Task & Session Types
// ============================================================================

export type TaskStatus = 'idle' | 'running' | 'finished' | 'failed' | 'suspended';

export interface PlanStep {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'complete' | 'completed' | 'skipped' | 'failed' | 'blocked';
}

export interface PlannedDeliverable {
    id: string;
    title: string;
    type: 'chat_reply' | 'report_file' | 'artifact_file' | 'workspace_change' | 'code_change';
    description: string;
    required: boolean;
    path?: string;
    format?: string;
}

export interface PlannedCheckpoint {
    id: string;
    title: string;
    kind: 'review' | 'manual_action' | 'pre_delivery';
    reason: string;
    userMessage: string;
    riskTier: 'low' | 'medium' | 'high';
    executionPolicy: 'auto' | 'review_required' | 'hard_block';
    requiresUserConfirmation: boolean;
    blocking: boolean;
}

export interface PlannedUserAction {
    id: string;
    title: string;
    kind: 'clarify_input' | 'confirm_plan' | 'manual_step' | 'external_auth';
    description: string;
    riskTier: 'low' | 'medium' | 'high';
    executionPolicy: 'auto' | 'review_required' | 'hard_block';
    blocking: boolean;
    questions: string[];
    instructions: string[];
    fulfillsCheckpointId?: string;
}

export interface MissingInfoItem {
    field: string;
    reason: string;
    blocking: boolean;
    question?: string;
    defaultValue?: string;
}

export interface DefaultingPolicy {
    outputLanguage: string;
    uiFormat: 'chat_message' | 'table' | 'report' | 'artifact';
    artifactDirectory: string;
    checkpointStrategy: 'none' | 'review_before_completion' | 'manual_action';
}

export interface ResumeStrategy {
    mode: 'continue_from_saved_context';
    preserveDeliverables: boolean;
    preserveCompletedSteps: boolean;
    preserveArtifacts: boolean;
}

export type TaskHardness =
    | 'trivial'
    | 'bounded'
    | 'multi_step'
    | 'externally_blocked'
    | 'high_risk';

export type RequiredCapability =
    | 'browser_interaction'
    | 'external_auth'
    | 'workspace_write'
    | 'host_access'
    | 'human_review';

export type BlockingRisk =
    | 'none'
    | 'missing_info'
    | 'auth'
    | 'permission'
    | 'manual_step'
    | 'policy_review';

export type InteractionMode =
    | 'passive_status'
    | 'input_first'
    | 'action_first'
    | 'review_first';

export type ExecutionShape =
    | 'single_step'
    | 'staged'
    | 'exploratory'
    | 'deterministic_workflow';

export interface ExecutionProfile {
    primaryHardness: TaskHardness;
    requiredCapabilities: RequiredCapability[];
    blockingRisk: BlockingRisk;
    interactionMode: InteractionMode;
    executionShape: ExecutionShape;
    reasons: string[];
}

export interface CapabilityPlan {
    missingCapability:
        | 'none'
        | 'existing_skill_gap'
        | 'existing_tool_gap'
        | 'new_runtime_tool_needed'
        | 'workflow_gap'
        | 'external_blocker';
    learningRequired: boolean;
    canProceedWithoutLearning: boolean;
    learningScope: 'none' | 'knowledge' | 'skill' | 'runtime_tool';
    replayStrategy: 'none' | 'resume_from_checkpoint' | 'restart_execution';
    sideEffectRisk: 'none' | 'read_only' | 'write_external';
    userAssistRequired: boolean;
    userAssistReason: 'none' | 'auth' | 'captcha' | 'permission' | 'policy' | 'ambiguous_goal';
    boundedLearningBudget: {
        complexityTier: 'simple' | 'moderate' | 'complex';
        maxRounds: number;
        maxResearchTimeMs: number;
        maxValidationAttempts: number;
    };
    reasons: string[];
}

export interface CapabilityReviewState {
    status: 'pending' | 'approved';
    summary: string;
    learnedEntityId?: string;
    updatedAt?: string;
}

export interface IntentRouting {
    intent: 'chat' | 'immediate_task' | 'scheduled_task';
    confidence: number;
    reasonCodes: string[];
    needsDisambiguation: boolean;
    forcedByUserSelection?: boolean;
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
    turnId?: string;
    messageId?: string;
    correlationId?: string;
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

export interface ContractReopenDiff {
    changedFields: Array<'mode' | 'objective' | 'deliverables' | 'execution_targets' | 'workflow'>;
    modeChanged?: { before: string; after: string };
    objectiveChanged?: { before: string; after: string };
    deliverablesChanged?: { before: string[]; after: string[] };
    targetsChanged?: { before: string[]; after: string[] };
    workflowsChanged?: { before: string[]; after: string[] };
}

export interface TaskSession {
    taskId: string;
    status: TaskStatus;
    taskMode?: 'chat' | 'immediate_task' | 'scheduled_task' | 'scheduled_multi_task';
    isDraft?: boolean;
    title?: string;
    summary?: string;
    failure?: {
        error: string;
        errorCode?: string;
        recoverable?: boolean;
        suggestion?: string;
    };
    suspension?: {
        reason: string;
        userMessage: string;
        canAutoResume: boolean;
        maxWaitTimeMs?: number;
    };
    clarificationQuestions?: string[];
    planSummary?: string;
    researchSummary?: string;
    researchSourcesChecked?: string[];
    researchBlockingUnknowns?: string[];
    selectedStrategyTitle?: string;
    contractReopenReason?: string;
    contractReopenReasons?: string[];
    contractReopenDiff?: ContractReopenDiff;
    contractReopenCount?: number;
    plannedTasks?: Array<{
        id: string;
        title: string;
        objective: string;
        dependencies: string[];
        status?: PlanStep['status'];
    }>;
    plannedDeliverables?: PlannedDeliverable[];
    plannedCheckpoints?: PlannedCheckpoint[];
    plannedUserActions?: PlannedUserAction[];
    executionProfile?: ExecutionProfile;
    capabilityPlan?: CapabilityPlan;
    capabilityReview?: CapabilityReviewState;
    primaryHardness?: TaskHardness;
    activeHardness?: TaskHardness;
    blockingReason?: string;
    lastResumeReason?: string;
    missingInfo?: MissingInfoItem[];
    defaultingPolicy?: DefaultingPolicy;
    resumeStrategy?: ResumeStrategy;
    currentCheckpoint?: PlannedCheckpoint;
    currentUserAction?: PlannedUserAction;
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
    | AssistantTurnItem
    | ToolCallItem
    | SystemEventItem
    | TaskCardItem
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
    result?: unknown;
}

export type ToolCallStatus = 'running' | 'success' | 'failed';

export interface SystemEventItem extends BaseEvent {
    type: 'system_event';
    content: string;
}

export interface TaskCardItem extends BaseEvent {
    type: 'task_card';
    taskId?: string;
    title: string;
    subtitle?: string;
    status?: TaskStatus;
    workflow?: 'single' | 'sequential' | 'parallel' | 'dag';
    executionProfile?: ExecutionProfile;
    capabilityPlan?: CapabilityPlan;
    capabilityReview?: CapabilityReviewState;
    primaryHardness?: TaskHardness;
    activeHardness?: TaskHardness;
    blockingReason?: string;
    lastResumeReason?: string;
    tasks?: Array<{
        id: string;
        title: string;
        status: PlanStep['status'];
        dependencies: string[];
    }>;
    collaboration?: {
        actionId?: string;
        title: string;
        description?: string;
        blocking?: boolean;
        questions: string[];
        instructions: string[];
        input?: {
            placeholder?: string;
            submitLabel?: string;
        };
        action?: {
            label: string;
        };
        choices?: Array<{
            label: string;
            value: string;
        }>;
    };
    result?: {
        summary?: string;
        artifacts?: string[];
        files?: string[];
        error?: string;
        suggestion?: string;
    };
    sections: Array<{
        label: string;
        lines: string[];
    }>;
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

export type AssistantTurnStepTone = 'neutral' | 'running' | 'success' | 'failed';

export interface AssistantTurnStep {
    id: string;
    title: string;
    detail?: string;
    tone: AssistantTurnStepTone;
}

export interface AssistantTurnItem extends BaseEvent {
    type: 'assistant_turn';
    lead?: string;
    steps: AssistantTurnStep[];
    messages: string[];
    taskCard?: TaskCardItem;
    toolCalls?: ToolCallItem[];
    effectRequests?: EffectRequestItem[];
    patches?: PatchItem[];
    systemEvents?: string[];
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
    taskProgress?: Array<{
        taskId: string;
        title: string;
        status: PlanStep['status'];
        dependencies: string[];
    }>;
    currentStepId?: string;
}

export interface ChatMessagePayload {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface TaskClarificationRequiredPayload {
    reason?: string;
    questions: string[];
    missingFields?: string[];
    clarificationType?: 'missing_info' | 'route_disambiguation' | 'task_draft_confirmation';
    routeChoices?: Array<{
        id: 'chat' | 'immediate_task';
        label: string;
        value: string;
    }>;
    intentRouting?: IntentRouting;
}

export interface TaskPlanReadyPayload {
    summary: string;
    mode?: 'chat' | 'immediate_task' | 'scheduled_task' | 'scheduled_multi_task';
    intentRouting?: IntentRouting;
    taskDraftRequired?: boolean;
    tasks?: Array<{
        id: string;
        title: string;
        objective: string;
        dependencies: string[];
    }>;
    deliverables: PlannedDeliverable[];
    checkpoints: PlannedCheckpoint[];
    userActionsRequired: PlannedUserAction[];
    executionProfile?: ExecutionProfile;
    missingInfo: MissingInfoItem[];
    defaultingPolicy?: DefaultingPolicy;
    resumeStrategy?: ResumeStrategy;
}

export interface TaskCheckpointReachedPayload {
    checkpointId: string;
    title: string;
    kind: PlannedCheckpoint['kind'];
    reason: string;
    userMessage: string;
    requiresUserConfirmation: boolean;
    blocking: boolean;
}

export interface TaskUserActionRequiredPayload {
    actionId: string;
    title: string;
    kind: PlannedUserAction['kind'];
    description: string;
    blocking: boolean;
    questions: string[];
    instructions: string[];
    fulfillsCheckpointId?: string;
    authUrl?: string;
    authDomain?: string;
    canAutoResume?: boolean;
}

export interface TextDeltaPayload {
    role?: 'thinking' | 'assistant';
    delta: string;
    messageId?: string;
    correlationId?: string;
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

export function isAssistantTurn(item: TimelineItemType): item is AssistantTurnItem {
    return item.type === 'assistant_turn';
}

export function isToolCall(item: TimelineItemType): item is ToolCallItem {
    return item.type === 'tool_call';
}

export function isSystemEvent(item: TimelineItemType): item is SystemEventItem {
    return item.type === 'system_event';
}

export function isTaskCard(item: TimelineItemType): item is TaskCardItem {
    return item.type === 'task_card';
}

export function isEffectRequest(item: TimelineItemType): item is EffectRequestItem {
    return item.type === 'effect_request';
}

export function isPatch(item: TimelineItemType): item is PatchItem {
    return item.type === 'patch';
}
