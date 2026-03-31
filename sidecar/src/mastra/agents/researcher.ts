import { Agent } from '@mastra/core/agent';
import { bashTool } from '../tools/bash';
const DEFAULT_MODEL = process.env.COWORKANY_MODEL || 'anthropic/claude-sonnet-4-5';
export const researcher = new Agent({
    id: 'researcher',
    name: 'Researcher',
    description: 'Collects and synthesizes information with reliable evidence.',
    instructions: [
        'You are the research specialist of CoworkAny.',
        'Prioritize verifiable sources and concise summaries.',
        'Use shell tools to gather context only when needed.',
    ].join('\n'),
    model: DEFAULT_MODEL,
    tools: {
        bash: bashTool,
    },
    defaultOptions: {
        requireToolApproval: true,
        autoResumeSuspendedTools: true,
        toolCallConcurrency: 1,
        maxSteps: 14,
    },
});
