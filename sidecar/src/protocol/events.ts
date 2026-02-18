/**
 * CoworkAny Protocol - Task Events Schema
 * 
 * Defines the event model for task lifecycle and visualization.
 * Events flow from Sidecar to UI for real-time task progress display.
 */

import { z } from 'zod';
import { EffectRequestSchema, EffectResponseSchema } from './effects';
import { FilePatchSchema } from './patches';
import {
    AgentDelegationSchema,
    AgentIdentitySchema,
    McpGatewayDecisionSchema,
    RuntimeSecurityAlertSchema,
} from './security';

// ============================================================================
// Base Event
// ============================================================================

const BaseEventSchema = z.object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    timestamp: z.string().datetime(),
    sequence: z.number().int().nonnegative(), // Ordering within task
});

// ============================================================================
// Task Lifecycle Events
// ============================================================================

/**
 * Task has started.
 */
export const TaskStartedEventSchema = BaseEventSchema.extend({
    type: z.literal('TASK_STARTED'),
    payload: z.object({
        title: z.string(),
        description: z.string().optional(),
        estimatedSteps: z.number().optional(),
        context: z.object({
            workspacePath: z.string().optional(),
            activeFile: z.string().optional(),
            userQuery: z.string(),
            packageManager: z.string().optional(),
            packageManagerCommands: z.any().optional(),
        }),
    }),
});

/**
 * Task plan updated (high-level intent, not sensitive CoT).
 */
export const PlanUpdatedEventSchema = BaseEventSchema.extend({
    type: z.literal('PLAN_UPDATED'),
    payload: z.object({
        summary: z.string(), // User-safe summary
        steps: z.array(z.object({
            id: z.string(),
            description: z.string(),
            status: z.enum(['pending', 'in_progress', 'complete', 'skipped', 'failed']),
        })),
        currentStepId: z.string().optional(),
    }),
});

/**
 * Task completed successfully.
 */
export const TaskFinishedEventSchema = BaseEventSchema.extend({
    type: z.literal('TASK_FINISHED'),
    payload: z.object({
        summary: z.string(),
        artifactsCreated: z.array(z.string()).optional(),
        filesModified: z.array(z.string()).optional(),
        duration: z.number(), // milliseconds
    }),
});

/**
 * Task failed.
 */
export const TaskFailedEventSchema = BaseEventSchema.extend({
    type: z.literal('TASK_FAILED'),
    payload: z.object({
        error: z.string(),
        errorCode: z.string().optional(),
        recoverable: z.boolean(),
        suggestion: z.string().optional(),
    }),
});

/**
 * Task status updated (e.g., streaming state for multi-turn).
 */
export const TaskStatusEventSchema = BaseEventSchema.extend({
    type: z.literal('TASK_STATUS'),
    payload: z.object({
        status: z.enum(['idle', 'running', 'finished', 'failed']),
    }),
});

/**
 * Task history was cleared.
 */
export const TaskHistoryClearedEventSchema = BaseEventSchema.extend({
    type: z.literal('TASK_HISTORY_CLEARED'),
    payload: z.object({
        reason: z.string().optional(),
    }),
});

/**
 * Chat message appended to a task session.
 */
export const ChatMessageEventSchema = BaseEventSchema.extend({
    type: z.literal('CHAT_MESSAGE'),
    payload: z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
    }),
});

// ============================================================================
// Tool Events
// ============================================================================

/**
 * Tool was called by the agent.
 * Input may be redacted for sensitive data.
 */
export const ToolCalledEventSchema = BaseEventSchema.extend({
    type: z.literal('TOOL_CALLED'),
    payload: z.object({
        toolName: z.string(),
        toolId: z.string(), // Unique call ID
        input: z.record(z.unknown()), // May be redacted
        inputRedacted: z.boolean(),
        source: z.enum(['agent', 'toolpack', 'claude_skill']),
        sourceId: z.string().optional(),
    }),
});

/**
 * Tool returned a result.
 */
export const ToolResultEventSchema = BaseEventSchema.extend({
    type: z.literal('TOOL_RESULT'),
    payload: z.object({
        toolId: z.string(), // Matches ToolCalledEvent
        success: z.boolean(),
        result: z.unknown().optional(), // May be summarized
        resultSummary: z.string().optional(),
        artifacts: z.array(z.object({
            type: z.enum(['file', 'image', 'table', 'terminal', 'browser']),
            path: z.string().optional(),
            preview: z.string().optional(),
        })).optional(),
        duration: z.number(), // milliseconds
    }),
});

// ============================================================================
// Effect Events
// ============================================================================

/**
 * An effect was requested (awaiting Policy Gate decision).
 */
export const EffectRequestedEventSchema = BaseEventSchema.extend({
    type: z.literal('EFFECT_REQUESTED'),
    payload: z.object({
        request: EffectRequestSchema,
        requiresUserConfirmation: z.boolean(),
        riskLevel: z.number().min(1).max(10),
    }),
});

/**
 * Effect was approved.
 */
export const EffectApprovedEventSchema = BaseEventSchema.extend({
    type: z.literal('EFFECT_APPROVED'),
    payload: z.object({
        response: EffectResponseSchema,
        approvedBy: z.enum(['user', 'policy', 'allowlist']),
    }),
});

/**
 * Effect was denied.
 */
export const EffectDeniedEventSchema = BaseEventSchema.extend({
    type: z.literal('EFFECT_DENIED'),
    payload: z.object({
        response: EffectResponseSchema,
        deniedBy: z.enum(['user', 'policy', 'blocklist', 'timeout']),
    }),
});

// ============================================================================
// Patch Events
// ============================================================================

/**
 * A file patch was proposed (Shadow FS).
 */
export const PatchProposedEventSchema = BaseEventSchema.extend({
    type: z.literal('PATCH_PROPOSED'),
    payload: z.object({
        patch: FilePatchSchema,
        previewUrl: z.string().optional(), // Shadow workspace path
    }),
});

/**
 * A patch was applied (atomic write completed).
 */
export const PatchAppliedEventSchema = BaseEventSchema.extend({
    type: z.literal('PATCH_APPLIED'),
    payload: z.object({
        patchId: z.string(),
        filePath: z.string(),
        hunksApplied: z.number(),
        backupPath: z.string().optional(),
    }),
});

/**
 * A patch was rejected by user.
 */
export const PatchRejectedEventSchema = BaseEventSchema.extend({
    type: z.literal('PATCH_REJECTED'),
    payload: z.object({
        patchId: z.string(),
        reason: z.string().optional(),
    }),
});

// ============================================================================
// Identity and Security Events
// ============================================================================

/**
 * Agent identity established for a task/session.
 */
export const AgentIdentityEstablishedEventSchema = BaseEventSchema.extend({
    type: z.literal('AGENT_IDENTITY_ESTABLISHED'),
    payload: z.object({
        identity: AgentIdentitySchema,
    }),
});

/**
 * Agent delegation graph edge created.
 */
export const AgentDelegationEventSchema = BaseEventSchema.extend({
    type: z.literal('AGENT_DELEGATED'),
    payload: AgentDelegationSchema,
});

/**
 * MCP gateway decision for a tool call.
 */
export const McpGatewayDecisionEventSchema = BaseEventSchema.extend({
    type: z.literal('MCP_GATEWAY_DECISION'),
    payload: McpGatewayDecisionSchema,
});

/**
 * Runtime security guard alert.
 */
export const RuntimeSecurityAlertEventSchema = BaseEventSchema.extend({
    type: z.literal('RUNTIME_SECURITY_ALERT'),
    payload: RuntimeSecurityAlertSchema,
});

// ============================================================================
// Autonomous Task Events (OpenClaw-style)
// ============================================================================

/**
 * Autonomous task decomposed into subtasks.
 */
export const AutonomousTaskDecomposedEventSchema = BaseEventSchema.extend({
    type: z.literal('AUTONOMOUS_TASK_DECOMPOSED'),
    payload: z.object({
        subtaskCount: z.number(),
        strategy: z.string(),
        canRunAutonomously: z.boolean(),
        subtasks: z.array(z.object({
            id: z.string(),
            description: z.string(),
            status: z.enum(['pending', 'running', 'completed', 'failed']),
        })),
    }),
});

/**
 * Autonomous subtask started.
 */
export const AutonomousSubtaskStartedEventSchema = BaseEventSchema.extend({
    type: z.literal('AUTONOMOUS_SUBTASK_STARTED'),
    payload: z.object({
        subtaskId: z.string(),
        description: z.string(),
        index: z.number(),
        totalSubtasks: z.number(),
    }),
});

/**
 * Autonomous subtask completed.
 */
export const AutonomousSubtaskCompletedEventSchema = BaseEventSchema.extend({
    type: z.literal('AUTONOMOUS_SUBTASK_COMPLETED'),
    payload: z.object({
        subtaskId: z.string(),
        result: z.string(),
        toolsUsed: z.array(z.string()).optional(),
    }),
});

/**
 * Autonomous subtask failed.
 */
export const AutonomousSubtaskFailedEventSchema = BaseEventSchema.extend({
    type: z.literal('AUTONOMOUS_SUBTASK_FAILED'),
    payload: z.object({
        subtaskId: z.string(),
        error: z.string(),
    }),
});

/**
 * Memory extracted from autonomous task.
 */
export const AutonomousMemoryExtractedEventSchema = BaseEventSchema.extend({
    type: z.literal('AUTONOMOUS_MEMORY_EXTRACTED'),
    payload: z.object({
        factCount: z.number(),
        facts: z.array(z.object({
            content: z.string(),
            category: z.enum(['learning', 'preference', 'project']),
            confidence: z.number(),
        })).optional(),
    }),
});

/**
 * Memory saved to vault from autonomous task.
 */
export const AutonomousMemorySavedEventSchema = BaseEventSchema.extend({
    type: z.literal('AUTONOMOUS_MEMORY_SAVED'),
    payload: z.object({
        paths: z.array(z.string()),
    }),
});

/**
 * Autonomous task requires user input to continue.
 */
export const AutonomousUserInputRequiredEventSchema = BaseEventSchema.extend({
    type: z.literal('AUTONOMOUS_USER_INPUT_REQUIRED'),
    payload: z.object({
        questions: z.array(z.string()),
        taskId: z.string(),
    }),
});

// ============================================================================
// Task Suspend/Resume Events
// ============================================================================

/**
 * Task suspended, waiting for user action (e.g., manual login).
 */
export const TaskSuspendedEventSchema = BaseEventSchema.extend({
    type: z.literal('TASK_SUSPENDED'),
    payload: z.object({
        reason: z.string(),
        userMessage: z.string(),
        canAutoResume: z.boolean(),
        maxWaitTimeMs: z.number().optional(),
    }),
});

/**
 * Task resumed after suspension (user action completed).
 */
export const TaskResumedEventSchema = BaseEventSchema.extend({
    type: z.literal('TASK_RESUMED'),
    payload: z.object({
        resumeReason: z.string().optional(),
        suspendDurationMs: z.number(),
    }),
});

// ============================================================================
// Text Streaming Events
// ============================================================================

/**
 * Streaming text delta from model.
 */
export const TextDeltaEventSchema = BaseEventSchema.extend({
    type: z.literal('TEXT_DELTA'),
    payload: z.object({
        delta: z.string(),
        role: z.enum(['assistant', 'thinking']),
    }),
});

/**
 * Streaming thinking delta from model (Extended Thinking).
 */
export const ThinkingDeltaEventSchema = BaseEventSchema.extend({
    type: z.literal('THINKING_DELTA'),
    payload: z.object({
        delta: z.string(),
    }),
});

// ============================================================================
// Union Type
// ============================================================================

export const TaskEventSchema = z.discriminatedUnion('type', [
    TaskStartedEventSchema,
    PlanUpdatedEventSchema,
    TaskFinishedEventSchema,
    TaskFailedEventSchema,
    TaskStatusEventSchema,
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
    // Task Suspend/Resume Events
    TaskSuspendedEventSchema,
    TaskResumedEventSchema,
    // Autonomous Task Events (OpenClaw-style)
    AutonomousTaskDecomposedEventSchema,
    AutonomousSubtaskStartedEventSchema,
    AutonomousSubtaskCompletedEventSchema,
    AutonomousSubtaskFailedEventSchema,
    AutonomousMemoryExtractedEventSchema,
    AutonomousMemorySavedEventSchema,
    AutonomousUserInputRequiredEventSchema,
]);

export type TaskEvent = z.infer<typeof TaskEventSchema>;

// Individual event types
export type TaskStartedEvent = z.infer<typeof TaskStartedEventSchema>;
export type PlanUpdatedEvent = z.infer<typeof PlanUpdatedEventSchema>;
export type TaskFinishedEvent = z.infer<typeof TaskFinishedEventSchema>;
export type TaskFailedEvent = z.infer<typeof TaskFailedEventSchema>;
export type TaskStatusEvent = z.infer<typeof TaskStatusEventSchema>;
export type TaskHistoryClearedEvent = z.infer<typeof TaskHistoryClearedEventSchema>;
export type ChatMessageEvent = z.infer<typeof ChatMessageEventSchema>;
export type ToolCalledEvent = z.infer<typeof ToolCalledEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type EffectRequestedEvent = z.infer<typeof EffectRequestedEventSchema>;
export type EffectApprovedEvent = z.infer<typeof EffectApprovedEventSchema>;
export type EffectDeniedEvent = z.infer<typeof EffectDeniedEventSchema>;
export type PatchProposedEvent = z.infer<typeof PatchProposedEventSchema>;
export type PatchAppliedEvent = z.infer<typeof PatchAppliedEventSchema>;
export type PatchRejectedEvent = z.infer<typeof PatchRejectedEventSchema>;
export type AgentIdentityEstablishedEvent = z.infer<typeof AgentIdentityEstablishedEventSchema>;
export type AgentDelegationEvent = z.infer<typeof AgentDelegationEventSchema>;
export type McpGatewayDecisionEvent = z.infer<typeof McpGatewayDecisionEventSchema>;
export type RuntimeSecurityAlertEvent = z.infer<typeof RuntimeSecurityAlertEventSchema>;
export type TextDeltaEvent = z.infer<typeof TextDeltaEventSchema>;
export type ThinkingDeltaEvent = z.infer<typeof ThinkingDeltaEventSchema>;
export type TaskSuspendedEvent = z.infer<typeof TaskSuspendedEventSchema>;
export type TaskResumedEvent = z.infer<typeof TaskResumedEventSchema>;

// Autonomous Task Event Types (OpenClaw-style)
export type AutonomousTaskDecomposedEvent = z.infer<typeof AutonomousTaskDecomposedEventSchema>;
export type AutonomousSubtaskStartedEvent = z.infer<typeof AutonomousSubtaskStartedEventSchema>;
export type AutonomousSubtaskCompletedEvent = z.infer<typeof AutonomousSubtaskCompletedEventSchema>;
export type AutonomousSubtaskFailedEvent = z.infer<typeof AutonomousSubtaskFailedEventSchema>;
export type AutonomousMemoryExtractedEvent = z.infer<typeof AutonomousMemoryExtractedEventSchema>;
export type AutonomousMemorySavedEvent = z.infer<typeof AutonomousMemorySavedEventSchema>;
export type AutonomousUserInputRequiredEvent = z.infer<typeof AutonomousUserInputRequiredEventSchema>;
