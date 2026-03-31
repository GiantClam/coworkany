import type { AnyWorkflow } from '@mastra/core/workflows';
import { mastra } from './index';
import { createTaskRequestContext } from './requestContext';
import { createTelemetryRunContext } from './telemetry';

export type WorkflowTimeTravelReplayInput = {
    workflowId: string;
    runId: string;
    steps: string[];
    taskId?: string;
    resourceId?: string;
    threadId?: string;
    workspacePath?: string;
    inputData?: unknown;
    resumeData?: unknown;
    perStep?: boolean;
};

export type WorkflowTimeTravelReplayResult = {
    success: boolean;
    workflowId: string;
    runId: string;
    status: string;
    steps: string[];
    traceId: string;
    sampled: boolean;
    result?: unknown;
    error?: unknown;
};

function resolveWorkflow(workflowId: string): AnyWorkflow {
    const byName = mastra.listWorkflows() as Record<string, AnyWorkflow>;
    if (workflowId in byName) {
        return byName[workflowId];
    }
    const byInternalId = Object.values(byName).find((workflow) => workflow.id === workflowId);
    if (byInternalId) {
        return byInternalId;
    }
    throw new Error(`workflow_not_found:${workflowId}`);
}

export async function replayWorkflowRunTimeTravel(
    input: WorkflowTimeTravelReplayInput,
): Promise<WorkflowTimeTravelReplayResult> {
    const workflow = resolveWorkflow(input.workflowId);
    const taskId = input.taskId ?? `workflow-replay-${input.runId}`;
    const threadId = input.threadId ?? `workflow-replay-${input.runId}`;
    const resourceId = input.resourceId ?? `workflow-replay-${workflow.id}`;
    const telemetry = createTelemetryRunContext({
        taskId,
        threadId,
        resourceId,
        workspacePath: input.workspacePath,
    });
    const requestContext = createTaskRequestContext({
        taskId,
        threadId,
        resourceId,
        workspacePath: input.workspacePath,
    });

    const run = await workflow.createRun({
        runId: input.runId,
        resourceId,
    });
    const replay = await run.timeTravel({
        step: input.steps,
        inputData: input.inputData,
        resumeData: input.resumeData,
        requestContext,
        tracingOptions: telemetry.tracingOptions,
        outputOptions: {
            includeState: true,
            includeResumeLabels: true,
        },
        perStep: input.perStep ?? true,
    });
    const success = replay.status !== 'failed' && replay.status !== 'tripwire';
    const replayRecord = replay as Record<string, unknown>;
    return {
        success,
        workflowId: workflow.id,
        runId: input.runId,
        status: replay.status,
        steps: input.steps,
        traceId: telemetry.traceId,
        sampled: telemetry.sampled,
        result: replayRecord.result,
        error: replayRecord.error,
    };
}
