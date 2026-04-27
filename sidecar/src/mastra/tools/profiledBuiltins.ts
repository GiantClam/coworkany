import type { Tool } from '@mastra/core/tools';
import { areBuiltinToolpacksEnabled } from '../../config/runtimeProfile';
import { resolveCoworkAnyMastraTools } from './coworkanyToolRegistry';

type AnyMastraTool = Tool<any, any, any, any>;

const BUILTIN_AGENT_TOOL_IDS = [
    'search_web',
    'crawl_url',
    'extract_content',
    'remember',
    'recall',
    'voice_speak',
] as const;

export type ProfiledBuiltinAgentToolId = typeof BUILTIN_AGENT_TOOL_IDS[number];
export type ProfiledBuiltinAgentToolMap = Partial<Record<ProfiledBuiltinAgentToolId, AnyMastraTool>>;

export function resolveProfiledBuiltinAgentTools(options?: {
    env?: NodeJS.ProcessEnv;
    include?: readonly ProfiledBuiltinAgentToolId[];
}): ProfiledBuiltinAgentToolMap {
    if (!areBuiltinToolpacksEnabled(options?.env ?? process.env)) {
        return {};
    }

    const include = options?.include ?? BUILTIN_AGENT_TOOL_IDS;
    return resolveCoworkAnyMastraTools({
        env: options?.env,
        include,
    }) as ProfiledBuiltinAgentToolMap;
}
