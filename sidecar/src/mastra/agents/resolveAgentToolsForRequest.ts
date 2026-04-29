import type { Tool } from '@mastra/core/tools';
import { resolveRuntimeCapabilityProfile } from '../../config/runtimeProfile';
import { CORE_BASELINE_TOOL_IDS } from '../../data/coreToolpack';
import { listMcpToolsSafe } from '../mcp/clients';
import { deleteFilesTool, sendEmailTool } from '../tools/approval-tools';
import { enterpriseTools } from '../tools/enterprise';
import { resolveCoworkAnyMastraTools } from '../tools/coworkanyToolRegistry';

type AnyMastraTool = Tool<any, any, any, any>;

export type AgentToolSurface =
    | 'chat'
    | 'task-core'
    | 'task-full'
    | 'research'
    | 'voice';

export type ResolveAgentToolsForRequestInput = {
    surface: AgentToolSurface;
    env?: NodeJS.ProcessEnv;
    includeMcp?: boolean;
    includeEnterprise?: boolean;
    listMcpToolsFn?: () => Promise<Record<string, AnyMastraTool>>;
};

function resolveCoreTaskTools(env: NodeJS.ProcessEnv): Record<string, AnyMastraTool> {
    return resolveCoworkAnyMastraTools({
        env,
        include: CORE_BASELINE_TOOL_IDS,
    });
}

function resolveVoiceTools(env: NodeJS.ProcessEnv): Record<string, AnyMastraTool> {
    if (resolveRuntimeCapabilityProfile(env) === 'core') {
        return {};
    }
    return resolveCoworkAnyMastraTools({
        env,
        include: ['voice_speak'],
    });
}

function resolveBaseToolsForSurface(
    surface: AgentToolSurface,
    env: NodeJS.ProcessEnv,
): Record<string, AnyMastraTool> {
    switch (surface) {
        case 'chat':
            return {};
        case 'task-core':
            return resolveCoreTaskTools(env);
        case 'task-full':
            return resolveRuntimeCapabilityProfile(env) === 'core'
                ? resolveCoreTaskTools(env)
                : resolveCoworkAnyMastraTools({ env });
        case 'research':
            return resolveRuntimeCapabilityProfile(env) === 'core'
                ? {}
                : resolveCoworkAnyMastraTools({
                    env,
                    include: ['search_web', 'crawl_url', 'extract_content', 'run_command'],
                });
        case 'voice':
            return resolveVoiceTools(env);
    }
}

export async function resolveAgentToolsForRequest(
    input: ResolveAgentToolsForRequestInput,
): Promise<Record<string, AnyMastraTool>> {
    const env = input.env ?? process.env;
    const profile = resolveRuntimeCapabilityProfile(env);
    const baseTools = resolveBaseToolsForSurface(input.surface, env);
    const extensionTools = profile === 'full' && input.surface === 'task-full' && input.includeMcp === true
        ? await (input.listMcpToolsFn ?? listMcpToolsSafe)()
        : {};
    const enterpriseSideEffectTools = profile === 'full' && input.includeEnterprise === true
        ? {
            delete_files: deleteFilesTool,
            send_email: sendEmailTool,
            ...enterpriseTools,
        }
        : {};

    return {
        ...enterpriseSideEffectTools,
        ...baseTools,
        ...extensionTools,
    };
}
