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

export type PlanUpdatedPayload = {
    summary: string;
    steps: Array<{
        id: string;
        description: string;
        status: 'pending' | 'in_progress' | 'complete' | 'completed' | 'skipped' | 'failed' | 'blocked';
    }>;
    currentStepId?: string;
};

export type ContractReopenedPayload = {
    summary: string;
    reason: string;
    trigger: ReplanTrigger;
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
        currentStepId: currentStep?.stepId,
    };
}

export function getScheduledTaskExecutionQuery(input: {
    record: ScheduledTaskRecord;
    workRequestStore: WorkRequestStore;
}): string {
    if (input.record.frozenWorkRequest) {
        return buildExecutionQuery(input.record.frozenWorkRequest);
    }

    if (input.record.workRequestId) {
        const stored = input.workRequestStore.getById(input.record.workRequestId);
        if (stored) {
            return buildExecutionQuery(stored);
        }
    }

    return input.record.taskQuery;
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

function getPreferredSkillIdsFromWorkRequest(request: FrozenWorkRequest): string[] {
    const ids = new Set<string>();
    for (const task of request.tasks) {
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
