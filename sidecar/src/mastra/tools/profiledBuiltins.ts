import type { Tool } from '@mastra/core/tools';
import { areBuiltinToolpacksEnabled } from '../../config/runtimeProfile';
import { rememberTool, recallTool } from './memory';
import { crawlUrlTool, extractContentTool, searchWebTool } from './research';
import { voiceSpeakTool } from './voice';

type AnyMastraTool = Tool<any, any, any, any>;

const BUILTIN_AGENT_TOOLS = {
    search_web: searchWebTool as AnyMastraTool,
    crawl_url: crawlUrlTool as AnyMastraTool,
    extract_content: extractContentTool as AnyMastraTool,
    remember: rememberTool as AnyMastraTool,
    recall: recallTool as AnyMastraTool,
    voice_speak: voiceSpeakTool as AnyMastraTool,
} as const;

export type ProfiledBuiltinAgentToolId = keyof typeof BUILTIN_AGENT_TOOLS;
export type ProfiledBuiltinAgentToolMap = Partial<Record<ProfiledBuiltinAgentToolId, AnyMastraTool>>;

export function resolveProfiledBuiltinAgentTools(options?: {
    env?: NodeJS.ProcessEnv;
    include?: readonly ProfiledBuiltinAgentToolId[];
}): ProfiledBuiltinAgentToolMap {
    if (!areBuiltinToolpacksEnabled(options?.env ?? process.env)) {
        return {};
    }

    const include = options?.include ?? Object.keys(BUILTIN_AGENT_TOOLS) as ProfiledBuiltinAgentToolId[];
    const tools: ProfiledBuiltinAgentToolMap = {};
    for (const toolId of include) {
        tools[toolId] = BUILTIN_AGENT_TOOLS[toolId];
    }
    return tools;
}
