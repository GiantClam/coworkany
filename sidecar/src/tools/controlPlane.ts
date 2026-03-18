import { ToolDefinition } from './standard';
import {
    analyzeWorkRequest,
    buildExecutionPlan,
    freezeWorkRequest,
    reduceWorkResult,
} from '../orchestration/workRequestAnalyzer';
import { type NormalizedWorkRequest, type FrozenWorkRequest } from '../orchestration/workRequestSchema';

export const analyzeWorkRequestTool: ToolDefinition = {
    name: 'analyze_work_request',
    description: 'Analyze raw user input into a structured work request before execution.',
    effects: [],
    input_schema: {
        type: 'object',
        properties: {
            text: {
                type: 'string',
                description: 'Raw user input to analyze.',
            },
        },
        required: ['text'],
    },
    handler: async (args: { text: string }, context) => {
        return analyzeWorkRequest({
            sourceText: args.text,
            workspacePath: context.workspacePath,
        });
    },
};

export const freezeWorkRequestTool: ToolDefinition = {
    name: 'freeze_work_request',
    description: 'Freeze a structured work request so it can be executed later without reinterpreting user input.',
    effects: ['state:remember'],
    input_schema: {
        type: 'object',
        properties: {
            work_request: {
                type: 'object',
                description: 'A normalized work request object.',
            },
        },
        required: ['work_request'],
    },
    handler: async (args: { work_request: NormalizedWorkRequest }) => {
        return freezeWorkRequest(args.work_request);
    },
};

export const planWorkExecutionTool: ToolDefinition = {
    name: 'plan_work_execution',
    description: 'Build an execution plan from a frozen work request.',
    effects: [],
    input_schema: {
        type: 'object',
        properties: {
            work_request: {
                type: 'object',
                description: 'A frozen work request object.',
            },
        },
        required: ['work_request'],
    },
    handler: async (args: { work_request: FrozenWorkRequest }) => {
        return buildExecutionPlan(args.work_request);
    },
};

export const reduceExecutionResultTool: ToolDefinition = {
    name: 'reduce_execution_result',
    description: 'Reduce raw execution output into canonical, UI, and TTS presentation payloads.',
    effects: [],
    input_schema: {
        type: 'object',
        properties: {
            work_request: {
                type: 'object',
                description: 'A frozen work request object.',
            },
            result_text: {
                type: 'string',
                description: 'Raw execution result text.',
            },
            artifacts: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional generated artifact paths.',
            },
        },
        required: ['work_request', 'result_text'],
    },
    handler: async (args: { work_request: FrozenWorkRequest; result_text: string; artifacts?: string[] }) => {
        return reduceWorkResult({
            canonicalResult: args.result_text,
            request: args.work_request,
            artifacts: args.artifacts,
        });
    },
};

export const presentWorkResultTool: ToolDefinition = {
    name: 'present_work_result',
    description: 'Prepare a reduced result payload for UI and TTS presentation.',
    effects: ['ui:notify'],
    input_schema: {
        type: 'object',
        properties: {
            payload: {
                type: 'object',
                description: 'A reduced presentation payload.',
            },
        },
        required: ['payload'],
    },
    handler: async (args: { payload: unknown }) => ({
        success: true,
        presentation: args.payload,
    }),
};

export const CONTROL_PLANE_TOOLS: ToolDefinition[] = [
    analyzeWorkRequestTool,
    freezeWorkRequestTool,
    planWorkExecutionTool,
    reduceExecutionResultTool,
    presentWorkResultTool,
];
