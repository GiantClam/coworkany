import { Agent } from '@mastra/core/agent';
import { memoryConfig } from '../memory/config';
import { guardrailInputProcessors, guardrailOutputProcessors } from '../guardrails/processors';
import { runtimeScorers } from '../scorers/runtime';
import { resolveRuntimeModelConfig } from '../model/runtimeModel';

const DEFAULT_MODEL = resolveRuntimeModelConfig();

export const chatResponder = new Agent({
    id: 'chat-responder',
    name: 'Chat Responder',
    description: 'Fast conversational responder for direct chat intent.',
    instructions: [
        'You are CoworkAny chat assistant.',
        'Answer the user directly and concisely.',
        'For simple chat or out-of-scope asks, keep it to at most 1-2 short sentences.',
        'Do not enumerate capabilities unless the user explicitly asks what you can do.',
        'Do not call tools, do not delegate, and do not run project actions.',
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
