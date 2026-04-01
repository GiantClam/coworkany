import type { Agent } from '@mastra/core/agent';
import type {
    ExecutionPlan,
    FrozenWorkRequest,
} from '../../../orchestration/workRequestSchema';
import { deriveDefaultResourceId } from '../../runtimeIdentity';
import { createTaskRequestContext } from '../../requestContext';
import { createTelemetryRunContext } from '../../telemetry';
export interface ExecuteTaskInput {
    frozen: FrozenWorkRequest;
    executionPlan: ExecutionPlan;
    executionQuery: string;
}
export interface ExecuteTaskOutput {
    result: string;
    completed: boolean;
}
export async function executeFrozenTask(input: {
    coworker: Agent;
    task: ExecuteTaskInput;
    approved?: boolean;
    workspacePath?: string;
}): Promise<ExecuteTaskOutput> {
    const checkpoint = input.task.executionPlan.steps.find((step) => step.kind === 'execution');
    if (checkpoint && input.approved === false) {
        return {
            result: 'Execution cancelled by approval gate.',
            completed: false,
        };
    }
    const threadId = `control-plane-${input.task.frozen.id}`;
    const resourceId = deriveDefaultResourceId(input.task.frozen.id);
    const requestContext = createTaskRequestContext({
        threadId,
        resourceId,
        taskId: input.task.frozen.id,
        workspacePath: input.workspacePath,
    });
    const telemetry = createTelemetryRunContext({
        taskId: input.task.frozen.id,
        threadId,
        resourceId,
        workspacePath: input.workspacePath,
    });
    const output = await input.coworker.generate(input.task.executionQuery, {
        memory: {
            thread: threadId,
            resource: resourceId,
        },
        requestContext,
        tracingOptions: telemetry.tracingOptions
            ? {
                ...telemetry.tracingOptions,
                tags: [...telemetry.tracingOptions.tags, 'workflow:control-plane'],
            }
            : undefined,
        requireToolApproval: true,
        autoResumeSuspendedTools: true,
        toolCallConcurrency: 1,
        maxSteps: 8,
    });
    return {
        result: output.text,
        completed: output.finishReason !== 'error',
    };
}
