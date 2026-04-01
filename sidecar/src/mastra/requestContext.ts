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
};

export function createTaskRequestContext(input: {
    threadId: string;
    resourceId: string;
    taskId?: string;
    workspacePath?: string;
    enabledSkills?: string[];
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

    return requestContext;
}
