import type { TaskSession } from '../types';

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

function normalizeErrorCode(errorCode: string | undefined): string {
    return (errorCode ?? '').trim().toUpperCase();
}

function isConfigurationRequiredFailure(errorCode: string, errorMessage: string): boolean {
    if (errorCode === 'PROVIDER_CONFIG_REQUIRED') {
        return true;
    }
    if (errorCode === 'MISSING_API_KEY') {
        return true;
    }
    return /\bmissing[_\s-]?api[_\s-]?key\b|no available providers|provider not configured|invalid[_\s-]?api[_\s-]?key|unknown model|未知模型/i.test(errorMessage);
}

function isRetryableFailure(errorCode: string, errorMessage: string): boolean {
    if (errorCode === 'UPSTREAM_TIMEOUT' || errorCode === 'PROVIDER_TEMPORARILY_UNAVAILABLE') {
        return true;
    }
    return /\btimeout\b|timed out|gateway time-?out|headers timeout error|\b429\b|rate.?limit|temporar(?:y|ily)/i.test(errorMessage);
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
    const errorCode = normalizeErrorCode(failure.errorCode);
    const errorMessage = failure.error;

    if (isConfigurationRequiredFailure(errorCode, errorMessage)) {
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

    if (isRetryableFailure(errorCode, errorMessage)) {
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
