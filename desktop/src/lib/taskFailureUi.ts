import type { TaskSession } from '../types';
import { resolveTaskFailureSemantic } from './taskFailureSemantics';

export type TaskFailureUiCategory = 'configuration_required' | 'retryable' | 'general' | 'suspended';
export type TaskFailureUiAction = 'settings' | 'retry';

export interface TaskFailureUiDescriptor {
    category: TaskFailureUiCategory;
    action: TaskFailureUiAction;
    titleKey: string;
    titleDefault: string;
    descriptionKey: string;
    descriptionDefault: string;
    actionLabelKey: string;
    actionLabelDefault: string;
}

type TaskFailureState = Pick<NonNullable<TaskSession['failure']>, 'error' | 'errorCode' | 'recoverable' | 'suggestion'> & {
    failureClass?: string;
};

type FormatFailureOptions = {
    fallbackDescription: string;
    includePrefix?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripWrappingQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length < 2) {
        return trimmed;
    }
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

function normalizeMultilineError(value: string): string {
    const decoded = value.replace(/\\n/g, '\n');
    const lines = decoded
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        return '';
    }
    const firstMeaningful = lines.find((line) => !/^at\s+/iu.test(line));
    return (firstMeaningful ?? lines[0] ?? '')
        .replace(/^error:\s*/iu, '')
        .trim();
}

function extractJsonCandidate(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    const withoutPrefix = trimmed.replace(/^error:\s*/iu, '').trim();
    const candidates = [
        trimmed,
        withoutPrefix,
        stripWrappingQuotes(trimmed),
        stripWrappingQuotes(withoutPrefix),
    ];
    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return candidate.slice(start, end + 1);
        }
    }
    return null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
    const attemptParse = (input: string): Record<string, unknown> | null => {
        try {
            const parsed = JSON.parse(input) as unknown;
            return isRecord(parsed) ? parsed : null;
        } catch {
            return null;
        }
    };
    return attemptParse(value) ?? attemptParse(stripWrappingQuotes(value));
}

function readStructuredCauseMessage(payload: Record<string, unknown>): string {
    const cause = payload.cause;
    if (typeof cause === 'string') {
        return normalizeMultilineError(cause);
    }
    if (!isRecord(cause)) {
        return '';
    }
    return normalizeMultilineError(String(cause.message ?? ''));
}

function readStructuredDetails(payload: Record<string, unknown>): string {
    const details = payload.details;
    if (!isRecord(details)) {
        return '';
    }
    const serverName = details.serverName;
    if (typeof serverName === 'string' && serverName.trim().length > 0) {
        return `server: ${serverName.trim()}`;
    }
    const name = details.name;
    if (typeof name === 'string' && name.trim().length > 0) {
        return `server: ${name.trim()}`;
    }
    return '';
}

export function normalizeTaskFailureErrorMessage(rawError: string | undefined): string {
    const original = (rawError ?? '').trim();
    if (!original) {
        return '';
    }

    const jsonCandidate = extractJsonCandidate(original);
    if (jsonCandidate) {
        const structured = parseJsonObject(jsonCandidate);
        if (structured) {
            const primary = normalizeMultilineError(String(structured.message ?? structured.error ?? ''));
            const cause = readStructuredCauseMessage(structured);
            const details = readStructuredDetails(structured);
            const parts = [primary, cause ? `cause: ${cause}` : '', details].filter(Boolean);
            if (parts.length > 0) {
                return parts.join(' | ');
            }
        }
    }

    const noErrorPrefix = original.replace(/^error:\s*/iu, '').trim();
    return normalizeMultilineError(noErrorPrefix);
}

function normalizeErrorCode(errorCode: string | undefined): string {
    return (errorCode ?? '').trim().toUpperCase();
}

function normalizeFailureClass(value: string | undefined): string {
    return (value ?? '').trim().toLowerCase();
}

function appendUniqueLine(lines: string[], value: string | undefined): void {
    const normalized = (value ?? '').trim();
    if (!normalized) {
        return;
    }
    if (lines.includes(normalized)) {
        return;
    }
    lines.push(normalized);
}

function toFailureClassLabel(value: string): string | null {
    switch (value) {
        case 'retryable':
            return 'Temporary upstream issue';
        case 'configuration_required':
            return 'Configuration required';
        case 'blocked':
            return 'Blocked by provider policy';
        case 'unknown':
            return 'Unclassified failure';
        default:
            return null;
    }
}

export function formatTaskFailureDetails(
    failure: TaskFailureState | undefined,
    options: FormatFailureOptions,
): string {
    const includePrefix = options.includePrefix !== false;
    const lines: string[] = [];
    const errorText = normalizeTaskFailureErrorMessage(failure?.error);
    const errorCode = normalizeErrorCode(failure?.errorCode);
    const suggestion = (failure?.suggestion ?? '').trim();
    const failureClass = normalizeFailureClass(failure?.failureClass);

    if (errorText) {
        appendUniqueLine(lines, includePrefix ? `Task failed: ${errorText}` : errorText);
    } else if (options.fallbackDescription.trim().length > 0) {
        appendUniqueLine(lines, options.fallbackDescription);
    }

    if (errorCode) {
        appendUniqueLine(lines, `Error code: ${errorCode}`);
    }

    const failureClassLabel = toFailureClassLabel(failureClass);
    if (failureClassLabel) {
        appendUniqueLine(lines, failureClassLabel);
    }

    if (suggestion) {
        appendUniqueLine(lines, suggestion);
    } else if (failure?.recoverable === true) {
        appendUniqueLine(lines, 'This task can be retried from the current state.');
    }

    return lines.join('\n').trim();
}

export function getTaskFailureUiDescriptor(
    session: Pick<TaskSession, 'failure' | 'suspension' | 'status'> | undefined,
): TaskFailureUiDescriptor | null {
    if (session?.status === 'suspended' && session.suspension) {
        return {
            category: 'suspended',
            action: 'retry',
            titleKey: 'chat.failureRetryableTitle',
            titleDefault: 'Task suspended',
            descriptionKey: 'chat.failureRetryableDesc',
            descriptionDefault: session.suspension.userMessage || 'Task is suspended and can be resumed by retrying.',
            actionLabelKey: 'chat.failureActionRetry',
            actionLabelDefault: 'Retry',
        };
    }

    const failure = session?.failure;
    if (!failure?.error) {
        return null;
    }
    const errorMessage = normalizeTaskFailureErrorMessage(failure.error);
    const semantic = resolveTaskFailureSemantic({
        failureClass: failure.failureClass,
        errorCode: failure.errorCode,
        errorMessage,
    });

    if (semantic === 'configuration_required') {
        return {
            category: 'configuration_required',
            action: 'settings',
            titleKey: 'chat.failureNeedsConfigTitle',
            titleDefault: 'Provider configuration required',
            descriptionKey: 'chat.failureNeedsConfigDesc',
            descriptionDefault: 'Model provider is unavailable or misconfigured. Update provider settings and retry.',
            actionLabelKey: 'chat.failureActionOpenSettings',
            actionLabelDefault: 'Open LLM Settings',
        };
    }

    if (semantic === 'retryable') {
        return {
            category: 'retryable',
            action: 'retry',
            titleKey: 'chat.failureRetryableTitle',
            titleDefault: 'Temporary upstream issue',
            descriptionKey: 'chat.failureRetryableDesc',
            descriptionDefault: 'The provider timed out or is temporarily unavailable. Retry now.',
            actionLabelKey: 'chat.failureActionRetry',
            actionLabelDefault: 'Retry',
        };
    }

    if (semantic === 'missing_tool_evidence') {
        return {
            category: 'retryable',
            action: 'retry',
            titleKey: 'chat.failureMissingToolEvidenceTitle',
            titleDefault: 'Execution steps were not run',
            descriptionKey: 'chat.failureMissingToolEvidenceDesc',
            descriptionDefault: 'The task produced a plan but did not execute required tools. Retry will rerun from the failed step.',
            actionLabelKey: 'chat.failureActionRetry',
            actionLabelDefault: 'Retry',
        };
    }

    return {
        category: 'general',
        action: 'retry',
        titleKey: 'chat.failureGenericTitle',
        titleDefault: 'Task failed',
        descriptionKey: 'chat.failureGenericDesc',
        descriptionDefault: 'Execution failed unexpectedly. Retry, or check provider settings if this keeps happening.',
        actionLabelKey: 'chat.failureActionRetry',
        actionLabelDefault: 'Retry',
    };
}
