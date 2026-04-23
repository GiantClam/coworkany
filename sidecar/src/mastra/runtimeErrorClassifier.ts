export type RuntimeFailureClass = 'configuration_required' | 'retryable' | 'blocked' | 'unknown';

export interface RuntimeFailureClassification {
    errorCode: string;
    recoverable: boolean;
    suggestion: string;
    failureClass: RuntimeFailureClass;
}

const CONFIG_REQUIRED_PATTERNS: RegExp[] = [
    /missing[_\s-]?api[_\s-]?key/i,
    /no available providers/i,
    /provider not configured/i,
    /invalid[_\s-]?api[_\s-]?key/i,
    /unknown model|未知模型/i,
    /\b(401|403)\b/,
    /unauthorized|forbidden/i,
    /所有供应商暂时不可用|供应商.*暂时不可用/i,
];

const QUOTA_EXCEEDED_PATTERNS: RegExp[] = [
    /insufficient(?:_user)?[_\s-]?quota|insufficient credits/i,
    /额度不足|余额不足|用户额度不足/u,
];

const TIMEOUT_PATTERNS: RegExp[] = [
    /chat_turn_timeout_budget_exhausted/i,
    /chat_startup_timeout_budget_exhausted/i,
    /generate_fallback_timeout/i,
    /stream_(?:start|idle|progress)_timeout/i,
    /stream_max_duration_timeout/i,
    /delegated_task_execution_timeout/i,
    /stream_exhausted_without_assistant_text/i,
    /complete_without_assistant_text/i,
    /missing_terminal_after_tooling_progress/i,
    /\btimeout\b/i,
    /\btimed out\b/i,
    /gateway time-?out/i,
    /headers timeout error/i,
    /\baborterror\b/i,
    /\betimedout\b/i,
];

const TLS_TRUST_FAILURE_PATTERNS: RegExp[] = [
    /unable to get issuer certificate/i,
    /unable to verify (?:the first|leaf) certificate/i,
    /self[-\s]?signed certificate/i,
    /UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_[A-Z_]+/i,
];

const TEMPORARY_UNAVAILABLE_PATTERNS: RegExp[] = [
    /\b429\b/,
    /rate.?limit|too many requests/i,
    /temporar(?:y|ily).*(unavailable|error)?/i,
    /econnreset|enotfound|network error/i,
    /cannot connect to api/i,
    /network socket disconnected before secure tls connection was established/i,
    /No snapshot found for this workflow run/i,
];

export function classifyRuntimeErrorMessage(message: string): RuntimeFailureClassification {
    const normalized = String(message ?? '');

    if (QUOTA_EXCEEDED_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return {
            errorCode: 'PROVIDER_QUOTA_EXCEEDED',
            recoverable: false,
            suggestion: 'Provider quota is exhausted. Top up quota or switch provider/model in LLM Settings.',
            failureClass: 'blocked',
        };
    }

    if (CONFIG_REQUIRED_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return {
            errorCode: 'PROVIDER_CONFIG_REQUIRED',
            recoverable: true,
            suggestion: 'Open LLM Settings and verify provider, model, and API key, then retry.',
            failureClass: 'configuration_required',
        };
    }

    if (TIMEOUT_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return {
            errorCode: 'UPSTREAM_TIMEOUT',
            recoverable: true,
            suggestion: 'Model response timed out. Retry in a moment, or switch provider in LLM Settings.',
            failureClass: 'retryable',
        };
    }

    if (TLS_TRUST_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return {
            errorCode: 'PROVIDER_TLS_TRUST_FAILURE',
            recoverable: true,
            suggestion: 'TLS certificate validation failed. Configure provider CA trust or enable "Allow insecure TLS" in LLM Settings for trusted internal endpoints.',
            failureClass: 'configuration_required',
        };
    }

    if (TEMPORARY_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(normalized))) {
        return {
            errorCode: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
            recoverable: true,
            suggestion: 'Provider is temporarily unavailable or rate-limited. Retry shortly.',
            failureClass: 'retryable',
        };
    }

    return {
        errorCode: 'MASTRA_RUNTIME_ERROR',
        recoverable: false,
        suggestion: 'Check provider/network status and retry.',
        failureClass: 'unknown',
    };
}
