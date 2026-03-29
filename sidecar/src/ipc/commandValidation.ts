export type ValidationIssue = {
    path: Array<string | number>;
    message: string;
};

export type ValidationErrorLike = {
    issues: ValidationIssue[];
};

export function summarizeValidationIssues(
    error: ValidationErrorLike,
    maxIssues = 5,
): string {
    return error.issues
        .slice(0, maxIssues)
        .map((issue) => {
            const issuePath = issue.path.length > 0 ? issue.path.join('.') : 'command';
            return `${issuePath}: ${issue.message}`;
        })
        .join('; ');
}

export function buildInvalidCommandResponse(
    raw: unknown,
    details: string,
    now: () => string = () => new Date().toISOString(),
): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const candidate = raw as { id?: unknown; type?: unknown };
    if (typeof candidate.id !== 'string') {
        return null;
    }

    const responseType = typeof candidate.type === 'string' && candidate.type.length > 0
        ? `${candidate.type}_response`
        : 'transport_error_response';

    return {
        type: responseType,
        commandId: candidate.id,
        timestamp: now(),
        payload: {
            success: false,
            error: `invalid_command: ${details}`,
            details,
        },
    };
}
