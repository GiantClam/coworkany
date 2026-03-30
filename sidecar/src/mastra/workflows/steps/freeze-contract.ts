import {
    buildExecutionPlan,
    buildExecutionQueryForTaskIds,
    freezeWorkRequest,
} from '../../../orchestration/workRequestAnalyzer';
import type {
    ExecutionPlan,
    FrozenWorkRequest,
    NormalizedWorkRequest,
} from '../../../orchestration/workRequestSchema';
export interface FreezeContractInput {
    normalized: NormalizedWorkRequest;
}
export interface FreezeContractOutput {
    frozen: FrozenWorkRequest;
    executionPlan: ExecutionPlan;
    executionQuery: string;
}
export function freezeContract(input: FreezeContractInput): FreezeContractOutput {
    const frozen = freezeWorkRequest(input.normalized);
    const executionPlan = buildExecutionPlan(frozen);
    const executionQuery = buildExecutionQueryForTaskIds(frozen);
    return {
        frozen,
        executionPlan,
        executionQuery,
    };
}
