import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { analyzeWorkRequest } from './steps/analyze-intent';
import { buildExecutionProfile } from './steps/assess-risk';
import { runResearchLoop } from './steps/research-loop';
import { freezeContract } from './steps/freeze-contract';
import { executeFrozenTask } from './steps/execute-task';

const CONTROL_PLANE_RETRY_ATTEMPTS = 2;
const CONTROL_PLANE_RETRY_DELAY_MS = 400;

const analyzeIntentStep = createStep({
    id: 'analyze-intent',
    description: 'Analyze user intent and normalize into work request.',
    inputSchema: z.object({
        userInput: z.string(),
        workspacePath: z.string(),
        followUpContext: z.unknown().optional(),
    }),
    outputSchema: z.object({
        normalized: z.any(),
        mode: z.enum(['chat', 'immediate_task', 'scheduled_task', 'scheduled_multi_task']),
        hardness: z.string(),
        requiredCapabilities: z.array(z.string()),
    }),
    retries: 1,
    execute: async ({ inputData }) => {
        return analyzeWorkRequest(inputData);
    },
});
const assessRiskStep = createStep({
    id: 'assess-risk',
    description: 'Assess risk tier and execution policy.',
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async ({ inputData }) => {
        const assessed = buildExecutionProfile(inputData.normalized);
        return {
            ...inputData,
            ...assessed,
        };
    },
});
const researchStep = createStep({
    id: 'research-if-needed',
    description: 'Suspend for user action when needed, otherwise run pre-freeze research loop.',
    inputSchema: z.any(),
    suspendSchema: z.object({
        questions: z.array(z.string()),
        reason: z.string(),
        blocking: z.boolean(),
    }),
    resumeSchema: z.object({
        approved: z.boolean().optional(),
        answers: z.record(z.string(), z.string()).optional(),
    }),
    outputSchema: z.any(),
    retries: 1,
    execute: async ({ inputData, resumeData, suspend }) => {
        const userActions = inputData.userActions as Array<{ questions: string[]; blocking: boolean }> | undefined;
        const hasBlockingAction = Boolean(userActions && userActions.some((action) => action.blocking));
        if (hasBlockingAction && !resumeData?.approved) {
            const questions = (userActions ?? [])
                .flatMap((action) => action.questions)
                .filter((question): question is string => typeof question === 'string' && question.length > 0);
            return await suspend({
                questions,
                reason: 'Waiting for required user input before research/execution.',
                blocking: true,
            });
        }
        const research = await runResearchLoop(
            { normalized: inputData.normalized },
            { answers: resumeData?.answers },
        );
        return {
            ...inputData,
            normalized: research.normalized,
            evidence: research.evidence,
            userResponses: research.userResponses,
        };
    },
});
const freezeContractStep = createStep({
    id: 'freeze-contract',
    description: 'Freeze normalized request and generate execution plan/query.',
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async ({ inputData }) => {
        const frozen = freezeContract({ normalized: inputData.normalized });
        return {
            ...inputData,
            ...frozen,
        };
    },
});
const executeTaskStep = createStep({
    id: 'execute-task',
    description: 'Execute task via coworker agent, with suspend/resume approval gate.',
    inputSchema: z.any(),
    suspendSchema: z.object({
        checkpointTitle: z.string(),
        progress: z.number(),
        message: z.string(),
    }),
    resumeSchema: z.object({
        approved: z.boolean(),
        feedback: z.string().optional(),
    }),
    outputSchema: z.object({
        result: z.string(),
        completed: z.boolean(),
    }),
    execute: async ({ inputData, resumeData, suspend, mastra, bail }) => {
        if (typeof inputData.executionQuery !== 'string' || inputData.executionQuery.trim().length === 0) {
            return bail({
                result: 'Execution query is empty after contract freeze; workflow stopped safely.',
                completed: false,
            });
        }
        const requiresCheckpointApproval = (inputData.checkpoints as Array<{ requiresUserConfirmation?: boolean }> | undefined)
            ?.some((checkpoint) => checkpoint.requiresUserConfirmation === true);
        if (requiresCheckpointApproval && resumeData?.approved !== true) {
            return await suspend({
                checkpointTitle: 'Execution checkpoint approval',
                progress: 0.5,
                message: 'Execution is waiting for checkpoint approval.',
            });
        }
        const coworker = mastra.getAgent('coworker');
        const executed = await executeFrozenTask({
            coworker,
            task: {
                frozen: inputData.frozen,
                executionPlan: inputData.executionPlan,
                executionQuery: inputData.executionQuery,
            },
            approved: resumeData?.approved,
            workspacePath: typeof inputData.workspacePath === 'string' ? inputData.workspacePath : undefined,
        });
        return executed;
    },
});
export const controlPlaneWorkflow = createWorkflow({
    id: 'control-plane',
    inputSchema: z.object({
        userInput: z.string(),
        workspacePath: z.string(),
        followUpContext: z.unknown().optional(),
    }),
    outputSchema: z.object({
        result: z.string(),
        completed: z.boolean(),
    }),
    retryConfig: {
        attempts: CONTROL_PLANE_RETRY_ATTEMPTS,
        delay: CONTROL_PLANE_RETRY_DELAY_MS,
    },
    options: {
        onFinish: ({ workflowId, runId, result }) => {
            console.info('[Mastra control-plane] finish', {
                workflowId,
                runId,
                status: result.status,
            });
        },
        onError: ({ workflowId, runId, error }) => {
            console.error('[Mastra control-plane] error', {
                workflowId,
                runId,
                error: error instanceof Error ? error.message : String(error),
            });
        },
    },
})
    .then(analyzeIntentStep)
    .then(assessRiskStep)
    .then(researchStep)
    .then(freezeContractStep)
    .then(executeTaskStep)
    .commit();
