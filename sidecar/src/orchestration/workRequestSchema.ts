import type { LocalTaskPlanHint } from './localTaskIntent';
import type { ResolvedFolderReference } from '../system/wellKnownFolders';

export type WorkMode =
    | 'chat'
    | 'immediate_task'
    | 'scheduled_task'
    | 'scheduled_multi_task';

export type PresentationContract = {
    uiFormat: 'chat_message' | 'table' | 'report' | 'artifact';
    ttsEnabled: boolean;
    ttsMode: 'summary' | 'full';
    ttsMaxChars: number;
    language: string;
};

export type DeliverableContract = {
    id: string;
    title: string;
    type: 'chat_reply' | 'report_file' | 'artifact_file' | 'workspace_change' | 'code_change';
    description: string;
    required: boolean;
    path?: string;
    format?: string;
};

export type CheckpointContract = {
    id: string;
    title: string;
    kind: 'review' | 'manual_action' | 'pre_delivery';
    reason: string;
    userMessage: string;
    riskTier: HitlRiskTier;
    executionPolicy: HitlExecutionPolicy;
    requiresUserConfirmation: boolean;
    blocking: boolean;
};

export type UserActionRequest = {
    id: string;
    title: string;
    kind: 'clarify_input' | 'confirm_plan' | 'manual_step' | 'external_auth';
    description: string;
    riskTier: HitlRiskTier;
    executionPolicy: HitlExecutionPolicy;
    blocking: boolean;
    questions: string[];
    instructions: string[];
    fulfillsCheckpointId?: string;
};

export type HitlRiskTier = 'low' | 'medium' | 'high';
export type HitlExecutionPolicy = 'auto' | 'review_required' | 'hard_block';

export type HitlPolicy = {
    riskTier: HitlRiskTier;
    requiresPlanConfirmation: boolean;
    reasons: string[];
};

export type RuntimeIsolationPolicy = {
    connectorIsolationMode: 'deny_by_default';
    filesystemMode: 'workspace_only' | 'workspace_plus_resolved_targets';
    allowedWorkspacePaths: string[];
    writableWorkspacePaths: string[];
    networkAccess: 'none' | 'restricted';
    allowedDomains: string[];
    notes: string[];
};

export type SessionIsolationPolicy = {
    workspaceBindingMode: 'frozen_workspace_only';
    followUpScope: 'same_task_only';
    allowWorkspaceOverride: boolean;
    supersededContractHandling: 'tombstone_prior_contracts';
    staleEvidenceHandling: 'evict_on_refreeze';
    notes: string[];
};

export type MemoryScope = 'task' | 'workspace' | 'user_preference' | 'system';

export type MemoryIsolationPolicy = {
    classificationMode: 'scope_tagged';
    readScopes: MemoryScope[];
    writeScopes: MemoryScope[];
    defaultWriteScope: MemoryScope;
    notes: string[];
};

export type TenantIsolationPolicy = {
    workspaceBoundaryMode: 'same_workspace_only';
    userBoundaryMode: 'current_local_user_only';
    allowCrossWorkspaceMemory: boolean;
    allowCrossWorkspaceFollowUp: boolean;
    allowCrossUserMemory: boolean;
    notes: string[];
};

export type MissingInfoItem = {
    field: string;
    reason: string;
    blocking: boolean;
    question?: string;
    defaultValue?: string;
};

export type DefaultingPolicy = {
    outputLanguage: string;
    uiFormat: PresentationContract['uiFormat'];
    artifactDirectory: string;
    checkpointStrategy: 'none' | 'review_before_completion' | 'manual_action';
};

export type ResumeStrategy = {
    mode: 'continue_from_saved_context';
    preserveDeliverables: boolean;
    preserveCompletedSteps: boolean;
    preserveArtifacts: boolean;
};

export type GoalFrame = {
    objective: string;
    constraints: string[];
    preferences: string[];
    contextSignals: string[];
    successHypothesis: string[];
    taskCategory: 'research' | 'coding' | 'browser' | 'workspace' | 'app_management' | 'mixed';
};

export type ResearchSource =
    | 'conversation'
    | 'workspace'
    | 'memory'
    | 'connected_app'
    | 'web'
    | 'template';

export type ResearchKind =
    | 'domain_research'
    | 'context_research'
    | 'feasibility_research';

export type ResearchQuery = {
    id: string;
    kind: ResearchKind;
    source: ResearchSource;
    objective: string;
    required: boolean;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
};

export type ResearchEvidence = {
    id: string;
    kind: ResearchKind;
    source: ResearchSource;
    summary: string;
    confidence: number;
    uri?: string;
    artifactPath?: string;
    collectedAt: string;
};

export type FactStatus =
    | 'confirmed'
    | 'inferred'
    | 'blocking_unknown'
    | 'defaultable';

export type UncertaintyItem = {
    id: string;
    topic: string;
    status: FactStatus;
    statement: string;
    whyItMatters: string;
    question?: string;
    defaultValue?: string;
    supportingEvidenceIds: string[];
};

export type StrategyOption = {
    id: string;
    title: string;
    description: string;
    pros: string[];
    cons: string[];
    feasibility: 'high' | 'medium' | 'low';
    supportingEvidenceIds: string[];
    selected: boolean;
    rejectionReason?: string;
};

export type ReplanTrigger =
    | 'new_scope_signal'
    | 'missing_resource'
    | 'permission_block'
    | 'contradictory_evidence'
    | 'execution_infeasible';

export type ReplanPolicy = {
    allowReturnToResearch: boolean;
    triggers: ReplanTrigger[];
};

export type TaskDefinition = {
    id: string;
    title: string;
    objective: string;
    constraints: string[];
    acceptanceCriteria: string[];
    dependencies: string[];
    preferredSkills: string[];
    preferredTools: string[];
    preferredWorkflow?: string;
    resolvedTargets?: ResolvedFolderReference[];
    localPlanHint?: LocalTaskPlanHint;
};

export type ClarificationDecision = {
    required: boolean;
    reason?: string;
    questions: string[];
    missingFields: string[];
    canDefault: boolean;
    assumptions: string[];
};

export type NormalizedWorkRequest = {
    schemaVersion: 1;
    mode: WorkMode;
    sourceText: string;
    workspacePath: string;
    schedule?: {
        executeAt?: string;
        timezone: string;
        recurrence?: null | { kind: 'rrule'; value: string };
        stages?: Array<{
            taskId: string;
            executeAt: string;
            delayMsFromPrevious?: number;
            originalTimeExpression?: string;
        }>;
    };
    tasks: TaskDefinition[];
    clarification: ClarificationDecision;
    presentation: PresentationContract;
    deliverables?: DeliverableContract[];
    checkpoints?: CheckpointContract[];
    userActionsRequired?: UserActionRequest[];
    hitlPolicy?: HitlPolicy;
    runtimeIsolationPolicy?: RuntimeIsolationPolicy;
    sessionIsolationPolicy?: SessionIsolationPolicy;
    memoryIsolationPolicy?: MemoryIsolationPolicy;
    tenantIsolationPolicy?: TenantIsolationPolicy;
    missingInfo?: MissingInfoItem[];
    defaultingPolicy?: DefaultingPolicy;
    resumeStrategy?: ResumeStrategy;
    goalFrame?: GoalFrame;
    researchQueries?: ResearchQuery[];
    researchEvidence?: ResearchEvidence[];
    uncertaintyRegistry?: UncertaintyItem[];
    strategyOptions?: StrategyOption[];
    selectedStrategyId?: string;
    knownRisks?: string[];
    replanPolicy?: ReplanPolicy;
    createdAt: string;
};

export type FrozenWorkRequest = NormalizedWorkRequest & {
    id: string;
    frozenAt: string;
    frozenResearchSummary?: {
        evidenceCount: number;
        sourcesChecked: ResearchSource[];
        blockingUnknownCount: number;
        selectedStrategyTitle?: string;
    };
};

export type ExecutionPlanStepKind =
    | 'analysis'
    | 'clarification'
    | 'goal_framing'
    | 'research'
    | 'uncertainty_resolution'
    | 'contract_freeze'
    | 'execution'
    | 'reduction'
    | 'presentation';

export type ExecutionPlan = {
    workRequestId: string;
    runMode: 'single' | 'dag';
    steps: Array<{
        stepId: string;
        taskId?: string;
        kind: ExecutionPlanStepKind;
        title: string;
        description: string;
        status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
        dependencies: string[];
    }>;
};

export type PresentationPayload = {
    canonicalResult: string;
    uiSummary: string;
    ttsSummary: string;
    artifacts: string[];
};
