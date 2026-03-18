export type ExecutionTaskStatus = 'idle' | 'running' | 'finished' | 'failed';

export type ExecutionFinishedPayload = {
    summary: string;
    artifactsCreated?: string[];
    duration?: number;
};

export type ExecutionFailedPayload = {
    error: string;
    errorCode: string;
    recoverable: boolean;
    suggestion?: string;
};

export class ExecutionResultReporter {
    private readonly onFinished: (payload: ExecutionFinishedPayload) => void;
    private readonly onFailed: (payload: ExecutionFailedPayload) => void;
    private readonly onStatus?: (payload: { status: ExecutionTaskStatus }) => void;
    private readonly onArtifactTelemetry?: (payload: unknown) => void;

    constructor(input: {
        onFinished: (payload: ExecutionFinishedPayload) => void;
        onFailed: (payload: ExecutionFailedPayload) => void;
        onStatus?: (payload: { status: ExecutionTaskStatus }) => void;
        onArtifactTelemetry?: (payload: unknown) => void;
    }) {
        this.onFinished = input.onFinished;
        this.onFailed = input.onFailed;
        this.onStatus = input.onStatus;
        this.onArtifactTelemetry = input.onArtifactTelemetry;
    }

    finished(payload: ExecutionFinishedPayload): void {
        this.onFinished(payload);
    }

    failed(payload: ExecutionFailedPayload): void {
        this.onFailed(payload);
    }

    status(status: ExecutionTaskStatus): void {
        this.onStatus?.({ status });
    }

    appendArtifactTelemetry(payload: unknown): void {
        this.onArtifactTelemetry?.(payload);
    }
}
