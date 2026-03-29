import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';

const loadCheckpointStep = createStep({
    id: 'load-checkpoint',
    inputSchema: z.object({
        scheduleId: z.string(),
        stage: z.number().int().nonnegative().default(0),
    }),
    outputSchema: z.object({
        scheduleId: z.string(),
        stage: z.number().int().nonnegative(),
        checkpointLoaded: z.boolean(),
    }),
    execute: async ({ inputData }) => {
        return {
            scheduleId: inputData.scheduleId,
            stage: inputData.stage,
            checkpointLoaded: true,
        };
    },
});

const executeStageStep = createStep({
    id: 'execute-stage',
    inputSchema: z.any(),
    outputSchema: z.object({
        scheduleId: z.string(),
        stage: z.number().int().nonnegative(),
        done: z.boolean(),
    }),
    execute: async ({ inputData }) => {
        return {
            scheduleId: inputData.scheduleId,
            stage: inputData.stage,
            done: true,
        };
    },
});

const saveCheckpointStep = createStep({
    id: 'save-checkpoint',
    inputSchema: z.any(),
    outputSchema: z.object({
        scheduleId: z.string(),
        completed: z.boolean(),
        nextStage: z.number().int().nonnegative(),
    }),
    execute: async ({ inputData }) => {
        return {
            scheduleId: inputData.scheduleId,
            completed: inputData.done === true,
            nextStage: inputData.stage + 1,
        };
    },
});

export const scheduledTaskWorkflow = createWorkflow({
    id: 'scheduled-task',
    inputSchema: z.object({
        scheduleId: z.string(),
        stage: z.number().int().nonnegative().default(0),
    }),
    outputSchema: z.object({
        scheduleId: z.string(),
        completed: z.boolean(),
        nextStage: z.number().int().nonnegative(),
    }),
})
    .then(loadCheckpointStep)
    .then(executeStageStep)
    .then(saveCheckpointStep)
    .commit();
