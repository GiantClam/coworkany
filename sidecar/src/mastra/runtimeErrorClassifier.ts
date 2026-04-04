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

const TIMEOUT_PATTERNS: RegExp[] = [
    /chat_turn_timeout_budget_exhausted/i,
    /stream_(?:start|idle|progress)_timeout/i,
    /\btimeout\b/i,
    /\btimed out\b/i,
    /gateway time-?out/i,
    /headers timeout error/i,
    /\baborterror\b/i,
    /\betimedout\b/i,
];

const TEMPORARY_UNAVAILABLE_PATTERNS: RegExp[] = [
    /\b429\b/,
    /rate.?limit|too many requests/i,
    /insufficient[_\s-]?quota|insufficient credits/i,
    /temporar(?:y|ily).*(unavailable|error)?/i,
    /econnreset|enotfound|network error/i,
];

export function classifyRuntimeErrorMessage(message: string): RuntimeFailureClassification {
    const normalized = String(message ?? '');

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
