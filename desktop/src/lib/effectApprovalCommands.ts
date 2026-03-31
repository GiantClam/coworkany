import type { invoke } from '@tauri-apps/api/core';

type InvokeCommand = typeof invoke;

export async function invokeConfirmEffectCommand(
    invokeCommand: InvokeCommand,
    input: {
        requestId: string;
        remember?: boolean;
    },
): Promise<void> {
    await invokeCommand('confirm_effect', {
        requestId: input.requestId,
        remember: Boolean(input.remember),
    });
}

export async function invokeDenyEffectCommand(
    invokeCommand: InvokeCommand,
    input: {
        requestId: string;
        reason?: string;
    },
): Promise<void> {
    const reason = typeof input.reason === 'string'
        ? input.reason.trim()
        : '';
    await invokeCommand('deny_effect', {
        requestId: input.requestId,
        reason: reason || undefined,
    });
}
