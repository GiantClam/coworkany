import { Agent } from '@mastra/core/agent';
import { bashTool, bashApprovalTool } from '../tools/bash';
import { guardrailInputProcessors, guardrailOutputProcessors } from '../guardrails/processors';
import { runtimeScorers } from '../scorers/runtime';
import { getWorkspaceForRequestContext } from '../workspace/runtime';
const DEFAULT_MODEL = process.env.COWORKANY_MODEL || 'anthropic/claude-sonnet-4-5';
export const coder = new Agent({
    id: 'coder',
    name: 'Coder',
    description: 'Implements and validates code changes with tests.',
    instructions: [
        'You are the coding specialist of CoworkAny.',
        'Prefer minimal, test-backed code changes.',
        'Use bash for build/test commands and bash_approval for mutating commands that need confirmation.',
    ].join('\n'),
    model: DEFAULT_MODEL,
    tools: {
        bash: bashTool,
        bash_approval: bashApprovalTool,
    },
    workspace: async ({ requestContext }) => {
        return await getWorkspaceForRequestContext(requestContext);
    },
    defaultOptions: {
        requireToolApproval: true,
        autoResumeSuspendedTools: true,
        toolCallConcurrency: 1,
        maxSteps: 20,
        inputProcessors: guardrailInputProcessors,
        outputProcessors: guardrailOutputProcessors,
        scorers: runtimeScorers,
    },
});
