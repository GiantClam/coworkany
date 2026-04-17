import type { DelegationExecutionPlan } from './delegationPlanner';

export const DELEGATION_SYNTHESIS_CONTRACT_MARKER = '[CoworkAny Delegation Synthesis]';

export type DelegationSynthesisContract = {
    workflowShape: 'parallel' | 'staged';
    expectedRoles: string[];
    checklist: string[];
};

export function buildDelegationSynthesisContract(plan: DelegationExecutionPlan): DelegationSynthesisContract {
    const expectedRoles = plan.roles.map((role) => role.roleId);
    return {
        workflowShape: plan.workflowShape,
        expectedRoles,
        checklist: [
            'Wait for each delegated role to produce concrete output before final answer.',
            'If outputs conflict, explicitly call out conflict and resolve with evidence.',
            'Summarize every role output in final synthesis with role identifiers.',
            'Do not claim completion when any required role output is missing.',
        ],
    };
}

export function injectDelegationSynthesisContract(input: {
    message: string;
    plan: DelegationExecutionPlan;
}): string {
    const message = typeof input.message === 'string' ? input.message : '';
    if (!input.plan.shouldDelegate || input.plan.roles.length < 2) {
        return message;
    }
    if (message.includes(DELEGATION_SYNTHESIS_CONTRACT_MARKER)) {
        return message;
    }
    const contract = buildDelegationSynthesisContract(input.plan);
    const header = [
        DELEGATION_SYNTHESIS_CONTRACT_MARKER,
        `workflow_shape=${contract.workflowShape}`,
        `expected_roles=${contract.expectedRoles.join(',')}`,
    ];
    const checklistLines = contract.checklist.map((line) => `- ${line}`);
    return `${[...header, ...checklistLines].join('\n')}\n\n${message}`;
}
