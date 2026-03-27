import { randomUUID } from 'crypto';
import type { TaskEvent } from '../protocol';
import type {
    CapabilityReviewState,
    CapabilityPlan,
    CheckpointContract,
    DefaultingPolicy,
    DeliverableContract,
    ExecutionProfile,
    HitlPolicy,
    IntentRouting,
    MemoryIsolationPolicy,
    MissingInfoItem,
    ResumeStrategy,
    RuntimeIsolationPolicy,
    SessionIsolationPolicy,
    TenantIsolationPolicy,
    UserActionRequest,
} from '../orchestration/workRequestSchema';
import {
    createInitialTaskProtocolSnapshot,
    reduceTaskProtocolState,
    toTaskFailedPayloadFromProtocolViolation,
    type TaskProtocolSnapshot,
} from './protocolStateMachine';

export type TaskStartedPayload = {
    title: string;
    description?: string;
    estimatedSteps?: number;
    context: {
        workspacePath?: string;
        activeFile?: string;
        userQuery: string;
        packageManager?: string;
        packageManagerCommands?: any;
    };
};

export type TaskFailedPayload = {
    error: string;
    errorCode?: string;
    recoverable: boolean;
    suggestion?: string;
};

export type TaskFinishedPayload = {
    summary: string;
    artifactsCreated?: string[];
    filesModified?: string[];
    duration: number;
};

export type PlanUpdatedPayload = {
    summary: string;
    steps: Array<{
        id: string;
        description: string;
        status: 'pending' | 'in_progress' | 'complete' | 'completed' | 'skipped' | 'failed' | 'blocked';
    }>;
    taskProgress?: Array<{
        taskId: string;
        title: string;
        status: 'pending' | 'in_progress' | 'complete' | 'completed' | 'skipped' | 'failed' | 'blocked';
        dependencies: string[];
    }>;
    currentStepId?: string;
};

export type TaskResearchUpdatedPayload = {
    summary: string;
    sourcesChecked: string[];
    completedQueries: number;
    pendingQueries: number;
    blockingUnknowns: string[];
    selectedStrategyTitle?: string;
};

export type TaskContractReopenedPayload = {
    summary: string;
    reason: string;
    trigger: 'new_scope_signal' | 'missing_resource' | 'permission_block' | 'contradictory_evidence' | 'execution_infeasible';
    reasons?: string[];
    diff?: {
        changedFields: Array<'mode' | 'objective' | 'deliverables' | 'execution_targets' | 'workflow'>;
        modeChanged?: { before: string; after: string };
        objectiveChanged?: { before: string; after: string };
        deliverablesChanged?: { before: string[]; after: string[] };
        targetsChanged?: { before: string[]; after: string[] };
        workflowsChanged?: { before: string[]; after: string[] };
    };
    nextStepId?: string;
};

export type TextDeltaPayload = {
    delta: string;
    role: 'assistant' | 'thinking';
};

export type TaskSuspendedPayload = {
    reason: string;
    userMessage: string;
    canAutoResume: boolean;
    maxWaitTimeMs?: number;
};

export type TaskResumedPayload = {
    resumeReason?: string;
    suspendDurationMs: number;
};

export type TaskPlanReadyPayload = {
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
    deliverables: DeliverableContract[];
    checkpoints: CheckpointContract[];
    userActionsRequired: UserActionRequest[];
    executionProfile?: ExecutionProfile;
    capabilityPlan?: CapabilityPlan;
    capabilityReview?: CapabilityReviewState;
    hitlPolicy?: HitlPolicy;
    runtimeIsolationPolicy?: RuntimeIsolationPolicy;
    sessionIsolationPolicy?: SessionIsolationPolicy;
    memoryIsolationPolicy?: MemoryIsolationPolicy;
    tenantIsolationPolicy?: TenantIsolationPolicy;
    missingInfo: MissingInfoItem[];
    defaultingPolicy?: DefaultingPolicy;
    resumeStrategy?: ResumeStrategy;
};

export type TaskCheckpointReachedPayload = {
    checkpointId: string;
    title: string;
    kind: CheckpointContract['kind'];
    reason: string;
    userMessage: string;
    riskTier: CheckpointContract['riskTier'];
    executionPolicy: CheckpointContract['executionPolicy'];
    requiresUserConfirmation: boolean;
    blocking: boolean;
    activeHardness?: ExecutionProfile['primaryHardness'];
    blockingReason?: string;
};

export type TaskUserActionRequiredPayload = {
    actionId: string;
    title: string;
    kind: UserActionRequest['kind'];
    description: string;
    riskTier: UserActionRequest['riskTier'];
    executionPolicy: UserActionRequest['executionPolicy'];
    blocking: boolean;
    questions: string[];
    instructions: string[];
    fulfillsCheckpointId?: string;
    authUrl?: string;
    authDomain?: string;
    canAutoResume?: boolean;
    activeHardness?: ExecutionProfile['primaryHardness'];
    blockingReason?: string;
};

type TaskEventMeta = {
    timestamp?: string;
    sequence?: number;
};

export class TaskEventBus {
    private readonly sequences = new Map<string, number>();
    private readonly protocolSnapshots = new Map<string, TaskProtocolSnapshot>();
    private readonly emitMessage: (event: TaskEvent) => void;

    constructor(input: {
        emit: (event: TaskEvent) => void;
    }) {
        this.emitMessage = input.emit;
    }

    reset(taskId: string, sequence: number = 0): void {
        this.sequences.set(taskId, sequence);
        this.protocolSnapshots.set(taskId, createInitialTaskProtocolSnapshot());
    }

    nextSequence(taskId: string): number {
        const current = this.sequences.get(taskId) ?? 0;
        const next = current + 1;
        this.sequences.set(taskId, next);
        return next;
    }

    started(taskId: string, payload: TaskStartedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_STARTED', payload, meta);
    }

    failed(taskId: string, payload: TaskFailedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_FAILED', payload, meta);
    }

    status(taskId: string, payload: {
        status: 'running' | 'failed' | 'idle' | 'finished';
        activeHardness?: ExecutionProfile['primaryHardness'];
        blockingReason?: string;
    }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_STATUS', payload, meta);
    }

    clarificationRequired(taskId: string, payload: {
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
        activeHardness?: ExecutionProfile['primaryHardness'];
        blockingReason?: string;
    }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_CLARIFICATION_REQUIRED', payload, meta);
    }

    chatMessage(taskId: string, payload: { role: 'user' | 'assistant' | 'system'; content: string }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'CHAT_MESSAGE', payload, meta);
    }

    toolCall(taskId: string, payload: { id: string; name: string; input: any }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TOOL_CALL', payload, meta);
    }

    toolResult(taskId: string, payload: { toolUseId: string; name: string; result: any; isError?: boolean }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TOOL_RESULT', payload, meta);
    }

    finished(taskId: string, payload: TaskFinishedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_FINISHED', payload, meta);
    }

    planUpdated(taskId: string, payload: PlanUpdatedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'PLAN_UPDATED', payload, meta);
    }

    researchUpdated(taskId: string, payload: TaskResearchUpdatedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_RESEARCH_UPDATED', payload, meta);
    }

    contractReopened(taskId: string, payload: TaskContractReopenedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_CONTRACT_REOPENED', payload, meta);
    }

    textDelta(taskId: string, payload: TextDeltaPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TEXT_DELTA', payload, meta);
    }

    thinkingDelta(taskId: string, payload: { delta: string }, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'THINKING_DELTA', payload, meta);
    }

    suspended(taskId: string, payload: TaskSuspendedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_SUSPENDED', payload, meta);
    }

    resumed(taskId: string, payload: TaskResumedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_RESUMED', payload, meta);
    }

    planReady(taskId: string, payload: TaskPlanReadyPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_PLAN_READY', payload, meta);
    }

    checkpointReached(taskId: string, payload: TaskCheckpointReachedPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_CHECKPOINT_REACHED', payload, meta);
    }

    userActionRequired(taskId: string, payload: TaskUserActionRequiredPayload, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, 'TASK_USER_ACTION_REQUIRED', payload, meta);
    }

    raw(taskId: string, type: string, payload: unknown, meta?: TaskEventMeta): TaskEvent {
        return this.build(taskId, type, payload, meta);
    }

    emit(event: TaskEvent): void {
        this.emitMessage(event);
    }

    emitStarted(taskId: string, payload: TaskStartedPayload, meta?: TaskEventMeta): void {
        this.emit(this.started(taskId, payload, meta));
    }

    emitFailed(taskId: string, payload: TaskFailedPayload, meta?: TaskEventMeta): void {
        this.emit(this.failed(taskId, payload, meta));
    }

    emitStatus(taskId: string, payload: {
        status: 'running' | 'failed' | 'idle' | 'finished';
        activeHardness?: ExecutionProfile['primaryHardness'];
        blockingReason?: string;
    }, meta?: TaskEventMeta): void {
        this.emit(this.status(taskId, payload, meta));
    }

    emitClarificationRequired(taskId: string, payload: {
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
        activeHardness?: ExecutionProfile['primaryHardness'];
        blockingReason?: string;
    }, meta?: TaskEventMeta): void {
        this.emit(this.clarificationRequired(taskId, payload, meta));
    }

    emitChatMessage(taskId: string, payload: { role: 'user' | 'assistant' | 'system'; content: string }, meta?: TaskEventMeta): void {
        this.emit(this.chatMessage(taskId, payload, meta));
    }

    emitToolCall(taskId: string, payload: { id: string; name: string; input: any }, meta?: TaskEventMeta): void {
        this.emit(this.toolCall(taskId, payload, meta));
    }

    emitToolResult(taskId: string, payload: { toolUseId: string; name: string; result: any; isError?: boolean }, meta?: TaskEventMeta): void {
        this.emit(this.toolResult(taskId, payload, meta));
    }

    emitFinished(taskId: string, payload: TaskFinishedPayload, meta?: TaskEventMeta): void {
        this.emit(this.finished(taskId, payload, meta));
    }

    emitPlanUpdated(taskId: string, payload: PlanUpdatedPayload, meta?: TaskEventMeta): void {
        this.emit(this.planUpdated(taskId, payload, meta));
    }

    emitResearchUpdated(taskId: string, payload: TaskResearchUpdatedPayload, meta?: TaskEventMeta): void {
        this.emit(this.researchUpdated(taskId, payload, meta));
    }

    emitContractReopened(taskId: string, payload: TaskContractReopenedPayload, meta?: TaskEventMeta): void {
        this.emit(this.contractReopened(taskId, payload, meta));
    }

    emitTextDelta(taskId: string, payload: TextDeltaPayload, meta?: TaskEventMeta): void {
        this.emit(this.textDelta(taskId, payload, meta));
    }

    emitThinkingDelta(taskId: string, payload: { delta: string }, meta?: TaskEventMeta): void {
        this.emit(this.thinkingDelta(taskId, payload, meta));
    }

    emitSuspended(taskId: string, payload: TaskSuspendedPayload, meta?: TaskEventMeta): void {
        this.emit(this.suspended(taskId, payload, meta));
    }

    emitResumed(taskId: string, payload: TaskResumedPayload, meta?: TaskEventMeta): void {
        this.emit(this.resumed(taskId, payload, meta));
    }

    emitPlanReady(taskId: string, payload: TaskPlanReadyPayload, meta?: TaskEventMeta): void {
        this.emit(this.planReady(taskId, payload, meta));
    }

    emitCheckpointReached(taskId: string, payload: TaskCheckpointReachedPayload, meta?: TaskEventMeta): void {
        this.emit(this.checkpointReached(taskId, payload, meta));
    }

    emitUserActionRequired(taskId: string, payload: TaskUserActionRequiredPayload, meta?: TaskEventMeta): void {
        this.emit(this.userActionRequired(taskId, payload, meta));
    }

    emitRaw(taskId: string, type: string, payload: unknown, meta?: TaskEventMeta): void {
        this.emit(this.raw(taskId, type, payload, meta));
    }

    private build(taskId: string, type: string, payload: unknown, meta?: TaskEventMeta): TaskEvent {
        const currentSnapshot = this.protocolSnapshots.get(taskId) ?? createInitialTaskProtocolSnapshot();
        const reduction = reduceTaskProtocolState(currentSnapshot, { type, payload });

        let eventType = type;
        let eventPayload = payload;

        if (reduction.ok) {
            this.protocolSnapshots.set(taskId, reduction.snapshot);
        } else {
            const violationPayload = toTaskFailedPayloadFromProtocolViolation(reduction.violation);
            eventType = 'TASK_FAILED';
            eventPayload = violationPayload;
            const failedReduction = reduceTaskProtocolState(reduction.snapshot, {
                type: 'TASK_FAILED',
                payload: violationPayload,
            });
            if (failedReduction.ok) {
                this.protocolSnapshots.set(taskId, failedReduction.snapshot);
            }
        }

        return {
            id: randomUUID(),
            taskId,
            timestamp: meta?.timestamp ?? new Date().toISOString(),
            sequence: this.resolveSequence(taskId, meta?.sequence),
            type: eventType,
            payload: eventPayload,
        } as TaskEvent;
    }

    private resolveSequence(taskId: string, override?: number): number {
        if (override === undefined) {
            return this.nextSequence(taskId);
        }
        const current = this.sequences.get(taskId) ?? 0;
        if (override > current) {
            this.sequences.set(taskId, override);
        }
        return override;
    }
}
