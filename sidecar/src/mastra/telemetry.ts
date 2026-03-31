import { randomUUID } from 'crypto';

export type TelemetrySamplingMode = 'always_on' | 'ratio' | 'off';

export type TelemetryPolicy = {
    mode: TelemetrySamplingMode;
    ratio: number;
    otelEndpoint?: string;
    serviceName: string;
};

export type TelemetryRunContext = {
    traceId: string;
    sampled: boolean;
    tracingOptions?: {
        traceId: string;
        tags: string[];
        requestContextKeys: string[];
        metadata: Record<string, unknown>;
        hideInput?: boolean;
        hideOutput?: boolean;
    };
};

function parseRatio(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    if (parsed <= 0) {
        return 0;
    }
    if (parsed >= 1) {
        return 1;
    }
    return parsed;
}

export function resolveTelemetryPolicy(env: Record<string, string | undefined> = process.env): TelemetryPolicy {
    const defaultMode: TelemetrySamplingMode = env.NODE_ENV === 'production' ? 'ratio' : 'always_on';
    const rawSampling = (env.COWORKANY_TELEMETRY_SAMPLING ?? '').trim().toLowerCase();

    let mode: TelemetrySamplingMode = defaultMode;
    let ratio = defaultMode === 'always_on' ? 1 : 0.15;

    if (rawSampling === 'always_on' || rawSampling === 'off') {
        mode = rawSampling;
    } else if (rawSampling.startsWith('ratio:')) {
        mode = 'ratio';
        ratio = parseRatio(rawSampling.slice('ratio:'.length), ratio);
    }

    ratio = parseRatio(env.COWORKANY_TELEMETRY_RATIO, ratio);
    if (mode === 'always_on') {
        ratio = 1;
    } else if (mode === 'off') {
        ratio = 0;
    }

    const otelEndpoint = env.COWORKANY_OTEL_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
    const serviceName = env.COWORKANY_OTEL_SERVICE_NAME?.trim() || 'coworkany-sidecar';

    return {
        mode,
        ratio,
        otelEndpoint: otelEndpoint && otelEndpoint.length > 0 ? otelEndpoint : undefined,
        serviceName,
    };
}

function shouldSample(policy: TelemetryPolicy, randomValue = Math.random()): boolean {
    if (policy.mode === 'always_on') {
        return true;
    }
    if (policy.mode === 'off') {
        return false;
    }
    return randomValue < policy.ratio;
}

function newTraceId(): string {
    return randomUUID().replace(/-/g, '').toLowerCase();
}

export function createTelemetryRunContext(input: {
    taskId: string;
    threadId: string;
    resourceId: string;
    workspacePath?: string;
    env?: Record<string, string | undefined>;
    randomValue?: number;
}): TelemetryRunContext {
    const policy = resolveTelemetryPolicy(input.env);
    const sampled = shouldSample(policy, input.randomValue);
    const traceId = newTraceId();
    const tags = [
        'runtime:desktop-sidecar',
        `task:${input.taskId}`,
        `resource:${input.resourceId}`,
        `thread:${input.threadId}`,
        `sampling:${policy.mode}`,
    ];
    if (typeof input.workspacePath === 'string' && input.workspacePath.length > 0) {
        tags.push(`workspace:${input.workspacePath}`);
    }
    if (policy.otelEndpoint) {
        tags.push('otel:configured');
    } else {
        tags.push('otel:not_configured');
    }

    return {
        traceId,
        sampled,
        tracingOptions: sampled
            ? {
                traceId,
                tags,
                requestContextKeys: ['taskId', 'runtime', 'workspacePath'],
                metadata: {
                    telemetry: {
                        mode: policy.mode,
                        ratio: policy.ratio,
                        serviceName: policy.serviceName,
                        otelEndpoint: policy.otelEndpoint ?? null,
                    },
                },
            }
            : undefined,
    };
}
