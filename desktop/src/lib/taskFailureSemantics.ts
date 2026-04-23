type TaskFailureSemantic =
    | 'configuration_required'
    | 'retryable'
    | 'missing_tool_evidence'
    | 'general';

type TaskFailureSemanticsInput = {
    failureClass?: string;
    errorCode?: string;
    errorMessage?: string;
};

const CONFIGURATION_REQUIRED_ERROR_CODES = new Set([
    'PROVIDER_CONFIG_REQUIRED',
    'PROVIDER_TLS_TRUST_FAILURE',
    'MISSING_API_KEY',
]);

const RETRYABLE_ERROR_CODES = new Set([
    'UPSTREAM_TIMEOUT',
    'PROVIDER_TEMPORARILY_UNAVAILABLE',
]);

const MISSING_TOOL_EVIDENCE_ERROR_CODES = new Set([
    'E_PROTOCOL_MISSING_TOOL_EVIDENCE',
]);

const CONFIGURATION_REQUIRED_PATTERN = /\bmissing[_\s-]?api[_\s-]?key\b|no available providers|provider not configured|invalid[_\s-]?api[_\s-]?key|unknown model|未知模型/i;
const RETRYABLE_PATTERN = /\btimeout\b|timed out|gateway time-?out|headers timeout error|\b429\b|rate.?limit|temporar(?:y|ily)/i;
const MISSING_TOOL_EVIDENCE_PATTERN = /\bworkflow_missing_required_tool_evidence\b|\bcomplete_without_required_tool_evidence\b|required tool evidence/i;

function normalizeValue(value: string | undefined): string {
    return (value ?? '').trim();
}

function normalizeFailureClass(value: string | undefined): string {
    return normalizeValue(value).toLowerCase();
}

function normalizeErrorCode(value: string | undefined): string {
    return normalizeValue(value).toUpperCase();
}

export function resolveTaskFailureSemantic(input: TaskFailureSemanticsInput): TaskFailureSemantic {
    const failureClass = normalizeFailureClass(input.failureClass);
    const errorCode = normalizeErrorCode(input.errorCode);
    const errorMessage = normalizeValue(input.errorMessage);

    if (
        MISSING_TOOL_EVIDENCE_ERROR_CODES.has(errorCode)
        || MISSING_TOOL_EVIDENCE_PATTERN.test(errorMessage)
    ) {
        return 'missing_tool_evidence';
    }
    if (failureClass === 'configuration_required') {
        return 'configuration_required';
    }
    if (failureClass === 'retryable') {
        return 'retryable';
    }
    if (
        CONFIGURATION_REQUIRED_ERROR_CODES.has(errorCode)
        || CONFIGURATION_REQUIRED_PATTERN.test(errorMessage)
    ) {
        return 'configuration_required';
    }
    if (
        RETRYABLE_ERROR_CODES.has(errorCode)
        || RETRYABLE_PATTERN.test(errorMessage)
    ) {
        return 'retryable';
    }
    return 'general';
}
