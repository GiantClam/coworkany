/**
 * Types Index
 *
 * Central export point for all type definitions.
 * Import types from here instead of individual files.
 *
 * @example
 * import type { TaskEvent, TimelineItemType, Workspace } from '@/types';
 */

// Event types
export type {
    BaseEvent,
    TaskEvent,
    TaskEventType,
    TaskStatus,
    PlanStep,
    PlannedDeliverable,
    PlannedCheckpoint,
    PlannedUserAction,
    MissingInfoItem,
    DefaultingPolicy,
    ResumeStrategy,
    ToolCall,
    Effect,
    Patch,
    ChatMessage,
    AuditEvent,
    IpcResponse,
    TaskSession,
    SkillRecommendation,
    TimelineItemType,
    UserMessageItem,
    AssistantMessageItem,
    ToolCallItem,
    ToolCallStatus,
    SystemEventItem,
    TaskCardItem,
    EffectRequestItem,
    PatchItem,
    TaskStartedPayload,
    PlanUpdatedPayload,
    TaskPlanReadyPayload,
    TaskCheckpointReachedPayload,
    TaskUserActionRequiredPayload,
    ChatMessagePayload,
    TextDeltaPayload,
    ToolCalledPayload,
    ToolResultPayload,
    EffectRequestedPayload,
    EffectResponsePayload,
    PatchProposedPayload,
    PatchAppliedPayload,
} from './events';

export {
    isUserMessage,
    isAssistantMessage,
    isToolCall,
    isSystemEvent,
    isTaskCard,
    isEffectRequest,
    isPatch,
} from './events';

// UI types
export type {
    Workspace,
    AnthropicProviderSettings,
    OpenRouterProviderSettings,
    OpenAIProviderSettings,
    OllamaProviderSettings,
    CustomProviderSettings,
    SearchSettings,
    ProxySettings,
    VoiceProviderMode,
    VoiceSettings,
    LlmProfile,
    LlmConfig,
    IpcResult,
    SkillManifest,
    SkillRecord,
    ToolpackManifest,
    ToolpackRecord,
    FormState,
    ValidationMessage,
    ModalState,
    ConfirmDialogState,
    BaseComponentProps,
    FieldProps,
    ButtonProps,
    InputProps,
    SelectProps,
    MessageProcessingOptions,
    CodeBlockProps,
    MarkdownRendererProps,
    StatusType,
    StatusBadgeProps,
    SearchState,
    PaginationState,
    Notification,
    ThemeMode,
    ThemeConfig,
} from './ui';

export {
    isValidationError,
    isValidationSuccess,
    hasError,
    isLoading,
} from './ui';
