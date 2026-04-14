import { Agent } from '@mastra/core/agent';
import { memoryConfig } from '../memory/config';
import { guardrailInputProcessors, guardrailOutputProcessors } from '../guardrails/processors';
import { runtimeScorers } from '../scorers/runtime';
import { resolveRuntimeModelConfig } from '../model/runtimeModel';

const DEFAULT_MODEL = resolveRuntimeModelConfig();

export const taskSynthesizer = new Agent({
    id: 'task-synthesizer',
    name: 'Task Synthesizer',
    description: 'Produces final user-facing synthesis without additional tool execution.',
    instructions: [
        'You produce the final answer for a task using already available context.',
        'Do not call tools, do not ask to continue searching, and do not emit execution-status narration.',
        'Return a complete final answer directly to the user.',
        'If evidence is incomplete, state uncertainty explicitly and still provide the best actionable synthesis.',
        'Prefer clear structure: summary, key findings, recommendations, and risks/next steps.',
    ].join('\n'),
    model: DEFAULT_MODEL,
    memory: memoryConfig,
    defaultOptions: {
        requireToolApproval: false,
        autoResumeSuspendedTools: false,
        toolCallConcurrency: 1,
        maxSteps: 1,
        inputProcessors: guardrailInputProcessors,
        outputProcessors: guardrailOutputProcessors,
        scorers: runtimeScorers,
    },
});

