export type TaskRuntimeStatusLike =
    | 'running'
    | 'finished'
    | 'failed'
    | 'recoverable_interrupted'
    | undefined;

const RECOVERABLE_MODEL_STREAM_ERROR_PATTERN =
    /socket connection was closed unexpectedly|fetch failed|network|timeout|ECONNRESET|ETIMEDOUT/i;

export function isTerminalTaskStatus(status: TaskRuntimeStatusLike): boolean {
    return status === 'finished' || status === 'failed' || status === 'recoverable_interrupted';
}

export function shouldEmitTaskFailure(status: TaskRuntimeStatusLike): boolean {
    return !isTerminalTaskStatus(status);
}

export function isRecoverableModelStreamError(errorMessage: string): boolean {
    return RECOVERABLE_MODEL_STREAM_ERROR_PATTERN.test(errorMessage);
}

export function buildModelStreamFailurePayload(errorMessage: string): {
    error: string;
    errorCode: 'MODEL_STREAM_ERROR';
    recoverable: boolean;
    suggestion?: string;
} {
    const recoverable = isRecoverableModelStreamError(errorMessage);
    return {
        error: errorMessage,
        errorCode: 'MODEL_STREAM_ERROR',
        recoverable,
        suggestion:
            errorMessage === 'missing_api_key'
                ? 'Set API key in environment or .coworkany/settings.json'
                : errorMessage === 'missing_base_url'
                    ? 'Set base URL in environment or .coworkany/settings.json'
                    : recoverable
                        ? 'The model connection dropped. CoworkAny can continue this task after the connection is restored.'
                        : undefined,
    };
}
