/**
 * CoworkAny - Self-Learning Agent Types
 *
 * Core type definitions for the self-learning system.
 * Enables AI to learn new capabilities from the internet,
 * validate them, and save as reusable skills/knowledge.
 */

// ============================================================================
// Capability Gap Types
// ============================================================================

export type GapType = 'library' | 'tool' | 'domain_knowledge' | 'procedure';

export interface CapabilityGap {
    id: string;
    type: GapType;
    description: string;
    userQuery: string;
    detectedAt: string;
    confidence: number;
    suggestedResearchQueries: string[];
    existingSimilarKnowledge?: string[];
    keywords: string[];
}

export interface GapDetectionResult {
    hasGap: boolean;
    gaps: CapabilityGap[];
    canProceedWithPartialKnowledge: boolean;
    recommendedAction: 'learn' | 'ask_user' | 'proceed' | 'delegate';
    matchedSkills?: string[];
    matchedKnowledge?: string[];
}

// ============================================================================
// Research Types
// ============================================================================

export type SourceType = 'official_docs' | 'tutorial' | 'stackoverflow' | 'github' | 'blog' | 'other';
export type QueryType = 'tutorial' | 'documentation' | 'example_code' | 'troubleshooting';

export interface ResearchQuery {
    query: string;
    queryType: QueryType;
    priority: number;
}

export interface ResearchSource {
    url: string;
    title: string;
    sourceType: SourceType;
    contentSnippet: string;
    reliability: number;  // 0-1
    fetchedAt: string;
    fullContent?: string;
}

export interface CodeExample {
    language: string;
    code: string;
    source: string;
    description: string;
    dependencies?: string[];
}

export interface ResearchResult {
    gap: CapabilityGap;
    sources: ResearchSource[];
    synthesizedKnowledge?: string;
    codeExamples: CodeExample[];
    dependencies: string[];
    researchTimeMs: number;
    confidence: number;
}

// ============================================================================
// Learning Types
// ============================================================================

export type KnowledgeType = 'concept' | 'procedure' | 'api_reference' | 'troubleshooting';

export interface ProcessedKnowledge {
    id: string;
    type: KnowledgeType;
    title: string;
    summary: string;
    detailedContent: string;
    prerequisites: string[];
    steps?: string[];
    codeTemplate?: string;
    dependencies: string[];
    confidence: number;
    sourceResearch: ResearchResult;
    createdAt: string;
}

export interface TestCase {
    id: string;
    name: string;
    input: string;
    expectedBehavior: string;
    validationScript?: string;
}

export interface LearningOutcome {
    knowledge: ProcessedKnowledge[];
    canGenerateSkill: boolean;
    suggestedSkillName?: string;
    validationRequired: boolean;
    estimatedTestCases: TestCase[];
}

// ============================================================================
// Experiment Types
// ============================================================================

export interface ExperimentConfig {
    knowledge: ProcessedKnowledge;
    testCases: TestCase[];
    maxRetries: number;
    timeoutMs: number;
    isolationLevel: 'full' | 'shared_deps';
}

export interface TestResult {
    testCase: TestCase;
    passed: boolean;
    output: string;
    error?: string;
    executionTimeMs: number;
}

export interface ExperimentResult {
    success: boolean;
    testResults: TestResult[];
    installedDependencies: string[];
    discoveredIssues: string[];
    refinements: string[];
    executionTimeMs: number;
    finalWorkingCode?: string;
    retryCount: number;
}

// ============================================================================
// Precipitation Types
// ============================================================================

export type PrecipitationType =
    | 'knowledge_entry'   // Simple knowledge entry
    | 'procedure'         // Multi-step procedure
    | 'skill_draft'       // Skill draft (needs review)
    | 'skill_auto';       // Auto-generated skill

export interface PrecipitationDecision {
    type: PrecipitationType;
    reason: string;
    targetPath: string;
    requiresUserApproval: boolean;
}

export interface GeneratedSkill {
    manifest: {
        id: string;
        name: string;
        version: string;
        description: string;
        tags: string[];
        triggers: string[];
        allowedTools: string[];
        requires?: {
            tools: string[];
            skills: string[];       // Dependent skills
            capabilities: string[];
            bins: string[];
            env: string[];
        };
        // Dependency metadata for composable skills
        composedFrom?: {
            tools: Array<{ id: string; purpose: string }>;
            skills: Array<{ id: string; purpose: string; version?: string }>;
        };
    };
    skillMd: string;
    scripts?: Record<string, string>;
    references?: Record<string, string>;
    // Inline fallback code when dependencies unavailable
    fallbacks?: Record<string, string>;
    // Optional generated runtime tool definition source code
    generatedToolCode?: {
        fileName: string;
        exportName: string;
        content: string;
    };
    runtimeTool?: GeneratedRuntimeToolSpec;
}

export interface GeneratedRuntimeToolSpec {
    name: string;
    description: string;
    language: 'python' | 'javascript';
    templateCode: string;
    sourceSkillId: string;
}

export interface PrecipitationResult {
    success: boolean;
    type: PrecipitationType;
    path: string;
    entityId: string;
    error?: string;
}

// ============================================================================
// Reuse Types
// ============================================================================

export interface SkillMatchResult {
    skillId: string;
    skillName: string;
    matchScore: number;
    matchedTriggers: string[];
    usageCount: number;
    successRate: number;
}

export interface KnowledgeMatchResult {
    knowledgeId: string;
    title: string;
    matchScore: number;
    path: string;
    category: string;
}

export interface ReuseDecision {
    shouldUseExisting: boolean;
    matchedSkills: SkillMatchResult[];
    matchedKnowledge: KnowledgeMatchResult[];
    recommendation: 'use_skill' | 'use_knowledge' | 'learn_new' | 'hybrid';
    confidence: number;
}

// ============================================================================
// Confidence Types
// ============================================================================

export interface UsageRecord {
    timestamp: string;
    taskId: string;
    success: boolean;
    details?: string;
}

export interface ConfidenceRecord {
    entityId: string;
    entityType: 'knowledge' | 'skill';
    initialConfidence: number;
    currentConfidence: number;
    usageHistory: UsageRecord[];
    successRate: number;
    lastUpdated: string;
    needsRelearning: boolean;
    relearningReason?: string;
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionStatus =
    | 'detecting'
    | 'researching'
    | 'learning'
    | 'experimenting'
    | 'precipitating'
    | 'completed'
    | 'failed'
    | 'cancelled';

export interface LearningSession {
    id: string;
    triggerQuery: string;
    gaps: CapabilityGap[];
    status: SessionStatus;
    startTime: string;
    endTime?: string;
    currentPhase: string;
    progress: number;  // 0-100
    outcomes: Array<{
        type: 'knowledge' | 'skill';
        id: string;
        path: string;
    }>;
    errors: string[];
    logs: Array<{
        timestamp: string;
        level: 'info' | 'warn' | 'error';
        message: string;
    }>;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface SelfLearningConfig {
    autoLearnEnabled: boolean;
    requireUserApprovalForSkills: boolean;
    maxResearchTimeMs: number;
    maxExperimentRetries: number;
    minConfidenceToSave: number;
    minConfidenceToAutoUse: number;
    relearningThreshold: number;
    maxConcurrentSessions: number;
    researchDepth: 'shallow' | 'medium' | 'deep';
    experimentIsolation: 'full' | 'shared_deps';
}

export const DEFAULT_CONFIG: SelfLearningConfig = {
    autoLearnEnabled: true,
    requireUserApprovalForSkills: true,
    maxResearchTimeMs: 60000,  // 1 minute
    maxExperimentRetries: 3,
    minConfidenceToSave: 0.6,
    minConfidenceToAutoUse: 0.8,
    relearningThreshold: 0.3,
    maxConcurrentSessions: 2,
    researchDepth: 'medium',
    experimentIsolation: 'shared_deps',
};

// ============================================================================
// Event Types
// ============================================================================

export type SelfLearningEventType =
    | 'session_started'
    | 'gap_detected'
    | 'research_started'
    | 'research_completed'
    | 'learning_started'
    | 'learning_completed'
    | 'experiment_started'
    | 'experiment_completed'
    | 'precipitation_started'
    | 'precipitation_completed'
    | 'session_completed'
    | 'session_failed'
    | 'confidence_updated';

export interface SelfLearningEvent {
    type: SelfLearningEventType;
    sessionId: string;
    timestamp: string;
    data: Record<string, unknown>;
}

export type SelfLearningEventHandler = (event: SelfLearningEvent) => void;

// ============================================================================
// User Feedback Types (OpenClaw-style)
// ============================================================================

export type FeedbackType = 'helpful' | 'not_helpful' | 'partially_helpful' | 'needs_improvement';

export interface UserFeedback {
    id: string;
    entityId: string;
    entityType: 'knowledge' | 'skill';
    feedbackType: FeedbackType;
    rating?: number;  // 1-5 stars
    comment?: string;
    suggestedImprovement?: string;
    timestamp: string;
    taskContext?: string;
}

export interface FeedbackStats {
    entityId: string;
    totalFeedback: number;
    helpfulCount: number;
    notHelpfulCount: number;
    averageRating: number;
    commonIssues: string[];
    lastFeedback: string;
}

// ============================================================================
// Skill Versioning Types (OpenClaw-style)
// ============================================================================

export interface SkillVersion {
    version: string;
    createdAt: string;
    changelog: string;
    author: 'auto' | 'user';
    confidence: number;
    testResults?: {
        passed: number;
        failed: number;
        skipped: number;
    };
    rollbackReason?: string;
}

export interface SkillVersionHistory {
    skillId: string;
    currentVersion: string;
    versions: SkillVersion[];
    autoRollbackEnabled: boolean;
    maxVersionsToKeep: number;
}

// ============================================================================
// Skill Composition Types (OpenClaw-style)
// ============================================================================

export type CompositionNodeType = 'skill' | 'condition' | 'loop' | 'parallel' | 'sequence';

export interface CompositionNode {
    id: string;
    type: CompositionNodeType;
    skillId?: string;
    condition?: string;
    children?: CompositionNode[];
    inputs?: Record<string, string>;
    outputs?: Record<string, string>;
}

export interface ComposedSkill {
    id: string;
    name: string;
    description: string;
    rootNode: CompositionNode;
    dependencies: string[];  // skill IDs
    variables: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

// ============================================================================
// Proactive Learning Types (OpenClaw-style)
// ============================================================================

export interface LearningPrediction {
    topic: string;
    confidence: number;
    reason: string;
    basedOnPatterns: string[];
    estimatedUsefulness: number;
    priority: 'low' | 'medium' | 'high';
}

export interface ProactiveLearningConfig {
    enabled: boolean;
    maxBackgroundSessions: number;
    learningSchedule: 'idle' | 'scheduled' | 'both';
    scheduledTimes?: string[];  // cron expressions
    minPredictionConfidence: number;
    maxDailyLearnings: number;
}

// ============================================================================
// ClawHub Integration Types
// ============================================================================

export interface ClawHubSkill {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    downloads: number;
    rating: number;
    tags: string[];
    url: string;
    verified: boolean;
    lastUpdated: string;
}

export interface ClawHubSearchResult {
    skills: ClawHubSkill[];
    totalCount: number;
    page: number;
    pageSize: number;
}

export interface ClawHubConfig {
    enabled: boolean;
    registryUrl: string;
    autoCheckUpdates: boolean;
    preferVerified: boolean;
}

// ============================================================================
// Skill Composition & Dependency Types
// ============================================================================

/**
 * Defines how a skill depends on other skills/tools
 */
export interface SkillDependency {
    type: 'skill' | 'tool' | 'builtin';
    id: string;
    name: string;
    purpose: string;  // Why this dependency is needed
    required: boolean;
    fallback?: {
        type: 'inline' | 'skip' | 'error';
        inlineCode?: string;  // Code to use if dependency unavailable
    };
    versionConstraint?: string;  // e.g., ">=1.0.0"
}

/**
 * Result of resolving skill dependencies
 */
export interface DependencyResolution {
    resolved: Array<{
        dependency: SkillDependency;
        resolvedTo: string;  // Actual ID of resolved skill/tool
        version?: string;
    }>;
    missing: Array<{
        dependency: SkillDependency;
        reason: string;
        suggestedAlternatives?: string[];
    }>;
    canProceed: boolean;
}

/**
 * Strategy for generating skills with dependencies
 */
export interface SkillGenerationStrategy {
    preferExistingTools: boolean;  // Prefer built-in tools over inline code
    preferExistingSkills: boolean; // Prefer existing skills over creating new ones
    allowInlineFallback: boolean;  // Allow inline code when dependency missing
    maxDependencyDepth: number;    // Max depth of dependency chain (prevent loops)
    inlineThreshold: number;       // Lines of code below which to inline instead of depend
}

export const DEFAULT_SKILL_GENERATION_STRATEGY: SkillGenerationStrategy = {
    preferExistingTools: true,
    preferExistingSkills: true,
    allowInlineFallback: true,
    maxDependencyDepth: 3,
    inlineThreshold: 20,
};

/**
 * Mapping of common operations to built-in tools
 */
export interface ToolCapabilityMapping {
    capability: string;
    tools: Array<{
        toolId: string;
        priority: number;  // Higher = preferred
        conditions?: string[];  // When to prefer this tool
    }>;
}
