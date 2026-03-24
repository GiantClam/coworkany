import { randomUUID } from 'crypto';
import {
    ensurePlanningFilesForWorkRequest,
    shouldUsePlanningFiles,
    updatePlanningStepStatus,
} from './planningFiles';
import { WorkRequestStore } from './workRequestStore';
import {
    analyzeWorkRequest,
    buildExecutionPlan,
    buildExecutionQuery,
    buildExecutionQueryForTaskIds,
    freezeWorkRequest,
} from './workRequestAnalyzer';
import {
    buildResearchUpdatedPayload,
    runPreFreezeResearchLoop,
    type ResearchLoopOptions,
    type ResearchLoopResolvers,
} from './researchLoop';
import {
    type CheckpointContract,
    type FrozenWorkRequest,
    type NormalizedWorkRequest,
    type ReplanTrigger,
    type ResearchEvidence,
    type UserActionRequest,
} from './workRequestSchema';
import { type ScheduledTaskRecord } from '../scheduling/scheduledTasks';
import { formatWorkflowForPrompt, selectLocalWorkflow } from './localWorkflowRegistry';

export type PreparedWorkRequestContext = {
    frozenWorkRequest: FrozenWorkRequest;
    executionPlan: ReturnType<typeof buildExecutionPlan>;
    executionQuery: string;
    preferredSkillIds: string[];
    workRequestExecutionPrompt?: string;
};

export type ScheduledExecutionStagePlan = {
    taskId?: string;
    title: string;
    taskQuery: string;
    executeAt: string;
    stageIndex: number;
    totalStages: number;
    delayMsFromPrevious?: number;
    executionMode: ScheduledExecutionMode;
};

export type ScheduledExecutionMode = 'sequential' | 'parallel';

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

export type ContractReopenedPayload = {
    summary: string;
    reason: string;
    trigger: ReplanTrigger;
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

export { buildResearchUpdatedPayload };

export function createFrozenWorkRequestFromText(input: {
    sourceText: string;
    workspacePath: string;
    workRequestStore: WorkRequestStore;
    researchResolvers?: ResearchLoopResolvers;
    researchOptions?: ResearchLoopOptions;
}): Promise<FrozenWorkRequest> {
    return createFrozenWorkRequestFromTextInternal(input);
}

export async function refreezePreparedWorkRequestForResearch(input: {
    prepared: PreparedWorkRequestContext;
    reason: string;
    trigger: ReplanTrigger;
    workRequestStore: WorkRequestStore;
    researchResolvers?: ResearchLoopResolvers;
    researchOptions?: ResearchLoopOptions;
}): Promise<PreparedWorkRequestContext> {
    const previousFrozen = input.prepared.frozenWorkRequest;
    const {
        id: _previousId,
        frozenAt: _previousFrozenAt,
        frozenResearchSummary: _previousFrozenResearchSummary,
        ...normalizedBase
    } = previousFrozen;

    const executionEvidence: ResearchEvidence = {
        id: randomUUID(),
        kind: 'feasibility_research',
        source: 'conversation',
        summary: `Execution-time evidence triggered contract reopen via ${input.trigger}: ${input.reason}`,
        confidence: 0.92,
        collectedAt: new Date().toISOString(),
    };

    const normalized: NormalizedWorkRequest = {
        ...normalizedBase,
        researchQueries: (normalizedBase.researchQueries ?? []).map((query) => ({
            ...query,
            status: 'pending',
        })),
        researchEvidence: [...(normalizedBase.researchEvidence ?? []), executionEvidence],
        knownRisks: Array.from(new Set([...(normalizedBase.knownRisks ?? []), input.reason])),
    };

    const researched = await runPreFreezeResearchLoop({
        request: normalized,
        workRequestStore: input.workRequestStore,
        resolvers: input.researchResolvers,
        options: input.researchOptions,
    });
    const refrozen = freezeWorkRequest(researched);
    const nextFrozen: FrozenWorkRequest = {
        ...refrozen,
        id: previousFrozen.id,
        createdAt: previousFrozen.createdAt,
    };

    input.workRequestStore.upsert(nextFrozen);
    input.prepared.frozenWorkRequest = nextFrozen;
    input.prepared.executionPlan = buildExecutionPlan(nextFrozen);
    input.prepared.executionQuery = buildExecutionQuery(nextFrozen);
    input.prepared.preferredSkillIds = getPreferredSkillIdsFromWorkRequest(nextFrozen);
    input.prepared.workRequestExecutionPrompt = buildWorkRequestExecutionPrompt(nextFrozen);

    ensurePlanningFilesForWorkRequest({
        request: nextFrozen,
        plan: input.prepared.executionPlan,
    });

    return input.prepared;
}

async function createFrozenWorkRequestFromTextInternal(input: {
    sourceText: string;
    workspacePath: string;
    workRequestStore: WorkRequestStore;
    researchResolvers?: ResearchLoopResolvers;
    researchOptions?: ResearchLoopOptions;
}): Promise<FrozenWorkRequest> {
    const analyzed = analyzeWorkRequest({
        sourceText: input.sourceText,
        workspacePath: input.workspacePath,
    });
    const researched = await runPreFreezeResearchLoop({
        request: analyzed,
        workRequestStore: input.workRequestStore,
        resolvers: input.researchResolvers,
        options: input.researchOptions,
    });
    const frozen = freezeWorkRequest(researched);
    input.workRequestStore.create(frozen);
    return frozen;
}

export async function prepareWorkRequestContext(input: {
    sourceText: string;
    workspacePath: string;
    workRequestStore: WorkRequestStore;
    researchResolvers?: ResearchLoopResolvers;
    researchOptions?: ResearchLoopOptions;
}): Promise<PreparedWorkRequestContext> {
    const frozenWorkRequest = await createFrozenWorkRequestFromText(input);
    const executionPlan = buildExecutionPlan(frozenWorkRequest);

    ensurePlanningFilesForWorkRequest({
        request: frozenWorkRequest,
        plan: executionPlan,
    });

    return {
        frozenWorkRequest,
        executionPlan,
        executionQuery: buildExecutionQuery(frozenWorkRequest),
        preferredSkillIds: getPreferredSkillIdsFromWorkRequest(frozenWorkRequest),
        workRequestExecutionPrompt: buildWorkRequestExecutionPrompt(frozenWorkRequest),
    };
}

export function prepareExecutionContextFromFrozen(input: {
    request: FrozenWorkRequest;
    stageTaskId?: string;
    stageIndex?: number;
    executionQueryOverride?: string;
}): PreparedWorkRequestContext {
    const allTasks = input.request.tasks ?? [];
    const stageTask = input.stageTaskId
        ? allTasks.find((task) => task.id === input.stageTaskId)
        : allTasks[0];
    const scopedTasks = stageTask ? [stageTask] : allTasks.slice(0, 1);
    const selectedTaskIds = scopedTasks.map((task) => task.id);
    const scopedRequest: FrozenWorkRequest = {
        ...input.request,
        mode: 'immediate_task',
        sourceText: scopedTasks[0]?.objective || input.request.sourceText,
        schedule: undefined,
        tasks: scopedTasks,
        clarification: {
            ...input.request.clarification,
            required: false,
            reason: undefined,
            questions: [],
            missingFields: [],
        },
        // Execution-time user actions should be decided during initial planning, not mid-run.
        userActionsRequired: [],
        // Only the first stage keeps original deliverable requirements (e.g., output files).
        deliverables: typeof input.stageIndex === 'number' && input.stageIndex > 0
            ? []
            : input.request.deliverables,
    };
    const executionQuery = (input.executionQueryOverride || '').trim()
        || buildExecutionQueryForTaskIds(
            input.request,
            selectedTaskIds,
            { includeGlobalContracts: false },
        ).trim()
        || buildExecutionQuery(scopedRequest).trim()
        || scopedTasks[0]?.objective?.trim()
        || input.request.sourceText.trim();

    return {
        frozenWorkRequest: scopedRequest,
        executionPlan: buildExecutionPlan(scopedRequest),
        executionQuery,
        preferredSkillIds: getPreferredSkillIdsFromWorkRequest(scopedRequest, selectedTaskIds),
        workRequestExecutionPrompt: buildWorkRequestExecutionPrompt(scopedRequest),
    };
}

export function buildClarificationMessage(request: FrozenWorkRequest): string {
    if (request.clarification.questions.length === 0) {
        return request.clarification.reason || '需要更多信息后才能继续执行。';
    }

    return request.clarification.questions.join('\n');
}

export function buildBlockingUserActionMessage(action: Pick<UserActionRequest, 'description' | 'questions' | 'instructions'>): string {
    const lines = [
        action.description,
        ...action.questions,
        ...action.instructions,
    ].map((value) => value.trim()).filter(Boolean);

    return lines.join('\n');
}

export function buildWorkRequestPlanSummary(request: {
    tasks?: Array<{ objective?: string }>;
    sourceText?: string;
    deliverables?: Array<unknown>;
    checkpoints?: Array<unknown>;
    userActionsRequired?: Array<{ blocking?: boolean }>;
}): string {
    const tasks = request.tasks ?? [];
    const taskCount = tasks.length;
    const deliverableCount = request.deliverables?.length ?? 0;
    const checkpointCount = request.checkpoints?.length ?? 0;
    const manualActionCount = request.userActionsRequired?.filter((action) => action.blocking).length ?? 0;
    const primaryTask = tasks[0];
    const objective = primaryTask?.objective || request.sourceText;
    const clauses = [
        taskCount > 1 ? `${taskCount} coordinated tasks` : '1 primary task',
        deliverableCount > 0 ? `${deliverableCount} deliverable${deliverableCount === 1 ? '' : 's'}` : null,
        checkpointCount > 0 ? `${checkpointCount} checkpoint${checkpointCount === 1 ? '' : 's'}` : null,
        manualActionCount > 0 ? `${manualActionCount} blocking user action${manualActionCount === 1 ? '' : 's'} if needed` : null,
    ].filter(Boolean);

    return `${objective}. Planned execution: ${clauses.join(', ')}.`;
}

export function getBlockingCheckpoint(request: FrozenWorkRequest): CheckpointContract | undefined {
    return request.checkpoints?.find((checkpoint) => checkpoint.blocking) ?? request.checkpoints?.[0];
}

export function getBlockingUserAction(
    request: FrozenWorkRequest,
    preferredKind?: UserActionRequest['kind']
): UserActionRequest | undefined {
    if (!request.userActionsRequired || request.userActionsRequired.length === 0) {
        return undefined;
    }

    if (preferredKind) {
        const preferred = request.userActionsRequired.find((action) =>
            action.kind === preferredKind && action.blocking
        );
        if (preferred) {
            return preferred;
        }
    }

    return request.userActionsRequired.find((action) => action.blocking) ?? request.userActionsRequired[0];
}

export function markWorkRequestExecutionStarted(prepared: PreparedWorkRequestContext): void {
    updateExecutionPlanByKind(prepared, 'clarification', 'completed');
    updateExecutionPlanByKind(prepared, 'goal_framing', 'completed');
    updateExecutionPlanByKind(prepared, 'research', 'completed');
    updateExecutionPlanByKind(prepared, 'uncertainty_resolution', 'completed');
    updateExecutionPlanByKind(prepared, 'contract_freeze', 'completed');
    updateExecutionPlanByKind(prepared, 'execution', 'running');
    updateExecutionPlanByKind(prepared, 'reduction', 'pending');
    updateExecutionPlanByKind(prepared, 'presentation', 'pending');
    markPlanningSteps(
        prepared,
        'execution',
        'in_progress',
        `Execution started for work request ${prepared.frozenWorkRequest.id}.`
    );
}

export function markWorkRequestExecutionCompleted(
    prepared: PreparedWorkRequestContext,
    summary: string
): void {
    updateExecutionPlanByKind(prepared, 'execution', 'completed');
    updateExecutionPlanByKind(prepared, 'reduction', 'completed');
    updateExecutionPlanByKind(prepared, 'presentation', 'completed');
    markPlanningSteps(prepared, 'execution', 'completed');
    markPlanningSteps(prepared, 'reduction', 'completed');
    markPlanningSteps(
        prepared,
        'presentation',
        'completed',
        `Presented result for work request ${prepared.frozenWorkRequest.id}: ${summary.slice(0, 200)}`
    );
}

export function markWorkRequestExecutionFailed(
    prepared: PreparedWorkRequestContext,
    error: string
): void {
    updateExecutionPlanByKind(prepared, 'execution', 'failed');
    updateExecutionPlanByKind(prepared, 'reduction', 'failed', { preserveCompleted: true });
    updateExecutionPlanByKind(prepared, 'presentation', 'failed', { preserveCompleted: true });
    markPlanningSteps(
        prepared,
        'execution',
        'failed',
        `Execution failed for work request ${prepared.frozenWorkRequest.id}: ${error}`
    );
}

export function reopenPreparedWorkRequestForResearch(input: {
    prepared: PreparedWorkRequestContext;
    reason: string;
    trigger: ReplanTrigger;
}): ContractReopenedPayload {
    const { prepared, reason, trigger } = input;
    const summary = `Execution evidence requires contract reopen: ${reason}`;
    const knownRisks = prepared.frozenWorkRequest.knownRisks ?? [];
    if (!knownRisks.includes(reason)) {
        prepared.frozenWorkRequest.knownRisks = [...knownRisks, reason];
    }

    updateExecutionPlanByKind(prepared, 'research', 'running');
    updateExecutionPlanByKind(prepared, 'uncertainty_resolution', 'pending');
    updateExecutionPlanByKind(prepared, 'contract_freeze', 'pending');
    updateExecutionPlanByKind(prepared, 'execution', 'blocked');
    updateExecutionPlanByKind(prepared, 'reduction', 'pending', { preserveCompleted: true });
    updateExecutionPlanByKind(prepared, 'presentation', 'pending', { preserveCompleted: true });

    markPlanningSteps(
        prepared,
        'research',
        'in_progress',
        `Contract reopened for work request ${prepared.frozenWorkRequest.id}: ${reason}`
    );
    markPlanningSteps(prepared, 'uncertainty_resolution', 'pending');
    markPlanningSteps(prepared, 'contract_freeze', 'pending');
    markPlanningSteps(
        prepared,
        'execution',
        'blocked',
        `Execution blocked while contract is reopened for work request ${prepared.frozenWorkRequest.id}: ${reason}`
    );

    const nextStepId = prepared.executionPlan.steps.find((step) => step.kind === 'research')?.stepId
        ?? prepared.executionPlan.steps.find((step) => step.kind === 'uncertainty_resolution')?.stepId
        ?? prepared.executionPlan.steps.find((step) => step.kind === 'contract_freeze')?.stepId;

    return {
        summary,
        reason,
        trigger,
        reasons: [reason],
        nextStepId,
    };
}

export function markWorkRequestExecutionSuspended(
    prepared: PreparedWorkRequestContext,
    reason: string
): void {
    updateExecutionPlanByKind(prepared, 'execution', 'blocked');
    markPlanningSteps(
        prepared,
        'execution',
        'blocked',
        `Execution blocked for work request ${prepared.frozenWorkRequest.id}: ${reason}`
    );
}

export function markWorkRequestExecutionResumed(
    prepared: PreparedWorkRequestContext,
    reason?: string
): void {
    updateExecutionPlanByKind(prepared, 'execution', 'running');
    markPlanningSteps(
        prepared,
        'execution',
        'in_progress',
        reason
            ? `Execution resumed for work request ${prepared.frozenWorkRequest.id}: ${reason}`
            : `Execution resumed for work request ${prepared.frozenWorkRequest.id}.`
    );
}

export function markWorkRequestReductionStarted(prepared: PreparedWorkRequestContext): void {
    updateExecutionPlanByKind(prepared, 'execution', 'completed');
    updateExecutionPlanByKind(prepared, 'reduction', 'running');
    markPlanningSteps(prepared, 'execution', 'completed');
    markPlanningSteps(
        prepared,
        'reduction',
        'in_progress',
        `Reducing execution output for work request ${prepared.frozenWorkRequest.id}.`
    );
}

export function markWorkRequestPresentationStarted(prepared: PreparedWorkRequestContext): void {
    updateExecutionPlanByKind(prepared, 'reduction', 'completed');
    updateExecutionPlanByKind(prepared, 'presentation', 'running');
    markPlanningSteps(prepared, 'reduction', 'completed');
    markPlanningSteps(
        prepared,
        'presentation',
        'in_progress',
        `Preparing final delivery for work request ${prepared.frozenWorkRequest.id}.`
    );
}

export function buildPlanUpdatedPayload(prepared: PreparedWorkRequestContext): PlanUpdatedPayload {
    const steps = prepared.executionPlan.steps.map((step) => ({
        id: step.stepId,
        description: step.description,
        status: toPlanUpdatedStatus(step.status),
    }));
    const taskProgress = prepared.executionPlan.steps
        .filter((step) => step.kind === 'execution' && typeof step.taskId === 'string')
        .map((step) => {
            const task = prepared.frozenWorkRequest.tasks.find((candidate) => candidate.id === step.taskId);
            return {
                taskId: step.taskId as string,
                title: task?.title || step.title,
                status: toPlanUpdatedStatus(step.status),
                dependencies: task?.dependencies ?? [],
            };
        });
    const currentStep = prepared.executionPlan.steps.find((step) => step.status === 'running')
        ?? prepared.executionPlan.steps.find((step) => step.status === 'blocked')
        ?? prepared.executionPlan.steps.find((step) => step.status === 'pending');

    let summary = 'Plan ready.';
    if (currentStep?.status === 'running') {
        summary = `In progress: ${currentStep.title}`;
    } else if (currentStep?.status === 'blocked') {
        summary = `Blocked: ${currentStep.title}`;
    } else if (currentStep?.status === 'pending') {
        summary = `Queued: ${currentStep.title}`;
    } else if (prepared.executionPlan.steps.every((step) => step.status === 'completed')) {
        summary = 'Plan completed.';
    }

    return {
        summary,
        steps,
        taskProgress,
        currentStepId: currentStep?.stepId,
    };
}

export function getScheduledTaskExecutionQuery(input: {
    record: ScheduledTaskRecord;
    workRequestStore: WorkRequestStore;
}): string {
    if (input.record.frozenWorkRequest?.mode === 'scheduled_multi_task' && input.record.taskQuery.trim().length > 0) {
        return stripScheduledContractNoise(input.record.taskQuery);
    }

    if (input.record.frozenWorkRequest) {
        return stripScheduledContractNoise(
            buildExecutionQueryForTaskIds(
                input.record.frozenWorkRequest,
                undefined,
                { includeGlobalContracts: false },
            )
        );
    }

    if (input.record.workRequestId) {
        const stored = input.workRequestStore.getById(input.record.workRequestId);
        if (stored) {
            return stripScheduledContractNoise(
                buildExecutionQueryForTaskIds(
                    stored,
                    undefined,
                    { includeGlobalContracts: false },
                )
            );
        }
    }

    return stripScheduledContractNoise(input.record.taskQuery);
}

type SchedulableRequest = Pick<FrozenWorkRequest, 'tasks' | 'schedule' | 'deliverables' | 'checkpoints'>;

function inferScheduledExecutionMode(input: {
    tasks: NonNullable<SchedulableRequest['tasks']>;
    scheduleStages: NonNullable<NonNullable<SchedulableRequest['schedule']>['stages']>;
}): ScheduledExecutionMode {
    const { tasks, scheduleStages } = input;
    if (scheduleStages.length <= 1) {
        return 'parallel';
    }

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const hasSequentialDependencies = scheduleStages
        .slice(1)
        .every((stage, index) => {
            const previousStage = scheduleStages[index];
            if (!previousStage?.taskId) {
                return false;
            }
            const task = taskById.get(stage.taskId) ?? tasks[index + 1];
            return Boolean(task?.dependencies?.includes(previousStage.taskId));
        });

    const hasRelativeDelays = scheduleStages
        .slice(1)
        .every((stage) => typeof stage.delayMsFromPrevious === 'number' && stage.delayMsFromPrevious >= 0);

    return hasSequentialDependencies || hasRelativeDelays ? 'sequential' : 'parallel';
}

function buildAllScheduledExecutionStages(input: {
    request: Pick<FrozenWorkRequest, 'tasks' | 'schedule' | 'deliverables' | 'checkpoints'>;
    fallbackTitle: string;
    fallbackQuery: string;
}): ScheduledExecutionStagePlan[] {
    const schedule = input.request.schedule;
    if (!schedule?.executeAt) {
        return [];
    }

    const tasks = input.request.tasks ?? [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const plannedStages: ScheduledExecutionStagePlan[] = [];
    const scheduleStages = schedule.stages ?? [];
    const executionMode = inferScheduledExecutionMode({
        tasks,
        scheduleStages,
    });

    if (scheduleStages.length > 0) {
        let rollingExecuteAtMs = new Date(schedule.executeAt).getTime();
        scheduleStages.forEach((stage, index) => {
            const task = taskById.get(stage.taskId) ?? tasks[index];
            const taskQuery = task?.objective?.trim() || input.fallbackQuery.trim();
            const fallbackTaskTitle = input.fallbackTitle.trim() || 'Scheduled Task';
            const explicitExecuteAtMs = new Date(stage.executeAt).getTime();
            if (Number.isFinite(explicitExecuteAtMs)) {
                rollingExecuteAtMs = explicitExecuteAtMs;
            } else if (index > 0 && typeof stage.delayMsFromPrevious === 'number' && stage.delayMsFromPrevious >= 0) {
                rollingExecuteAtMs += stage.delayMsFromPrevious;
            }
            plannedStages.push({
                taskId: task?.id,
                title: task?.title?.trim() || fallbackTaskTitle,
                taskQuery: taskQuery || input.fallbackQuery.trim(),
                executeAt: new Date(rollingExecuteAtMs).toISOString(),
                stageIndex: index,
                totalStages: scheduleStages.length,
                delayMsFromPrevious: stage.delayMsFromPrevious,
                executionMode,
            });
        });
    }

    if (plannedStages.length > 0) {
        return plannedStages;
    }

    const fallbackTaskTitle = input.fallbackTitle.trim() || tasks[0]?.title?.trim() || 'Scheduled Task';
    const fallbackQuery = input.fallbackQuery.trim()
        || buildExecutionQueryForTaskIds(input.request, undefined, { includeGlobalContracts: false }).trim()
        || tasks[0]?.objective?.trim()
        || fallbackTaskTitle;

    return [{
        taskId: tasks[0]?.id,
        title: fallbackTaskTitle,
        taskQuery: fallbackQuery,
        executeAt: schedule.executeAt,
        stageIndex: 0,
        totalStages: 1,
        executionMode: 'parallel',
    }];
}

export function planScheduledExecutionStages(input: {
    request: Pick<FrozenWorkRequest, 'tasks' | 'schedule' | 'deliverables' | 'checkpoints'>;
    fallbackTitle: string;
    fallbackQuery: string;
}): ScheduledExecutionStagePlan[] {
    const allStages = buildAllScheduledExecutionStages(input);
    if (allStages.length <= 1) {
        return allStages;
    }
    const executionMode = allStages[0]?.executionMode ?? 'parallel';
    return executionMode === 'sequential' ? [allStages[0]!] : allStages;
}

export function planNextScheduledExecutionStage(input: {
    request: Pick<FrozenWorkRequest, 'tasks' | 'schedule' | 'deliverables' | 'checkpoints'>;
    fallbackTitle: string;
    fallbackQuery: string;
    completedAt: Date;
    completedStageIndex?: number;
    completedStageTaskId?: string;
}): ScheduledExecutionStagePlan | null {
    const allStages = buildAllScheduledExecutionStages({
        request: input.request,
        fallbackTitle: input.fallbackTitle,
        fallbackQuery: input.fallbackQuery,
    });
    if (allStages.length <= 1 || allStages[0]?.executionMode !== 'sequential') {
        return null;
    }

    let completedStageIndex = Number.isInteger(input.completedStageIndex)
        ? Math.max(0, input.completedStageIndex as number)
        : -1;
    if (completedStageIndex < 0 && input.completedStageTaskId) {
        completedStageIndex = allStages.findIndex((stage) => stage.taskId === input.completedStageTaskId);
    }
    if (completedStageIndex < 0) {
        return null;
    }

    const nextStage = allStages[completedStageIndex + 1];
    if (!nextStage) {
        return null;
    }

    const delayMs = typeof nextStage.delayMsFromPrevious === 'number'
        ? Math.max(0, nextStage.delayMsFromPrevious)
        : 0;
    const executeAt = new Date(input.completedAt.getTime() + delayMs).toISOString();
    return {
        ...nextStage,
        executeAt,
    };
}

const SCHEDULED_CONTRACT_NOISE_LINE_PATTERNS: RegExp[] = [
    /^\s*交付物[:：]/i,
    /^\s*检查点[:：]/i,
    /^\s*deliverables?[:：]/i,
    /^\s*checkpoints?[:：]/i,
];

function stripScheduledContractNoise(query: string): string {
    const lines = query
        .split(/\r?\n/)
        .map((line) => line.trimEnd());

    const filteredLines = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
            return true;
        }
        return !SCHEDULED_CONTRACT_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(trimmed));
    });

    return filteredLines
        .join('\n')
        .replace(/(^|\n)\s*约束[:：]\s*约束[:：]/gi, '$1约束：')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function getPlanStepNumbersByKind(
    plan: PreparedWorkRequestContext['executionPlan'],
    kind: PreparedWorkRequestContext['executionPlan']['steps'][number]['kind']
): number[] {
    return plan.steps
        .map((step, index) => step.kind === kind ? index + 1 : -1)
        .filter((stepNumber) => stepNumber > 0);
}

function markPlanningSteps(
    prepared: PreparedWorkRequestContext,
    kind: PreparedWorkRequestContext['executionPlan']['steps'][number]['kind'],
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'skipped',
    note?: string
): void {
    if (!shouldUsePlanningFiles(prepared.frozenWorkRequest)) {
        return;
    }

    for (const stepNumber of getPlanStepNumbersByKind(prepared.executionPlan, kind)) {
        updatePlanningStepStatus({
            workspacePath: prepared.frozenWorkRequest.workspacePath,
            stepNumber,
            status,
            note,
        });
    }
}

function toPlanUpdatedStatus(
    status: PreparedWorkRequestContext['executionPlan']['steps'][number]['status']
): PlanUpdatedPayload['steps'][number]['status'] {
    if (status === 'running') {
        return 'in_progress';
    }
    if (status === 'completed') {
        return 'completed';
    }
    return status;
}

function updateExecutionPlanByKind(
    prepared: PreparedWorkRequestContext,
    kind: PreparedWorkRequestContext['executionPlan']['steps'][number]['kind'],
    status: PreparedWorkRequestContext['executionPlan']['steps'][number]['status'],
    options?: { preserveCompleted?: boolean }
): void {
    for (const step of prepared.executionPlan.steps) {
        if (step.kind !== kind) {
            continue;
        }
        if (options?.preserveCompleted && step.status === 'completed') {
            continue;
        }
        step.status = status;
    }
}

function getPreferredSkillIdsFromWorkRequest(
    request: FrozenWorkRequest,
    taskIds?: string[],
): string[] {
    const selectedTaskIdSet = Array.isArray(taskIds) && taskIds.length > 0
        ? new Set(taskIds)
        : null;
    const ids = new Set<string>();
    for (const task of request.tasks) {
        if (selectedTaskIdSet && !selectedTaskIdSet.has(task.id)) {
            continue;
        }
        for (const skillId of task.preferredSkills) {
            ids.add(skillId);
        }
    }
    return Array.from(ids);
}

function buildWorkRequestExecutionPrompt(request: FrozenWorkRequest): string | undefined {
    const executionQuery = buildExecutionQuery(request).trim();
    const normalizedSource = request.sourceText.trim();
    const hasStructuredConstraints = request.tasks.some((task) =>
        task.constraints.length > 0 || task.acceptanceCriteria.length > 0
    );
    const goalFrameSection = request.goalFrame
        ? [
            `- Objective: ${request.goalFrame.objective}`,
            request.goalFrame.constraints.length > 0 ? `- Constraints: ${request.goalFrame.constraints.join(' | ')}` : null,
            request.goalFrame.preferences.length > 0 ? `- Preferences: ${request.goalFrame.preferences.join(' | ')}` : null,
            request.goalFrame.contextSignals.length > 0 ? `- Context signals: ${request.goalFrame.contextSignals.join(' | ')}` : null,
            request.goalFrame.successHypothesis.length > 0 ? `- Success hypothesis: ${request.goalFrame.successHypothesis.join(' | ')}` : null,
            `- Task category: ${request.goalFrame.taskCategory}`,
        ].filter(Boolean).join('\n')
        : '';
    const researchSummarySection = request.frozenResearchSummary
        ? [
            `- Evidence items: ${request.frozenResearchSummary.evidenceCount}`,
            request.frozenResearchSummary.sourcesChecked.length > 0
                ? `- Sources checked: ${request.frozenResearchSummary.sourcesChecked.join(', ')}`
                : null,
            `- Blocking unknowns: ${request.frozenResearchSummary.blockingUnknownCount}`,
            request.frozenResearchSummary.selectedStrategyTitle
                ? `- Selected strategy: ${request.frozenResearchSummary.selectedStrategyTitle}`
                : null,
        ].filter(Boolean).join('\n')
        : '';
    const selectedStrategySection = (request.strategyOptions?.length ?? 0) > 0
        ? request.strategyOptions!.map((strategy) => {
            const state = strategy.selected ? 'selected' : 'alternative';
            const rejection = strategy.rejectionReason ? ` Rejection reason: ${strategy.rejectionReason}` : '';
            return `- ${strategy.title} [${state}, feasibility=${strategy.feasibility}]: ${strategy.description}${rejection}`;
        }).join('\n')
        : '';
    const risksSection = (request.knownRisks?.length ?? 0) > 0
        ? request.knownRisks!.map((risk) => `- ${risk}`).join('\n')
        : '';
    const replanSection = request.replanPolicy
        ? `- allowReturnToResearch=${String(request.replanPolicy.allowReturnToResearch)}\n- triggers: ${request.replanPolicy.triggers.join(', ')}`
        : '';
    const deliverablesSection = (request.deliverables?.length ?? 0) > 0
        ? request.deliverables!.map((deliverable) => {
            const pathLine = deliverable.path ? ` -> ${deliverable.path}` : '';
            const formatLine = deliverable.format ? ` [${deliverable.format}]` : '';
            return `- ${deliverable.title}: ${deliverable.description}${pathLine}${formatLine}`;
        }).join('\n')
        : '';
    const checkpointsSection = (request.checkpoints?.length ?? 0) > 0
        ? request.checkpoints!.map((checkpoint) =>
            `- ${checkpoint.title}: ${checkpoint.reason} (blocking=${String(checkpoint.blocking)}, requiresUserConfirmation=${String(checkpoint.requiresUserConfirmation)})`
        ).join('\n')
        : '';
    const userActionsSection = (request.userActionsRequired?.length ?? 0) > 0
        ? request.userActionsRequired!.map((action) => {
            const questions = action.questions.length > 0 ? ` Questions: ${action.questions.join(' | ')}` : '';
            const instructions = action.instructions.length > 0 ? ` Instructions: ${action.instructions.join(' | ')}` : '';
            return `- ${action.title}: ${action.description}${questions}${instructions}`;
        }).join('\n')
        : '';
    const assumptionsSection = request.clarification.assumptions.length > 0
        ? request.clarification.assumptions.map((assumption) => `- ${assumption}`).join('\n')
        : '';
    const workflowGuidance = request.tasks
        .map((task) => {
            if (!task.localPlanHint?.preferredWorkflow) {
                return null;
            }

            const workflow = selectLocalWorkflow({
                intent: task.localPlanHint.intent,
                folderId: task.localPlanHint.targetFolder?.kind === 'well_known_folder'
                    ? task.localPlanHint.targetFolder.folderId
                    : undefined,
                fileKinds: task.localPlanHint.fileKinds,
            });
            if (!workflow) {
                return null;
            }

            const folderPath = task.localPlanHint.targetFolder?.resolvedPath;
            const preferredToolsLine =
                task.preferredTools.length > 0
                    ? `Preferred tools: ${task.preferredTools.join(', ')}`
                    : undefined;
            const folderLine = folderPath ? `Resolved target: ${folderPath}` : undefined;
            const traversalLine = `Traversal scope: ${task.localPlanHint.traversalScope}`;
            return [folderLine, traversalLine, preferredToolsLine, formatWorkflowForPrompt(workflow)].filter(Boolean).join('\n');
        })
        .filter((value): value is string => Boolean(value))
        .join('\n\n');

    if (
        !hasStructuredConstraints &&
        executionQuery === normalizedSource &&
        !workflowGuidance &&
        !deliverablesSection &&
        !checkpointsSection &&
        !userActionsSection &&
        !goalFrameSection &&
        !selectedStrategySection &&
        !risksSection
    ) {
        return undefined;
    }

    return `## Frozen Work Request

This user input has already been analyzed and frozen by the control plane.

Execute the task using this structured request instead of re-interpreting the raw user message:

${executionQuery}

## Execution Contract

Coworkany is the primary task owner for this run. Coworkany should decide how to execute, when to checkpoint, and when user collaboration is actually required.

${goalFrameSection ? `### Goal Frame\n${goalFrameSection}\n` : ''}${researchSummarySection ? `### Research Summary\n${researchSummarySection}\n` : ''}${deliverablesSection ? `### Planned Deliverables\n${deliverablesSection}\n` : ''}${checkpointsSection ? `### Planned Checkpoints\n${checkpointsSection}\n` : ''}${userActionsSection ? `### User Actions Required\n${userActionsSection}\n` : ''}${assumptionsSection ? `### Assumptions And Defaults\n${assumptionsSection}\n` : ''}${selectedStrategySection ? `### Strategy Options\n${selectedStrategySection}\n` : ''}${risksSection ? `### Known Risks\n${risksSection}\n` : ''}${replanSection ? `### Re-Planning Rules\n${replanSection}\n` : ''}

${workflowGuidance ? `\n## Deterministic Local Workflow Guidance\n\n${workflowGuidance}\n` : ''}

Rules:
- Treat the frozen work request as the source of truth for execution.
- Coworkany leads the task; ask the user for help only when a blocking question or manual action is truly required.
- Preserve the planned deliverables and checkpoints unless new evidence forces a change.
- Keep the user-visible reply aligned with the acceptance criteria above.
- Do not add unnecessary meta commentary.`;
}
