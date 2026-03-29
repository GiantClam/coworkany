import type { IpcResponse } from '../protocol';

export type ResponseProcessorDeps = {
    resolvePendingResponse: (response: IpcResponse) => void;
    handleRuntimeResponse: (response: IpcResponse) => Promise<boolean>;
};

export function createResponseProcessor(deps: ResponseProcessorDeps) {
    return async function handleResponse(response: IpcResponse): Promise<void> {
        deps.resolvePendingResponse(response);
        await deps.handleRuntimeResponse(response);
    };
}
