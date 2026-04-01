import type { TFunction } from 'i18next';

type ValidationErrorInput = {
    provider: string;
    rawError?: string | null;
    t: TFunction;
};

function isOpenRouterPolicyBlocked(rawError: string): boolean {
    const lower = rawError.toLowerCase();
    const has403Status = lower.includes('status 403') || /"code"\s*:\s*403/i.test(rawError);
    const hasProviderNull = /"provider_name"\s*:\s*null/i.test(rawError);
    const hasTosViolation = lower.includes('violation of provider terms of service');
    return has403Status && (hasProviderNull || hasTosViolation);
}

export function mapValidationErrorToUserMessage(input: ValidationErrorInput): string {
    const normalizedError = input.rawError?.trim();
    if (!normalizedError) {
        return input.t('setup.verificationFailed');
    }

    if (input.provider !== 'openrouter') {
        return normalizedError;
    }

    if (!isOpenRouterPolicyBlocked(normalizedError)) {
        return normalizedError;
    }

    const primary = input.t('common.openRouterPolicyBlocked', {
        defaultValue: 'OpenRouter rejected this request (403). This is usually an account/provider risk-control or policy block.',
    });
    const hint = input.t('common.openRouterPolicyBlockedHint', {
        defaultValue: 'Try a new API key, switch to a mainstream model, and disable proxy/VPN before retrying. If it persists, contact OpenRouter support with the raw error.',
    });

    return `${primary}\n${hint}\n\n${normalizedError}`;
}
