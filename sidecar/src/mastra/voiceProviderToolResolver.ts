import { RequestContext } from '@mastra/core/request-context';
import type { ToolExecutionContext } from '@mastra/core/tools';
import type { ToolContext, ToolDefinition } from '../tools/core/types';
import { getCoworkAnyMastraToolRegistration } from './tools/coworkanyToolRegistry';

const NON_PROVIDER_TOOL_IDS = new Set([
    // voice_speak is the public endpoint over the provider layer, not a provider
    // implementation. Allowing it here would recurse through speakText().
    'voice_speak',
]);

function toMastraExecutionContext(context: ToolContext): ToolExecutionContext {
    const requestContext = new RequestContext();
    requestContext.set('workspacePath', context.workspacePath);
    requestContext.set('taskId', context.taskId);
    return {
        requestContext,
    } as ToolExecutionContext;
}

export function resolveVoiceProviderMastraToolDefinition(toolName: string): ToolDefinition | undefined {
    if (NON_PROVIDER_TOOL_IDS.has(toolName)) {
        return undefined;
    }
    const registration = getCoworkAnyMastraToolRegistration(toolName);
    if (!registration?.tool.execute) {
        return undefined;
    }
    return {
        name: registration.id,
        description: registration.metadata.description,
        input_schema: { type: 'object' },
        effects: registration.metadata.effects,
        handler: async (args: unknown, context: ToolContext) => {
            return await registration.tool.execute!(
                args,
                toMastraExecutionContext(context),
            );
        },
    };
}
