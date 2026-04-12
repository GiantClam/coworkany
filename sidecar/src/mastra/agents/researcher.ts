import { Agent } from '@mastra/core/agent';
import { memoryConfig } from '../memory/config';
import { guardrailInputProcessors, guardrailOutputProcessors } from '../guardrails/processors';
import { runtimeScorers } from '../scorers/runtime';
import { getWorkspaceForRequestContext } from '../workspace/runtime';
import { resolveRuntimeModelConfig } from '../model/runtimeModel';
import { resolveResearchTools } from './resolveResearchTools';
const DEFAULT_MODEL = resolveRuntimeModelConfig();
export const researcher = new Agent({
    id: 'researcher',
    name: 'Researcher',
    description: 'Collects and synthesizes information with reliable evidence.',
    instructions: [
        'You are the research specialist of CoworkAny.',
        'Prioritize verifiable sources and concise summaries.',
        'For time-sensitive questions, retrieve latest evidence before conclusions.',
        'For stock/market/news queries, first use dedicated tools (web search / finance / data APIs).',
        'Only use workspace/shell command tools as a fallback when dedicated tools are unavailable, empty, or low-confidence.',
        'When falling back to shell, keep commands read-only and minimal, and return explicit source links with timestamps.',
    ].join('\n'),
    model: DEFAULT_MODEL,
    memory: memoryConfig,
    tools: async () => {
        const resolved = await resolveResearchTools();
        return resolved.tools;
    },
    workspace: async ({ requestContext }) => {
        return await getWorkspaceForRequestContext(requestContext);
    },
    defaultOptions: {
        requireToolApproval: false,
        autoResumeSuspendedTools: false,
        toolCallConcurrency: 1,
        maxSteps: 14,
        inputProcessors: guardrailInputProcessors,
        outputProcessors: guardrailOutputProcessors,
        scorers: runtimeScorers,
    },
});
