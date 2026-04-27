import { Agent } from '@mastra/core/agent';
import { memoryConfig } from '../memory/config';
import { guardrailInputProcessors, guardrailOutputProcessors } from '../guardrails/processors';
import { runtimeScorers } from '../scorers/runtime';
import { getWorkspaceForRequestContext } from '../workspace/runtime';
import { resolveRuntimeModelConfig } from '../model/runtimeModel';
import { resolveCoworkAnyMastraTools } from '../tools/coworkanyToolRegistry';
const DEFAULT_MODEL = resolveRuntimeModelConfig();
export const coder = new Agent({
    id: 'coder',
    name: 'Coder',
    description: 'Implements and validates code changes with tests.',
    instructions: [
        'You are the coding specialist of CoworkAny.',
        'Prefer minimal, test-backed code changes.',
        'Use run_command for build/test commands. Use file tools for workspace edits; command safety is enforced by run_command.',
    ].join('\n'),
    model: DEFAULT_MODEL,
    memory: memoryConfig,
    tools: {
        ...resolveCoworkAnyMastraTools({ include: ['view_file', 'list_dir', 'write_to_file', 'replace_file_content', 'run_command'] }),
    },
    workspace: async ({ requestContext }) => {
        return await getWorkspaceForRequestContext(requestContext);
    },
    defaultOptions: {
        requireToolApproval: false,
        autoResumeSuspendedTools: false,
        toolCallConcurrency: 1,
        maxSteps: 20,
        inputProcessors: guardrailInputProcessors,
        outputProcessors: guardrailOutputProcessors,
        scorers: runtimeScorers,
    },
});
