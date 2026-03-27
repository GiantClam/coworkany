/**
 * CoworkAny Protocol
 * 
 * Type-safe IPC protocol between Sidecar (Bun) and Desktop (Rust/Tauri).
 * 
 * Architecture:
 * - Sidecar: Agent orchestration, model routing, tool execution
 * - Rust: Policy Gate, system effects, atomic file operations, audit
 *
 * Capability model:
 * - Toolpacks (MCP tool servers): "what the system can do" (tools and effects)
 * - Claude Skills (Agent Skills packs): "how to do it" (workflows and assets)
 *
 * Sidecar bridges both through the Skills Adapter layer
 * (`sidecar/src/claude_skills`), keeping policy enforcement in the Rust
 * Policy Gate for all effects regardless of origin.
 * 
 * All cross-boundary communication uses this schema for type safety.
 */

// Effects - Side effect permission system
export {
    // Types
    EffectTypeSchema,
    EffectSourceSchema,
    ConfirmationPolicySchema,
    EffectScopeSchema,
    EffectRequestSchema,
    EffectResponseSchema,
    // Values
    DEFAULT_EFFECT_POLICIES,
    EFFECT_RISK_LEVELS,
    // TypeScript types
    type EffectType,
    type EffectSource,
    type ConfirmationPolicy,
    type EffectScope,
    type EffectRequest,
    type EffectResponse,
} from './effects';

// Events - Task lifecycle and visualization
export {
    // Event schemas
    TaskEventSchema,
    TaskStartedEventSchema,
    PlanUpdatedEventSchema,
    TaskResearchUpdatedEventSchema,
    TaskContractReopenedEventSchema,
    TaskPlanReadyEventSchema,
    TaskCheckpointReachedEventSchema,
    TaskUserActionRequiredEventSchema,
    TaskFinishedEventSchema,
    TaskFailedEventSchema,
    TaskStatusEventSchema,
    TaskClarificationRequiredEventSchema,
    TaskHistoryClearedEventSchema,
    ChatMessageEventSchema,
    ToolCalledEventSchema,
    ToolResultEventSchema,
    EffectRequestedEventSchema,
    EffectApprovedEventSchema,
    EffectDeniedEventSchema,
    PatchProposedEventSchema,
    PatchAppliedEventSchema,
    PatchRejectedEventSchema,
    AgentIdentityEstablishedEventSchema,
    AgentDelegationEventSchema,
    McpGatewayDecisionEventSchema,
    RuntimeSecurityAlertEventSchema,
    TextDeltaEventSchema,
    ThinkingDeltaEventSchema,
    // Autonomous Task Events (OpenClaw-style)
    AutonomousTaskDecomposedEventSchema,
    AutonomousSubtaskStartedEventSchema,
    AutonomousSubtaskCompletedEventSchema,
    AutonomousSubtaskFailedEventSchema,
    AutonomousMemoryExtractedEventSchema,
    AutonomousMemorySavedEventSchema,
    AutonomousUserInputRequiredEventSchema,
    // TypeScript types
    type TaskEvent,
    type TaskStartedEvent,
    type PlanUpdatedEvent,
    type TaskResearchUpdatedEvent,
    type TaskContractReopenedEvent,
    type TaskPlanReadyEvent,
    type TaskCheckpointReachedEvent,
    type TaskUserActionRequiredEvent,
    type TaskFinishedEvent,
    type TaskFailedEvent,
    type TaskStatusEvent,
    type TaskClarificationRequiredEvent,
    type TaskHistoryClearedEvent,
    type ChatMessageEvent,
    type ToolCalledEvent,
    type ToolResultEvent,
    type EffectRequestedEvent,
    type EffectApprovedEvent,
    type EffectDeniedEvent,
    type PatchProposedEvent,
    type PatchAppliedEvent,
    type PatchRejectedEvent,
    type AgentIdentityEstablishedEvent,
    type AgentDelegationEvent,
    type McpGatewayDecisionEvent,
    type RuntimeSecurityAlertEvent,
    type TextDeltaEvent,
    type ThinkingDeltaEvent,
    // Autonomous Task Event Types (OpenClaw-style)
    type AutonomousTaskDecomposedEvent,
    type AutonomousSubtaskStartedEvent,
    type AutonomousSubtaskCompletedEvent,
    type AutonomousSubtaskFailedEvent,
    type AutonomousMemoryExtractedEvent,
    type AutonomousMemorySavedEvent,
    type AutonomousUserInputRequiredEvent,
} from './events';

// Patches - Non-destructive code editing
export {
    // Schemas
    PatchOperationSchema,
    DiffHunkSchema,
    FilePatchSchema,
    PatchSetSchema,
    ShadowFileSchema,
    PatchApplyRequestSchema,
    PatchApplyResultSchema,
    // Helpers
    createDiffHeader,
    calculatePatchStats,
    // TypeScript types
    type PatchOperation,
    type DiffHunk,
    type FilePatch,
    type PatchSet,
    type ShadowFile,
    type PatchApplyRequest,
    type PatchApplyResult,
} from './patches';

// Identity and Security - Shared schemas
export {
    AgentIdentitySchema,
    AgentDelegationSchema,
    McpGatewayDecisionSchema,
    RuntimeSecurityAlertSchema,
    type AgentIdentity,
    type AgentDelegation,
    type McpGatewayDecision,
    type RuntimeSecurityAlert,
} from './security';

// Commands - IPC request/response protocol
export {
    // Command schemas
    IpcCommandSchema,
    IpcResponseSchema,
    StartTaskCommandSchema,
    CancelTaskCommandSchema,
    ClearTaskHistoryCommandSchema,
    ClearTaskHistoryResponseSchema,
    SendTaskMessageCommandSchema,
    SendTaskMessageResponseSchema,
    ResumeInterruptedTaskCommandSchema,
    ResumeInterruptedTaskResponseSchema,
    BootstrapRuntimeContextCommandSchema,
    BootstrapRuntimeContextResponseSchema,
    DoctorPreflightCommandSchema,
    DoctorPreflightResponseSchema,
    PlatformRuntimeContextSchema,
    RequestEffectCommandSchema,
    ApplyPatchCommandSchema,
    ReadFileCommandSchema,
    ListDirCommandSchema,
    ExecShellCommandSchema,
    CaptureScreenCommandSchema,
    GetPolicyConfigCommandSchema,
    ToolpackRuntimeSchema,
    ToolpackSourceSchema,
    ToolpackManifestSchema,
    ExtensionPermissionSummarySchema,
    ExtensionPermissionDeltaSchema,
    ExtensionProvenanceSchema,
    ExtensionTrustSummarySchema,
    ExtensionGovernanceReviewSchema,
    ExtensionGovernanceStateSchema,
    ToolpackRecordSchema,
    ListToolpacksCommandSchema,
    ListToolpacksResponseSchema,
    GetToolpackCommandSchema,
    GetToolpackResponseSchema,
    InstallToolpackCommandSchema,
    InstallToolpackResponseSchema,
    SetToolpackEnabledCommandSchema,
    SetToolpackEnabledResponseSchema,
    RemoveToolpackCommandSchema,
    RemoveToolpackResponseSchema,
    ClaudeSkillSourceSchema,
    ClaudeSkillManifestSchema,
    ClaudeSkillRecordSchema,
    ListClaudeSkillsCommandSchema,
    ListClaudeSkillsResponseSchema,
    GetClaudeSkillCommandSchema,
    GetClaudeSkillResponseSchema,
    ImportClaudeSkillCommandSchema,
    ImportClaudeSkillResponseSchema,
    SetClaudeSkillEnabledCommandSchema,
    SetClaudeSkillEnabledResponseSchema,
    RemoveClaudeSkillCommandSchema,
    RemoveClaudeSkillResponseSchema,
    ApproveExtensionGovernanceCommandSchema,
    ApproveExtensionGovernanceResponseSchema,
    DirectiveSchema,
    ListDirectivesCommandSchema,
    ListDirectivesResponseSchema,
    UpsertDirectiveCommandSchema,
    UpsertDirectiveResponseSchema,
    RemoveDirectiveCommandSchema,
    RemoveDirectiveResponseSchema,
    RegisterAgentIdentityCommandSchema,
    RegisterAgentIdentityResponseSchema,
    RecordAgentDelegationCommandSchema,
    RecordAgentDelegationResponseSchema,
    ReportMcpGatewayDecisionCommandSchema,
    ReportMcpGatewayDecisionResponseSchema,
    ReportRuntimeSecurityAlertCommandSchema,
    ReportRuntimeSecurityAlertResponseSchema,
    ValidateGitHubUrlCommandSchema,
    ValidateGitHubUrlResponseSchema,
    ScanDefaultReposCommandSchema,
    ScanDefaultReposResponseSchema,
    // TypeScript types
    type IpcCommand,
    type IpcResponse,
    type PlatformRuntimeContext,
    type StartTaskCommand,
    type DoctorPreflightCommand,
    type DoctorPreflightResponse,
    type CancelTaskCommand,
    type ClearTaskHistoryCommand,
    type ClearTaskHistoryResponse,
    type SendTaskMessageCommand,
    type ResumeInterruptedTaskCommand,
    type ResumeInterruptedTaskResponse,
    type SendTaskMessageResponse,
    type RequestEffectCommand,
    type ApplyPatchCommand,
    type ExecShellCommand,
    type ToolpackRuntime,
    type ToolpackSource,
    type ToolpackManifest,
    type ExtensionPermissionSummary,
    type ExtensionPermissionDelta,
    type ExtensionProvenance,
    type ExtensionTrustSummary,
    type ExtensionGovernanceReview,
    type ExtensionGovernanceState,
    type ToolpackRecord,
    type ListToolpacksCommand,
    type ListToolpacksResponse,
    type GetToolpackCommand,
    type GetToolpackResponse,
    type InstallToolpackCommand,
    type InstallToolpackResponse,
    type SetToolpackEnabledCommand,
    type SetToolpackEnabledResponse,
    type RemoveToolpackCommand,
    type RemoveToolpackResponse,
    type ClaudeSkillSource,
    type ClaudeSkillManifest,
    type ClaudeSkillRecord,
    type ListClaudeSkillsCommand,
    type ListClaudeSkillsResponse,
    type GetClaudeSkillCommand,
    type GetClaudeSkillResponse,
    type ImportClaudeSkillCommand,
    type ImportClaudeSkillResponse,
    type SetClaudeSkillEnabledCommand,
    type SetClaudeSkillEnabledResponse,
    type RemoveClaudeSkillCommand,
    type RemoveClaudeSkillResponse,
    type ApproveExtensionGovernanceCommand,
    type ApproveExtensionGovernanceResponse,
    type Directive,
    type ListDirectivesCommand,
    type ListDirectivesResponse,
    type UpsertDirectiveCommand,
    type UpsertDirectiveResponse,
    type RemoveDirectiveCommand,
    type RemoveDirectiveResponse,
    type RegisterAgentIdentityCommand,
    type RegisterAgentIdentityResponse,
    type RecordAgentDelegationCommand,
    type RecordAgentDelegationResponse,
    type ReportMcpGatewayDecisionCommand,
    type ReportMcpGatewayDecisionResponse,
    type ReportRuntimeSecurityAlertCommand,
    type ReportRuntimeSecurityAlertResponse,
    type ValidateGitHubUrlCommand,
    type ValidateGitHubUrlResponse,
    type ScanDefaultReposCommand,
    type ScanDefaultReposResponse,
    ListWorkspacesCommandSchema,
    ListWorkspacesResponseSchema,
    CreateWorkspaceCommandSchema,
    CreateWorkspaceResponseSchema,
    UpdateWorkspaceCommandSchema,
    UpdateWorkspaceResponseSchema,
    DeleteWorkspaceCommandSchema,
    DeleteWorkspaceResponseSchema,
    InstallFromGitHubCommandSchema,
    InstallFromGitHubResponseSchema,
    GetVoiceStateCommandSchema,
    GetVoiceStateResponseSchema,
    StopVoiceCommandSchema,
    StopVoiceResponseSchema,
    GetVoiceProviderStatusCommandSchema,
    GetVoiceProviderStatusResponseSchema,
    TranscribeVoiceCommandSchema,
    TranscribeVoiceResponseSchema,
    type ListWorkspacesCommand,
    type ListWorkspacesResponse,
    type CreateWorkspaceCommand,
    type CreateWorkspaceResponse,
    type UpdateWorkspaceCommand,
    type UpdateWorkspaceResponse,
    type DeleteWorkspaceCommand,
    type DeleteWorkspaceResponse,
    type InstallFromGitHubCommand,
    type InstallFromGitHubResponse,
    type GetVoiceStateCommand,
    type GetVoiceStateResponse,
    type StopVoiceCommand,
    type StopVoiceResponse,
    type GetVoiceProviderStatusCommand,
    type GetVoiceProviderStatusResponse,
    type TranscribeVoiceCommand,
    type TranscribeVoiceResponse,
    ReloadToolsCommandSchema,
    ReloadToolsResponseSchema,
    GetTasksCommandSchema,
    GetTasksResponseSchema,
    GetRuntimeSnapshotCommandSchema,
    GetRuntimeSnapshotResponseSchema,
    type ReloadToolsCommand,
    type ReloadToolsResponse,
    type GetTasksCommand,
    type GetTasksResponse,
    type GetRuntimeSnapshotCommand,
    type GetRuntimeSnapshotResponse,
} from './commands';

// Canonical stream - transport-agnostic message model
export {
    CanonicalMessageRoleSchema,
    CanonicalStatusPartSchema,
    CanonicalTextPartSchema,
    CanonicalReasoningPartSchema,
    CanonicalTaskPartSchema,
    CanonicalCollaborationPartSchema,
    CanonicalToolCallPartSchema,
    CanonicalToolResultPartSchema,
    CanonicalEffectPartSchema,
    CanonicalPatchPartSchema,
    CanonicalFinishPartSchema,
    CanonicalErrorPartSchema,
    CanonicalMessagePartSchema,
    CanonicalTaskMessageSchema,
    CanonicalTextDeltaSchema,
    CanonicalReasoningDeltaSchema,
    CanonicalMessageDeltaPartSchema,
    CanonicalMessageEventSchema,
    CanonicalMessageDeltaEventSchema,
    CanonicalStreamEventSchema,
    taskEventToCanonicalStreamEvents,
    type CanonicalTaskMessage,
    type CanonicalMessageEvent,
    type CanonicalMessageDeltaEvent,
    type CanonicalStreamEvent,
} from './canonicalStream';

// ============================================================================
// Protocol Version
// ============================================================================

export const PROTOCOL_VERSION = '1.0.0';

// ============================================================================
// Utility Types
// ============================================================================

// Import types for use in utility type definitions (re-exported above)
import type { TaskEvent } from './events';
import type { IpcCommand, IpcResponse } from './commands';

/**
 * Extract event type from TaskEvent union.
 */
export type EventOfType<T extends TaskEvent['type']> = Extract<TaskEvent, { type: T }>;

/**
 * Extract command type from IpcCommand union.
 */
export type CommandOfType<T extends IpcCommand['type']> = Extract<IpcCommand, { type: T }>;

/**
 * Extract response type from IpcResponse union.
 */
export type IpcResponseOfType<T extends IpcResponse['type']> = Extract<IpcResponse, { type: T }>;
