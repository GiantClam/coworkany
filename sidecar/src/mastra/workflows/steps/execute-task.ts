import type { Agent } from '@mastra/core/agent';
import type {
    ExecutionPlan,
    FrozenWorkRequest,
} from '../../../orchestration/workRequestSchema';

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
}): Promise<ExecuteTaskOutput> {
    const checkpoint = input.task.executionPlan.steps.find((step) => step.kind === 'execution');

    if (checkpoint && input.approved === false) {
        return {
            result: 'Execution cancelled by approval gate.',
            completed: false,
        };
    }

    const output = await input.coworker.generate(input.task.executionQuery, {
        memory: {
            thread: `control-plane-${input.task.frozen.id}`,
            resource: 'org-coworkany',
        },
        requireToolApproval: true,
        maxSteps: 8,
    });

    return {
        result: output.text,
        completed: output.finishReason !== 'error',
    };
}
