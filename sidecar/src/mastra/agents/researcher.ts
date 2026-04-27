import { Agent } from '@mastra/core/agent';
import { memoryConfig } from '../memory/config';
import { guardrailInputProcessors, guardrailOutputProcessors } from '../guardrails/processors';
import { runtimeScorers } from '../scorers/runtime';
import { getWorkspaceForRequestContext } from '../workspace/runtime';
import { resolveRuntimeModelConfig } from '../model/runtimeModel';
import { resolveResearchTools } from './resolveResearchTools';
import { resolveCoworkAnyMastraTools } from '../tools/coworkanyToolRegistry';
const DEFAULT_MODEL = resolveRuntimeModelConfig();
export const researcher = new Agent({
    id: 'researcher',
    name: 'Researcher',
    description: 'Collects and synthesizes information with reliable evidence.',
    instructions: [
        'You are the research specialist of CoworkAny.',
        'Do not expose internal reasoning, instruction traces, or policy analysis in user-facing output.',
        'Prioritize verifiable sources and concise summaries.',
        'For time-sensitive questions, retrieve latest evidence before conclusions.',
        'For acronym-heavy topics, expand the first mention (for example: Artificial Intelligence (AI), Large Language Model (LLM)) to avoid ambiguous shorthand-only summaries.',
        'For research conclusions, cite at least one concrete dated source signal per major section (headline/source/time marker), not only generic trend statements.',
        'When factual freshness matters, never answer from model memory alone: complete at least one successful research tool call before final response.',
        'For market/investment requests (股票/港股/美股/买入价位), produce a decision-ready output: ticker/exchange disambiguation, date/time-anchored price context, trend scenarios, and a concrete rating plus entry range.',
        'Do not default to "cannot provide investment advice" style refusals for market requests; provide best-effort recommendations with explicit assumptions and risks.',
        'For business decision requests (商业合作/业务合作/partnership/vendor strategy), produce a decision-ready output: options comparison, recommendation, assumptions, execution trade-offs, and key risks.',
        'Do not replace business/cooperation analysis with generic refusal text; provide best-effort recommendations with uncertainty bounds.',
        'Prefer dedicated retrieval/data tools first, and avoid inferring facts from weak or ambiguous snippets.',
        'When evidence is conflicting or incomplete, report uncertainty explicitly and ask for disambiguation.',
        'Only use workspace/shell command tools as a fallback when dedicated tools are unavailable, empty, or low-confidence.',
        'When falling back to shell, keep commands read-only and minimal, and return explicit source links with timestamps.',
        'When the request asks for spoken output (voice/TTS/read-aloud/播报/朗读), call voice_speak with a concise summary instead of only describing what could be spoken.',
        'Tool argument hygiene: do not pass optional parameters as literal strings like "null"/"undefined"; omit them when unavailable.',
        'When writing output files via workspace tools, keep paths inside workspace and avoid absolute paths outside the workspace root.',
    ].join('\n'),
    model: DEFAULT_MODEL,
    memory: memoryConfig,
    tools: async () => {
        const resolved = await resolveResearchTools();
        return {
            ...resolved.tools,
            ...resolveCoworkAnyMastraTools({ include: ['voice_speak'] }),
        };
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
        onIterationComplete: ({ iteration, toolCalls, text, isFinal }) => {
            if (isFinal) {
                return undefined;
            }
            const normalized = text.trim();
            if (iteration >= 8 && toolCalls.length > 0 && normalized.length < 240) {
                return {
                    continue: false,
                    feedback: 'Stop retrieval loop and deliver a complete synthesis now with concrete conclusions, recommendations, and key risks.',
                };
            }
            if (iteration >= 12 && toolCalls.length > 0) {
                return {
                    continue: false,
                    feedback: 'Tool budget reached. Provide final response now using current evidence.',
                };
            }
            return undefined;
        },
    },
});
