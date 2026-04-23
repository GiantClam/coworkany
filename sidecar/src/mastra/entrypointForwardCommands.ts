type ForwardPayload = Record<string, unknown>;

type ForwardedProtocolResponse = {
    type?: string;
    payload?: unknown;
};

type ForwardPolicyDecision = {
    allowed: boolean;
    reason?: string;
};

type ForwardDeps = {
    commandId: string;
    commandType: string;
    payload: ForwardPayload;
    forwardedCommandTypes: ReadonlySet<string>;
    requestEffectTimeoutMs: number;
    defaultTimeoutMs: number;
    getString: (value: unknown) => string | null;
    toRecord: (value: unknown) => ForwardPayload;
    emitFor: (type: string, payload: ForwardPayload) => void;
    emitCurrent: (payload: ForwardPayload) => void;
    createId: () => string;
    applyPolicyDecision: (input: {
        requestId: string;
        action: 'forward_command';
        commandType: string;
        taskId?: string;
        source: 'policy_gate_forward';
        payload: ForwardPayload;
    }) => ForwardPolicyDecision;
    forwardCommandAndWait: (
        type: string,
        payload: ForwardPayload,
        emit: (message: Record<string, unknown>) => void,
        timeoutMs: number,
    ) => Promise<ForwardedProtocolResponse>;
    emitRaw: (message: Record<string, unknown>) => void;
    onInvalidResponse?: () => void;
};

export async function handleEntrypointForwardedCommand(input: ForwardDeps): Promise<boolean> {
    if (!input.forwardedCommandTypes.has(input.commandType)) {
        return false;
    }

    const forwardedCommandDecision = input.applyPolicyDecision({
        requestId: input.commandId,
        action: 'forward_command',
        commandType: input.commandType,
        taskId: input.getString(input.payload.taskId) ?? undefined,
        source: 'policy_gate_forward',
        payload: input.payload,
    });
    if (!forwardedCommandDecision.allowed) {
        input.emitCurrent({
            success: false,
            error: `policy_denied:${forwardedCommandDecision.reason}`,
        });
        return true;
    }

    const timeoutMs = input.commandType === 'request_effect'
        ? input.requestEffectTimeoutMs
        : input.defaultTimeoutMs;

    try {
        const forwarded = await input.forwardCommandAndWait(
            input.commandType,
            input.payload,
            input.emitRaw,
            timeoutMs,
        );
        const expectedType = `${input.commandType}_response`;
        if (forwarded.type === expectedType) {
            input.emitFor(expectedType, input.toRecord(forwarded.payload));
            return true;
        }
        input.onInvalidResponse?.();
        input.emitFor(expectedType, {
            success: false,
            error: `policy_gate_invalid_response:${String(forwarded.type ?? '')}`,
        });
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (input.commandType === 'apply_patch') {
            input.emitFor('apply_patch_response', {
                patchId: input.getString(input.payload.patchId) ?? input.createId(),
                success: false,
                error: `policy_gate_unavailable:${errorMessage}`,
                errorCode: 'io_error',
            });
            return true;
        }
        input.emitCurrent({
            success: false,
            error: `policy_gate_unavailable:${errorMessage}`,
        });
        return true;
    }
}
