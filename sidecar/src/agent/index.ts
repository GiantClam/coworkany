/**
 * Agent Module
 *
 * Provides the ReAct agent loop controller and autonomous agent capabilities.
 */

// ReAct Loop
export {
    ReActController,
    createReActController,
    formatReActHistory,
    buildReActSystemPrompt,
} from './reactLoop';

export type {
    AgentContext,
    ToolInfo,
    ReActStep,
    ReActResult,
    ReActEvent,
    ReActEventType,
    ReActEventCallback,
    ToolExecutor,
    ReActLlmInterface,
} from './reactLoop';

// Autonomous Agent (OpenClaw-style)
export {
    AutonomousAgentController,
    createAutonomousAgent,
    TASK_DECOMPOSITION_PROMPT,
    MEMORY_EXTRACTION_PROMPT,
    GOAL_VERIFICATION_PROMPT,
} from './autonomousAgent';

export type {
    SubTask,
    AutonomousTask,
    TaskDecomposition,
    MemoryExtraction,
    AutonomousEvent,
    AutonomousEventType,
    AutonomousEventCallback,
    AutonomousLlmInterface,
    GoalVerificationResult,
} from './autonomousAgent';

// Self-Correction Engine
export {
    SelfCorrectionEngine,
    getSelfCorrectionEngine,
    quickAnalyzeError,
    formatErrorForAI,
} from './selfCorrection';

export type {
    RetryStrategy,
    RetryPlan,
    CorrectionContext,
    CorrectionResult,
} from './selfCorrection';

// Adaptive Executor
export {
    AdaptiveExecutor,
    createAdaptiveExecutor,
} from './adaptiveExecutor';

export type {
    AdaptiveExecutionConfig,
    ExecutionStep,
    ExecutionResult,
} from './adaptiveExecutor';

// Adaptive Tool Executor
export {
    AdaptiveToolExecutor,
} from './adaptiveToolExecutor';

// Intent Detector
export {
    IntentDetector,
    createIntentDetector,
} from './intentDetector';

export type {
    TaskIntent,
} from './intentDetector';

// Suspend/Resume Manager
export {
    SuspendResumeManager,
    createSuspendResumeManager,
    ResumeConditions,
} from './suspendResumeManager';

export type {
    SuspendedTask,
    ResumeCondition,
    SuspendResumeConfig,
} from './suspendResumeManager';

// Suspend Coordinator
export {
    SuspendCoordinator,
    createSuspendCoordinator,
} from './suspendCoordinator';

export type {
    SuspendDecision,
} from './suspendCoordinator';
