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
import { type FrozenWorkRequest } from './workRequestSchema';
import { type ScheduledTaskRecord } from '../scheduling/scheduledTasks';
import { formatWorkflowForPrompt, selectLocalWorkflow } from './localWorkflowRegistry';

export type PreparedWorkRequestContext = {
    frozenWorkRequest: FrozenWorkRequest;
    executionPlan: ReturnType<typeof buildExecutionPlan>;
    executionQuery: string;
    preferredSkillIds: string[];
    workRequestExecutionPrompt?: string;
};

export function createFrozenWorkRequestFromText(input: {
    sourceText: string;
    workspacePath: string;
    workRequestStore: WorkRequestStore;
}): FrozenWorkRequest {
    const analyzed = analyzeWorkRequest({
        sourceText: input.sourceText,
        workspacePath: input.workspacePath,
    });
    const frozen = freezeWorkRequest(analyzed);
    input.workRequestStore.create(frozen);
    return frozen;
}

export function prepareWorkRequestContext(input: {
    sourceText: string;
    workspacePath: string;
    workRequestStore: WorkRequestStore;
}): PreparedWorkRequestContext {
    const frozenWorkRequest = createFrozenWorkRequestFromText(input);
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

export function markWorkRequestExecutionStarted(prepared: PreparedWorkRequestContext): void {
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
    markPlanningSteps(
        prepared,
        'execution',
        'failed',
        `Execution failed for work request ${prepared.frozenWorkRequest.id}: ${error}`
    );
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

    if (!hasStructuredConstraints && executionQuery === normalizedSource && !workflowGuidance) {
        return undefined;
    }

    return `## Frozen Work Request

This user input has already been analyzed and frozen by the control plane.

Execute the task using this structured request instead of re-interpreting the raw user message:

${executionQuery}

${workflowGuidance ? `\n## Deterministic Local Workflow Guidance\n\n${workflowGuidance}\n` : ''}

Rules:
- Treat the frozen work request as the source of truth for execution.
- Keep the user-visible reply aligned with the acceptance criteria above.
- Do not add unnecessary meta commentary.`;
}
