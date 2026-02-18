/**
 * CoworkAny - Self-Learning Tools
 *
 * Tools for triggering and managing AI self-learning capabilities.
 * Handlers are stubs that will be bound to actual implementation in main.ts
 */

import type { ToolDefinition } from './standard';

// ============================================================================
// Placeholder Handlers (to be replaced with actual implementation)
// ============================================================================

// These handlers will be replaced when tools are registered with actual controller
const notImplementedHandler = async (args: Record<string, unknown>) => ({
    success: false,
    error: 'Self-learning system not initialized. This tool requires SelfLearningController integration.',
    args,
});

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Trigger a self-learning session for a capability the AI doesn't have
 */
export const triggerLearningTool: ToolDefinition = {
    name: 'trigger_learning',
    description: `Start a self-learning session to acquire a new capability.

Use this tool when:
- You need to use a library or tool you're unfamiliar with (e.g., ffmpeg, pandas)
- Previous attempts at a task failed due to lack of knowledge
- The user asks for something that requires specialized domain knowledge

The learning process will:
1. Research the topic on the internet
2. Extract and structure the knowledge
3. Validate the knowledge through experiments
4. Save it as a reusable skill or knowledge entry

Example: If asked to "convert video to gif" but you don't know ffmpeg, use this tool to learn about ffmpeg first.`,
    effects: ['network:outbound', 'filesystem:write', 'state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            topic: {
                type: 'string',
                description: 'What you need to learn (e.g., "ffmpeg video processing", "pandas data analysis")',
            },
            context: {
                type: 'string',
                description: 'Why you need this knowledge - the original user request',
            },
            urgency: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                default: 'medium',
                description: 'How urgently this knowledge is needed',
            },
            depth: {
                type: 'string',
                enum: ['shallow', 'medium', 'deep'],
                default: 'medium',
                description: 'How deeply to research the topic',
            },
        },
        required: ['topic', 'context'],
    },
    handler: notImplementedHandler,
};

/**
 * Query the status of learning sessions and learned capabilities
 */
export const queryLearningStatusTool: ToolDefinition = {
    name: 'query_learning_status',
    description: `Check the status of self-learning sessions and learned capabilities.

Use this to:
- Check progress of active learning sessions
- Find what capabilities have been learned
- Get statistics about learned skills and their success rates
- Find skills that might need relearning due to low success rate`,
    effects: [],
    input_schema: {
        type: 'object',
        properties: {
            session_id: {
                type: 'string',
                description: 'Specific session ID to query (optional)',
            },
            capability: {
                type: 'string',
                description: 'Search for learned capabilities by keyword (optional)',
            },
            show_statistics: {
                type: 'boolean',
                default: false,
                description: 'Include learning statistics in response',
            },
            show_needs_attention: {
                type: 'boolean',
                default: false,
                description: 'Show skills with low success rate that might need relearning',
            },
        },
    },
    handler: notImplementedHandler,
};

/**
 * Validate a generated skill before using it
 */
export const validateSkillTool: ToolDefinition = {
    name: 'validate_skill',
    description: `Test and validate a generated or existing skill.

Use this tool to:
- Verify a newly generated skill works correctly
- Re-validate a skill that has low confidence
- Test specific functionality of a skill

This runs the skill's test cases and updates its confidence score.`,
    effects: ['code:execute', 'filesystem:read'],
    input_schema: {
        type: 'object',
        properties: {
            skill_id: {
                type: 'string',
                description: 'ID of the skill to validate',
            },
            test_cases: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        input: { type: 'string' },
                        expected: { type: 'string' },
                    },
                },
                description: 'Custom test cases to run (optional, uses default tests if not provided)',
            },
            update_confidence: {
                type: 'boolean',
                default: true,
                description: 'Whether to update the skill confidence based on test results',
            },
        },
        required: ['skill_id'],
    },
    handler: notImplementedHandler,
};

/**
 * Search for reusable learned capabilities
 */
export const findLearnedCapabilityTool: ToolDefinition = {
    name: 'find_learned_capability',
    description: `Search for previously learned skills or knowledge that can help with the current task.

Use this BEFORE attempting a task to check if you've already learned relevant capabilities.
This helps avoid re-learning and uses validated knowledge.

Returns matching skills and knowledge entries sorted by relevance and confidence.`,
    effects: [],
    input_schema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'What capability you\'re looking for (e.g., "video processing", "data visualization")',
            },
            include_low_confidence: {
                type: 'boolean',
                default: false,
                description: 'Include results with low confidence scores',
            },
        },
        required: ['query'],
    },
    handler: notImplementedHandler,
};

/**
 * Record usage result for a learned capability
 */
export const recordCapabilityUsageTool: ToolDefinition = {
    name: 'record_capability_usage',
    description: `Record whether using a learned capability succeeded or failed.

This updates the confidence score of the capability:
- Success increases confidence
- Failure decreases confidence
- Multiple failures may trigger relearning

Always use this after using a learned skill or knowledge to improve future recommendations.`,
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            capability_id: {
                type: 'string',
                description: 'ID of the skill or knowledge entry used',
            },
            task_id: {
                type: 'string',
                description: 'ID of the task where this was used',
            },
            success: {
                type: 'boolean',
                description: 'Whether the capability worked correctly',
            },
            details: {
                type: 'string',
                description: 'Additional details about the usage (optional)',
            },
        },
        required: ['capability_id', 'task_id', 'success'],
    },
    handler: notImplementedHandler,
};

/**
 * Submit user feedback for a skill or knowledge
 */
export const submitFeedbackTool: ToolDefinition = {
    name: 'submit_feedback',
    description: `Submit feedback about a learned skill or knowledge entry.

Your feedback helps improve the self-learning system:
- Mark skills as helpful or not helpful
- Provide ratings and comments
- Suggest improvements

Use this after using a learned capability to improve future recommendations.`,
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            entity_id: {
                type: 'string',
                description: 'ID of the skill or knowledge to rate',
            },
            entity_type: {
                type: 'string',
                enum: ['skill', 'knowledge'],
                description: 'Type of entity',
            },
            feedback_type: {
                type: 'string',
                enum: ['helpful', 'not_helpful', 'partially_helpful', 'needs_improvement'],
                description: 'Your feedback rating',
            },
            rating: {
                type: 'number',
                minimum: 1,
                maximum: 5,
                description: 'Optional 1-5 star rating',
            },
            comment: {
                type: 'string',
                description: 'Optional comment explaining your feedback',
            },
            suggested_improvement: {
                type: 'string',
                description: 'Optional suggestion for how to improve this skill/knowledge',
            },
        },
        required: ['entity_id', 'entity_type', 'feedback_type'],
    },
    handler: notImplementedHandler,
};

/**
 * Rollback a skill to a previous version
 */
export const rollbackSkillTool: ToolDefinition = {
    name: 'rollback_skill',
    description: `Rollback a skill to a previous working version.

Use this when:
- A skill update broke functionality
- The user requests to restore a previous version
- Auto-rollback was disabled but rollback is needed

Returns the skill to a known good state.`,
    effects: ['filesystem:write'],
    input_schema: {
        type: 'object',
        properties: {
            skill_id: {
                type: 'string',
                description: 'ID of the skill to rollback',
            },
            target_version: {
                type: 'string',
                description: 'Specific version to rollback to (optional, defaults to previous)',
            },
            reason: {
                type: 'string',
                description: 'Reason for rollback',
            },
        },
        required: ['skill_id'],
    },
    handler: notImplementedHandler,
};

/**
 * View skill version history
 */
export const viewSkillHistoryTool: ToolDefinition = {
    name: 'view_skill_history',
    description: `View version history for a skill.

Shows all versions with:
- Version numbers and dates
- Changelogs
- Confidence scores
- Rollback history`,
    effects: [],
    input_schema: {
        type: 'object',
        properties: {
            skill_id: {
                type: 'string',
                description: 'ID of the skill',
            },
            compare_versions: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 2,
                description: 'Optional: two versions to compare',
            },
        },
        required: ['skill_id'],
    },
    handler: notImplementedHandler,
};

/**
 * Get learning predictions
 */
export const getLearningPredictionsTool: ToolDefinition = {
    name: 'get_learning_predictions',
    description: `Get predictions for what skills might be useful to learn.

Based on usage patterns, predicts topics you might need in the future.
These can be proactively learned during idle time.`,
    effects: [],
    input_schema: {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                default: 5,
                description: 'Maximum number of predictions to return',
            },
            min_confidence: {
                type: 'number',
                default: 0.5,
                description: 'Minimum prediction confidence (0-1)',
            },
        },
    },
    handler: notImplementedHandler,
};

/**
 * Configure proactive learning
 */
export const configureProactiveLearningTool: ToolDefinition = {
    name: 'configure_proactive_learning',
    description: `Enable or configure proactive (background) learning.

Proactive learning:
- Predicts skills you might need
- Learns them during idle time
- Respects daily limits

Requires explicit user opt-in.`,
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            enabled: {
                type: 'boolean',
                description: 'Enable or disable proactive learning',
            },
            max_daily_learnings: {
                type: 'number',
                minimum: 1,
                maximum: 10,
                description: 'Maximum background learning sessions per day',
            },
            schedule: {
                type: 'string',
                enum: ['idle', 'scheduled', 'both'],
                description: 'When to run proactive learning',
            },
        },
        required: ['enabled'],
    },
    handler: notImplementedHandler,
};

// ============================================================================
// Tool Collection
// ============================================================================

export const SELF_LEARNING_TOOLS: ToolDefinition[] = [
    triggerLearningTool,
    queryLearningStatusTool,
    validateSkillTool,
    findLearnedCapabilityTool,
    recordCapabilityUsageTool,
    // OpenClaw-style enhancements
    submitFeedbackTool,
    rollbackSkillTool,
    viewSkillHistoryTool,
    getLearningPredictionsTool,
    configureProactiveLearningTool,
];

export default SELF_LEARNING_TOOLS;

// ============================================================================
// Helper to bind actual handlers
// ============================================================================

export interface SelfLearningToolHandlers {
    triggerLearning: (args: { topic: string; context: string; urgency?: string; depth?: string }) => Promise<unknown>;
    queryStatus: (args: { session_id?: string; capability?: string; show_statistics?: boolean; show_needs_attention?: boolean }) => Promise<unknown>;
    validateSkill: (args: { skill_id: string; test_cases?: unknown[]; update_confidence?: boolean }) => Promise<unknown>;
    findCapability: (args: { query: string; include_low_confidence?: boolean }) => Promise<unknown>;
    recordUsage: (args: { capability_id: string; task_id: string; success: boolean; details?: string }) => Promise<unknown>;
    // OpenClaw-style enhancements
    submitFeedback: (args: { entity_id: string; entity_type: 'skill' | 'knowledge'; feedback_type: string; rating?: number; comment?: string; suggested_improvement?: string }) => Promise<unknown>;
    rollbackSkill: (args: { skill_id: string; target_version?: string; reason?: string }) => Promise<unknown>;
    viewSkillHistory: (args: { skill_id: string; compare_versions?: string[] }) => Promise<unknown>;
    getLearningPredictions: (args: { limit?: number; min_confidence?: number }) => Promise<unknown>;
    configureProactiveLearning: (args: { enabled: boolean; max_daily_learnings?: number; schedule?: string }) => Promise<unknown>;
}

/**
 * Create tools with bound handlers
 */
export function createSelfLearningTools(handlers: SelfLearningToolHandlers): ToolDefinition[] {
    return [
        { ...triggerLearningTool, handler: handlers.triggerLearning },
        { ...queryLearningStatusTool, handler: handlers.queryStatus },
        { ...validateSkillTool, handler: handlers.validateSkill },
        { ...findLearnedCapabilityTool, handler: handlers.findCapability },
        { ...recordCapabilityUsageTool, handler: handlers.recordUsage },
        // OpenClaw-style enhancements
        { ...submitFeedbackTool, handler: handlers.submitFeedback },
        { ...rollbackSkillTool, handler: handlers.rollbackSkill },
        { ...viewSkillHistoryTool, handler: handlers.viewSkillHistory },
        { ...getLearningPredictionsTool, handler: handlers.getLearningPredictions },
        { ...configureProactiveLearningTool, handler: handlers.configureProactiveLearning },
    ];
}
