import { describe, expect, test } from 'bun:test';
import {
    DELEGATION_PLAN_CONTRACT_MARKER,
    buildDelegationExecutionPlan,
    injectDelegationPlanContract,
} from '../src/mastra/delegationPlanner';
import {
    DELEGATION_SYNTHESIS_CONTRACT_MARKER,
    injectDelegationSynthesisContract,
} from '../src/mastra/delegationSynthesizer';

describe('delegation planner and synthesizer', () => {
    test('builds explicit role plan from multi-agent message', () => {
        const plan = buildDelegationExecutionPlan({
            message: 'Run a multi-agent flow with researcher, developer, reviewer, then synthesize final output.',
        });
        expect(plan.shouldDelegate).toBe(true);
        expect(plan.roles.length).toBeGreaterThanOrEqual(3);
        expect(plan.roles.some((role) => role.roleId === 'researcher')).toBe(true);
        expect(plan.roles.some((role) => role.roleId === 'developer')).toBe(true);
        expect(plan.roles.some((role) => role.roleId === 'reviewer')).toBe(true);
    });

    test('falls back to deterministic coding-oriented role set', () => {
        const plan = buildDelegationExecutionPlan({
            message: 'Please orchestrate multi agent implementation and testing for this TypeScript bug fix.',
        });
        expect(plan.shouldDelegate).toBe(true);
        expect(plan.roles.map((role) => role.roleId)).toContain('developer');
        expect(plan.roles.map((role) => role.roleId)).toContain('reviewer');
        expect(plan.roles[plan.roles.length - 1]?.roleId).toBe('synthesizer');
    });

    test('injects plan and synthesis contracts idempotently', () => {
        const plan = buildDelegationExecutionPlan({
            message: 'Use multi-agent delegation with planner, developer and reviewer roles.',
        });
        const withPlan = injectDelegationPlanContract({
            message: 'original user content',
            plan,
        });
        expect(withPlan.includes(DELEGATION_PLAN_CONTRACT_MARKER)).toBe(true);
        const withPlanAgain = injectDelegationPlanContract({
            message: withPlan,
            plan,
        });
        expect(withPlanAgain.split(DELEGATION_PLAN_CONTRACT_MARKER).length - 1).toBe(1);

        const withSynthesis = injectDelegationSynthesisContract({
            message: withPlanAgain,
            plan,
        });
        expect(withSynthesis.includes(DELEGATION_SYNTHESIS_CONTRACT_MARKER)).toBe(true);
        const withSynthesisAgain = injectDelegationSynthesisContract({
            message: withSynthesis,
            plan,
        });
        expect(withSynthesisAgain.split(DELEGATION_SYNTHESIS_CONTRACT_MARKER).length - 1).toBe(1);
    });

    test('does not inject contracts without multi-agent signal', () => {
        const plan = buildDelegationExecutionPlan({
            message: 'Summarize this document in one paragraph.',
        });
        expect(plan.shouldDelegate).toBe(false);
        const withPlan = injectDelegationPlanContract({
            message: 'Summarize this document in one paragraph.',
            plan,
        });
        const withSynthesis = injectDelegationSynthesisContract({
            message: withPlan,
            plan,
        });
        expect(withSynthesis).toBe('Summarize this document in one paragraph.');
    });
});
