import {
    MASTRA_RESOURCE_ID_KEY,
    MASTRA_THREAD_ID_KEY,
    RequestContext,
} from '@mastra/core/request-context';

export {
    MASTRA_RESOURCE_ID_KEY,
    MASTRA_THREAD_ID_KEY,
};

export type CoworkanyRequestContextValues = {
    [MASTRA_RESOURCE_ID_KEY]: string;
    [MASTRA_THREAD_ID_KEY]: string;
    taskId: string;
    runtime: 'desktop-sidecar';
    workspacePath?: string;
    enabledSkills?: string[];
    enabledToolpacks?: string[];
    skillPrompt?: string;
    modelId?: string;
    requireToolApproval?: boolean;
};

export function createTaskRequestContext(input: {
    threadId: string;
    resourceId: string;
    taskId?: string;
    workspacePath?: string;
    enabledSkills?: string[];
    enabledToolpacks?: string[];
    skillPrompt?: string;
    modelId?: string;
    requireToolApproval?: boolean;
}): RequestContext<CoworkanyRequestContextValues> {
    const requestContext = new RequestContext<CoworkanyRequestContextValues>();
    requestContext.set(MASTRA_RESOURCE_ID_KEY, input.resourceId);
    requestContext.set(MASTRA_THREAD_ID_KEY, input.threadId);
    requestContext.set('taskId', input.taskId ?? input.threadId);
    requestContext.set('runtime', 'desktop-sidecar');

    if (typeof input.workspacePath === 'string' && input.workspacePath.length > 0) {
        requestContext.set('workspacePath', input.workspacePath);
    }
    if (Array.isArray(input.enabledSkills) && input.enabledSkills.length > 0) {
        requestContext.set('enabledSkills', input.enabledSkills);
    }
    if (Array.isArray(input.enabledToolpacks) && input.enabledToolpacks.length > 0) {
        requestContext.set('enabledToolpacks', input.enabledToolpacks);
    }
    if (typeof input.skillPrompt === 'string' && input.skillPrompt.trim().length > 0) {
        requestContext.set('skillPrompt', input.skillPrompt.trim());
    }
    if (typeof input.modelId === 'string' && input.modelId.trim().length > 0) {
        requestContext.set('modelId', input.modelId.trim());
    }
    if (typeof input.requireToolApproval === 'boolean') {
        requestContext.set('requireToolApproval', input.requireToolApproval);
    }

    return requestContext;
}
